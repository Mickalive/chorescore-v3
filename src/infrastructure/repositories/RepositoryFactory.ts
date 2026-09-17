/**
 * ChoreScore V3 — Repository Factory
 *
 * Provides SQLite-backed repositories on device with in-memory fallback for tests.
 * Business data is persisted in the indexed local store and survives restarts.
 * Navigation reads from local state without any cloud dependency.
 *
 * Sync-aware: in-memory repos automatically record dirty sync records after
 * business writes (via SyncRecording wrappers) and materialize remote deltas
 * into business tables (via MaterializingSyncState). This ensures the sync
 * pipeline is wired end-to-end: local writes produce real push payloads and
 * remote pulls actually update business data.
 */

import {
  User,
  Membership,
  Household,
  Member,
  ContributionEntry,
  PersistentTask,
  TodoItem,
  ExpenseEntry,
  CrossLedgerSettlement,
  Invitation,
  SyncCursor,
  SyncRecord,
  SyncCollection,
} from '../../domain/entities';
import {
  UserRepository,
  MembershipRepository,
  HouseholdRepository,
  MemberRepository,
  ContributionEntryRepository,
  PersistentTaskRepository,
  TodoRepository,
  ExpenseEntryRepository,
  SettlementRepository,
  InvitationRepository,
  SyncStateRepository,
  PaginatedResult,
  PaginatedQuery,
} from './index';
import {
  InMemoryUserRepository,
  InMemoryMembershipRepository,
  InMemoryHouseholdRepository,
  InMemoryMemberRepository,
  InMemoryContributionEntryRepository,
  InMemoryPersistentTaskRepository,
  InMemoryTodoRepository,
  InMemoryExpenseEntryRepository,
  InMemorySettlementRepository,
  InMemoryInvitationRepository,
  InMemorySyncStateRepository,
} from './InMemoryRepositories';
import { materializeDeltas } from '../sync/SyncMaterializer';

export interface AllRepositories {
  users: UserRepository;
  memberships: MembershipRepository;
  households: HouseholdRepository;
  members: MemberRepository;
  contributions: ContributionEntryRepository;
  tasks: PersistentTaskRepository;
  todos: TodoRepository;
  expenses: ExpenseEntryRepository;
  settlements: SettlementRepository;
  invitations: InvitationRepository;
  syncState: SyncStateRepository;

  /**
   * Run `fn` inside a storage-level transaction.
   * On success the transaction commits; on any throw it rolls back so that
   * neither the todo update nor the contribution insert persists alone.
   * SQLite: real DB transaction via `withTransactionAsync`.
   * In-memory: snapshot/restore of the affected repos.
   */
  withTransaction: <T>(fn: () => Promise<T>) => Promise<T>;
}

/**
 * Detect whether we are running in a test environment.
 * In tests, SQLite is not available (no native modules), so we use in-memory.
 * Detection is explicit: jest sets NODE_ENV=test and the jest config also
 * defines globalThis.__TEST__ = true.
 */
function isTestEnvironment(): boolean {
  if (typeof globalThis !== 'undefined') {
    const g = globalThis as Record<string, unknown>;
    if (g.__TEST__ === true) return true;
  }
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
    return true;
  }
  return false;
}

/**
 * Attempt to load the SQLite repositories. Falls back to in-memory on failure.
 */
async function createSqliteRepositories(): Promise<AllRepositories | null> {
  try {
    const {
      SqliteUserRepository,
      SqliteMembershipRepository,
      SqliteHouseholdRepository,
      SqliteMemberRepository,
      SqliteContributionEntryRepository,
      SqlitePersistentTaskRepository,
      SqliteTodoRepository,
      SqliteExpenseEntryRepository,
      SqliteSettlementRepository,
      SqliteInvitationRepository,
      SqliteSyncStateRepository,
    } = await import('./SqliteRepositories');

    // Force database initialization to verify expo-sqlite works
    const { getDatabase } = await import('../local/SqliteStorage');
    const db = await getDatabase();

    return {
      users: new SqliteUserRepository(),
      memberships: new SqliteMembershipRepository(),
      households: new SqliteHouseholdRepository(),
      members: new SqliteMemberRepository(),
      contributions: new SqliteContributionEntryRepository(),
      tasks: new SqlitePersistentTaskRepository(),
      todos: new SqliteTodoRepository(),
      expenses: new SqliteExpenseEntryRepository(),
      settlements: new SqliteSettlementRepository(),
      invitations: new SqliteInvitationRepository(),
      syncState: new SqliteSyncStateRepository(),
      withTransaction: async <T>(fn: () => Promise<T>): Promise<T> => {
        // Real SQLite transaction: any throw rolls back both writes.
        let result: T;
        await db.withTransactionAsync(async () => {
          result = await fn();
        });
        return result!;
      },
    };
  } catch {
    // expo-sqlite not available (test env, web, etc.)
    return null;
  }
}

/**
 * Wraps InMemorySyncStateRepository so that applyDeltas also materializes
 * pulled records into the actual business tables (contribution_entries,
 * expense_entries, settlements, todo_items, persistent_tasks, members,
 * memberships, households). This is the core fix for finding #1: remote
 * deltas now actually reach business data, not just a buffer.
 */
class MaterializingSyncState implements SyncStateRepository {
  constructor(
    private inner: InMemorySyncStateRepository,
    private getRepos: () => AllRepositories,
  ) {}

  getCursor(householdId: string, collection: SyncCollection): Promise<SyncCursor | null> {
    return this.inner.getCursor(householdId, collection);
  }

  setCursor(cursor: SyncCursor): Promise<void> {
    return this.inner.setCursor(cursor);
  }

  async applyDeltas(
    householdId: string,
    collection: SyncCollection,
    records: SyncRecord[],
  ): Promise<SyncRecord[]> {
    // 1. Delegate to inner for buffer storage + cursor advancement
    const applied = await this.inner.applyDeltas(householdId, collection, records);

    // 2. Materialize into actual business tables
    const repos = this.getRepos();
    await materializeDeltas(repos, collection, records);

    return applied;
  }

  storeLocalRecords(
    householdId: string,
    collection: SyncCollection,
    records: SyncRecord[],
  ): Promise<void> {
    return this.inner.storeLocalRecords(householdId, collection, records);
  }

  getDirtyRecords(
    householdId: string,
    collection: SyncCollection,
    sinceRevision: number,
  ): Promise<SyncRecord[]> {
    return this.inner.getDirtyRecords(householdId, collection, sinceRevision);
  }
}

/**
 * Global revision counter for sync records created by business writes.
 * Each write increments this counter. In production this would be
 * per-entity persisted; for InMemory tests a simple counter suffices.
 */
let syncRevisionCounter = 0;
function nextSyncRevision(): number {
  syncRevisionCounter += 1;
  return syncRevisionCounter;
}

/** Reset the revision counter (for tests). */
export function resetSyncRevisions(): void {
  syncRevisionCounter = 0;
}

/**
 * Create an AllRepositories set with sync recording wired.
 * Every business write (create/update/delete) on contribution, expense,
 * todo and settlement repos automatically records a dirty SyncRecord
 * via storeLocalRecords, so pushDeltas has real payloads to send.
 */
function createInMemoryRepositories(): AllRepositories {
  const todoRepo = new InMemoryTodoRepository();
  const contributionRepo = new InMemoryContributionEntryRepository();
  const expenseRepo = new InMemoryExpenseEntryRepository();
  const settlementRepo = new InMemorySettlementRepository();
  const baseSyncState = new InMemorySyncStateRepository();

  // We need a lazy getter because the repos reference each other circularly
  let repos: AllRepositories;

  // Wrap business repos to record dirty sync records after writes
  const syncContributions = wrapContributionRepo(contributionRepo, baseSyncState);
  const syncExpenses = wrapExpenseRepo(expenseRepo, baseSyncState);
  const syncTodos = wrapTodoRepo(todoRepo, baseSyncState);
  const syncSettlements = wrapSettlementRepo(settlementRepo, baseSyncState);

  // Materializing sync state: applyDeltas also writes to business tables
  const materializingSync = new MaterializingSyncState(baseSyncState, () => repos);

  repos = {
    users: new InMemoryUserRepository(),
    memberships: new InMemoryMembershipRepository(),
    households: new InMemoryHouseholdRepository(),
    members: new InMemoryMemberRepository(),
    contributions: syncContributions,
    tasks: new InMemoryPersistentTaskRepository(),
    todos: syncTodos,
    expenses: syncExpenses,
    settlements: syncSettlements,
    invitations: new InMemoryInvitationRepository(),
    syncState: materializingSync,
    withTransaction: async <T>(fn: () => Promise<T>): Promise<T> => {
      // In-memory equivalent of a DB transaction: snapshot the affected
      // repos, run the work, and restore on any failure so a partial write
      // can never survive.
      const todoSnap = todoRepo.snapshot();
      const contributionSnap = contributionRepo.snapshot();
      try {
        return await fn();
      } catch (err) {
        todoRepo.restoreFromSnapshot(todoSnap);
        contributionRepo.restoreFromSnapshot(contributionSnap);
        throw err;
      }
    },
  };

  return repos;
}

// ── Sync Recording Wrappers ────────────────────────────────────
// These wrap business repositories to call storeLocalRecords after
// every write, ensuring pushDeltas has real payloads.

function recordDirty(
  syncState: InMemorySyncStateRepository,
  householdId: string,
  collection: SyncCollection,
  entityId: string,
  entity: unknown,
  deleted: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  const record: SyncRecord = {
    id: entityId,
    householdId,
    collection,
    revision: nextSyncRevision(),
    updatedAt: now,
    deletedAt: deleted ? now : null,
    payload: deleted ? null : JSON.stringify(entity),
  };
  return syncState.storeLocalRecords(householdId, collection, [record]);
}

function wrapContributionRepo(
  inner: InMemoryContributionEntryRepository,
  syncState: InMemorySyncStateRepository,
): ContributionEntryRepository {
  return {
    seed: (items) => inner.seed(items),
    getByHousehold: (hhId) => inner.getByHousehold(hhId),
    getByHouseholdPaginated: (hhId, q) => inner.getByHouseholdPaginated(hhId, q),
    getById: (id) => inner.getById(id),
    async create(entry) {
      const created = await inner.create(entry);
      await recordDirty(syncState, entry.householdId, 'contribution_entries', created.id, created, false);
      return created;
    },
    async update(id, data) {
      const updated = await inner.update(id, data);
      await recordDirty(syncState, updated.householdId, 'contribution_entries', id, updated, false);
      return updated;
    },
    async delete(id) {
      const existing = await inner.getById(id);
      await inner.delete(id);
      if (existing) {
        await recordDirty(syncState, existing.householdId, 'contribution_entries', id, existing, true);
      }
    },
  };
}

function wrapExpenseRepo(
  inner: InMemoryExpenseEntryRepository,
  syncState: InMemorySyncStateRepository,
): ExpenseEntryRepository {
  return {
    seed: (items) => inner.seed(items),
    getByHousehold: (hhId) => inner.getByHousehold(hhId),
    getByHouseholdPaginated: (hhId, q) => inner.getByHouseholdPaginated(hhId, q),
    getById: (id) => inner.getById(id),
    async create(entry) {
      const created = await inner.create(entry);
      await recordDirty(syncState, entry.householdId, 'expense_entries', created.id, created, false);
      return created;
    },
    async update(id, data) {
      const updated = await inner.update(id, data);
      await recordDirty(syncState, updated.householdId, 'expense_entries', id, updated, false);
      return updated;
    },
    async delete(id) {
      const existing = await inner.getById(id);
      await inner.delete(id);
      if (existing) {
        await recordDirty(syncState, existing.householdId, 'expense_entries', id, existing, true);
      }
    },
  };
}

function wrapTodoRepo(
  inner: InMemoryTodoRepository,
  syncState: InMemorySyncStateRepository,
): TodoRepository {
  return {
    seed: (items) => inner.seed(items),
    getByHousehold: (hhId) => inner.getByHousehold(hhId),
    getById: (id) => inner.getById(id),
    async create(todo) {
      const created = await inner.create(todo);
      await recordDirty(syncState, todo.householdId, 'todo_items', created.id, created, false);
      return created;
    },
    async update(id, data) {
      const updated = await inner.update(id, data);
      await recordDirty(syncState, updated.householdId, 'todo_items', id, updated, false);
      return updated;
    },
    async delete(id) {
      const existing = await inner.getById(id);
      await inner.delete(id);
      if (existing) {
        await recordDirty(syncState, existing.householdId, 'todo_items', id, existing, true);
      }
    },
  };
}

function wrapSettlementRepo(
  inner: InMemorySettlementRepository,
  syncState: InMemorySyncStateRepository,
): SettlementRepository {
  return {
    seed: (items) => inner.seed(items),
    getByHousehold: (hhId) => inner.getByHousehold(hhId),
    getByHouseholdPaginated: (hhId, q) => inner.getByHouseholdPaginated(hhId, q),
    getById: (id) => inner.getById(id),
    async create(settlement) {
      const created = await inner.create(settlement);
      await recordDirty(syncState, settlement.householdId, 'settlements', created.id, created, false);
      return created;
    },
    async delete(id) {
      const existing = await inner.getById(id);
      await inner.delete(id);
      if (existing) {
        await recordDirty(syncState, existing.householdId, 'settlements', id, existing, true);
      }
    },
  };
}

export { createInMemoryRepositories };

/**
 * Create the appropriate repository set.
 * On device: SQLite-backed, indexed, persists across restarts.
 * In tests: In-memory fallback for deterministic testing.
 */
export async function createRepositories(): Promise<AllRepositories> {
  if (isTestEnvironment()) {
    return createInMemoryRepositories();
  }

  const sqliteRepos = await createSqliteRepositories();
  if (sqliteRepos) {
    return sqliteRepos;
  }

  // Final fallback: in-memory (web, degraded environment)
  return createInMemoryRepositories();
}
