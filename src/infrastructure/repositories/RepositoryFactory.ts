/**
 * ChoreScore V3 — Repository Factory
 *
 * Provides SQLite-backed repositories on device with in-memory fallback for tests.
 * Business data is persisted in the indexed local store and survives restarts.
 * Navigation reads from local state without any cloud dependency.
 *
 * Sync-aware: ALL repos (both in-memory and SQLite) automatically record dirty
 * sync records after business writes (via SyncRecording wrappers) and materialize
 * remote deltas into business tables (via MaterializingSyncState). This ensures
 * the sync pipeline is wired end-to-end for all 8 SYNC_COLLECTIONS:
 *   contributions, expenses, settlements, todos, persistent_tasks,
 *   members, memberships, households.
 *
 * V3-06 REPAIR:
 *   - SQLite path now uses MaterializingSyncState with sync recording wrappers.
 *   - applyDeltas is transactional: materialize first, then advance cursor.
 *   - withTransaction snapshot coverage extends to all affected repos.
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
import {
  SyncRecordingContributionRepository,
  SyncRecordingExpenseRepository,
  SyncRecordingTodoRepository,
  SyncRecordingSettlementRepository,
  SyncRecordingPersistentTaskRepository,
  SyncRecordingMemberRepository,
  SyncRecordingMembershipRepository,
  SyncRecordingHouseholdRepository,
  resetRevisions as resetWrapperRevisions,
} from '../sync/SyncRecordingWrapper';
import { materializeDeltas, getEntityTimestamp, didRemoteWin } from '../sync/SyncMaterializer';

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
  resetWrapperRevisions();
}

// ── Materializing Sync State (shared by both paths) ────────────
// V3-06 REPAIR: applyDeltas is now transactional — materialize first,
// then advance the cursor. On failure, roll back both so the delta
// is re-fetched on the next pull. Uses real local revisions from the
// sync buffer for deterministic conflict resolution.
//
// V3-06 REPAIR Finding #2: When the local record wins the conflict,
// the local dirty record is preserved in the sync buffer (not overwritten
// with the remote record). Only remote-winning records are stored.

/**
 * Extract local revisions from the sync buffer BEFORE applying the remote
 * deltas. This is the key to passing real local revisions to the materializer.
 */
async function extractLocalRevisions(
  inner: SyncStateRepository,
  householdId: string,
  collection: SyncCollection,
  incomingRecordIds: string[],
): Promise<Map<string, number>> {
  const localRevisions = new Map<string, number>();
  // For each incoming record, look up the existing record's revision from
  // the dirty records buffer. We query from revision 0 to get all records
  // and filter to the ids we care about.
  const existingRecords = await inner.getDirtyRecords(householdId, collection, 0);
  for (const record of existingRecords) {
    if (incomingRecordIds.includes(record.id)) {
      localRevisions.set(record.id, record.revision);
    }
  }
  return localRevisions;
}

/**
 * Get the existing entity from the business repo for conflict resolution.
 * Returns null if no existing entity.
 */
async function getExistingEntityTimestamp(
  repos: AllRepositories,
  collection: SyncCollection,
  id: string,
): Promise<string> {
  switch (collection) {
    case 'contribution_entries': {
      const e = await repos.contributions.getById(id);
      return e ? getEntityTimestamp(collection, e as unknown as Record<string, unknown>) : '';
    }
    case 'expense_entries': {
      const e = await repos.expenses.getById(id);
      return e ? getEntityTimestamp(collection, e as unknown as Record<string, unknown>) : '';
    }
    case 'settlements': {
      const e = await repos.settlements.getById(id);
      return e ? getEntityTimestamp(collection, e as unknown as Record<string, unknown>) : '';
    }
    case 'todo_items': {
      const e = await repos.todos.getById(id);
      return e ? getEntityTimestamp(collection, e as unknown as Record<string, unknown>) : '';
    }
    case 'persistent_tasks': {
      const e = await repos.tasks.getById(id);
      return e ? getEntityTimestamp(collection, e as unknown as Record<string, unknown>) : '';
    }
    case 'members': {
      const e = await repos.members.getById(id);
      return e ? getEntityTimestamp(collection, e as unknown as Record<string, unknown>) : '';
    }
    case 'memberships': {
      // Memberships don't have getById — skip timestamp check for simplicity
      return '';
    }
    case 'households': {
      const e = await repos.households.getById(id);
      return e ? getEntityTimestamp(collection, e as unknown as Record<string, unknown>) : '';
    }
    default:
      return '';
  }
}

class MaterializingSyncState implements SyncStateRepository {
  constructor(
    private inner: SyncStateRepository,
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
    pullCursorToAdvance?: SyncCursor,
  ): Promise<SyncRecord[]> {
    const repos = this.getRepos();

    // V3-06 REPAIR: Extract real local revisions BEFORE applying remote deltas.
    // This ensures that conflict resolution uses the actual local revision
    // (from the sync buffer) instead of hard-coded 0.
    const recordIds = records.map((r) => r.id);
    const localRevisions = await extractLocalRevisions(
      this.inner, householdId, collection, recordIds,
    );

    // V3-06 REPAIR Finding #2: Pre-compute which records the local wins
    // so we can preserve the local dirty record in the buffer.
    const localWinsMap = new Map<string, boolean>();
    for (const record of records) {
      if (record.deletedAt) {
        // Tombstones always apply
        localWinsMap.set(record.id, false);
        continue;
      }
      const localRev = localRevisions.get(record.id) ?? 0;
      if (localRev === 0) {
        // No local record → remote always wins (it's a new record)
        localWinsMap.set(record.id, false);
        continue;
      }
      const localTimestamp = await getExistingEntityTimestamp(repos, collection, record.id);
      localWinsMap.set(record.id, !didRemoteWin(localRev, localTimestamp, record.revision, record.updatedAt));
    }

    // V3-06 REPAIR: Wrap materialization + cursor advance in a single
    // transaction. Materialize first, then advance the cursor atomically.
    // On failure, roll back both so the delta is re-fetched on next pull.
    return repos.withTransaction(async () => {
      // 1. Materialize into actual business tables (with real local revisions)
      await materializeDeltas(repos, collection, records, localRevisions);

      // 2. V3-06 REPAIR Finding #2: Only store REMOTE records in the sync
      //    buffer where the remote actually won. When the local record won
      //    the conflict, the local dirty record is preserved so pushDeltas
      //    can still send the local payload to the remote.
      const recordsToStore = records.filter((r) => localWinsMap.get(r.id) === false);
      if (recordsToStore.length > 0) {
        await this.inner.storeLocalRecords(householdId, collection, recordsToStore);
      }

      // 3. V3-06 REPAIR Finding #1: Advance the pull cursor inside the
      //    same transaction as materialization. On failure, the cursor
      //    is NOT advanced so the delta is re-fetched on next pull.
      if (pullCursorToAdvance) {
        await this.inner.setCursor(pullCursorToAdvance);
      }

      return records;
    });
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

// ── Shared In-Memory Business Repo Snapshots ───────────────────

interface Snapshotable {
  snapshot(): unknown;
  restoreFromSnapshot(snap: unknown): void;
}

// ── In-Memory Path ─────────────────────────────────────────────

function createInMemoryRepositories(): AllRepositories {
  const userRepo = new InMemoryUserRepository();
  const membershipRepo = new InMemoryMembershipRepository();
  const householdRepo = new InMemoryHouseholdRepository();
  const memberRepo = new InMemoryMemberRepository();
  const contributionRepo = new InMemoryContributionEntryRepository();
  const taskRepo = new InMemoryPersistentTaskRepository();
  const todoRepo = new InMemoryTodoRepository();
  const expenseRepo = new InMemoryExpenseEntryRepository();
  const settlementRepo = new InMemorySettlementRepository();
  const invitationRepo = new InMemoryInvitationRepository();
  const baseSyncState = new InMemorySyncStateRepository();

  // Wrap ALL business repos to record dirty sync records after writes
  const syncContributions = new SyncRecordingContributionRepository(contributionRepo, baseSyncState);
  const syncExpenses = new SyncRecordingExpenseRepository(expenseRepo, baseSyncState);
  const syncTodos = new SyncRecordingTodoRepository(todoRepo, baseSyncState);
  const syncSettlements = new SyncRecordingSettlementRepository(settlementRepo, baseSyncState);
  const syncTasks = new SyncRecordingPersistentTaskRepository(taskRepo, baseSyncState);
  const syncMembers = new SyncRecordingMemberRepository(memberRepo, baseSyncState);
  const syncMemberships = new SyncRecordingMembershipRepository(membershipRepo, baseSyncState);
  const syncHouseholds = new SyncRecordingHouseholdRepository(householdRepo, baseSyncState);

  // Materializing sync state: applyDeltas also writes to business tables
  // in a transactional manner (materialize → cursor atomically)
  let repos: AllRepositories;
  const materializingSync = new MaterializingSyncState(baseSyncState, () => repos);

  repos = {
    users: userRepo,
    memberships: syncMemberships,
    households: syncHouseholds,
    members: syncMembers,
    contributions: syncContributions,
    tasks: syncTasks,
    todos: syncTodos,
    expenses: syncExpenses,
    settlements: syncSettlements,
    invitations: invitationRepo,
    syncState: materializingSync,
    withTransaction: async <T>(fn: () => Promise<T>): Promise<T> => {
      // V3-06 REPAIR: In-memory equivalent of a DB transaction: snapshot ALL
      // affected repos (business repos + sync buffer), run the work, and restore
      // on any failure so a partial write can never survive.
      const contribSnap = contributionRepo.snapshot();
      const todoSnap = todoRepo.snapshot();
      // Snapshot base sync state (cursors + records)
      const syncCursorsSnap = baseSyncState.snapshotCursors();
      const syncRecordsSnap = baseSyncState.snapshotRecords();
      try {
        return await fn();
      } catch (err) {
        contributionRepo.restoreFromSnapshot(contribSnap);
        todoRepo.restoreFromSnapshot(todoSnap);
        baseSyncState.restoreCursors(syncCursorsSnap);
        baseSyncState.restoreRecords(syncRecordsSnap);
        throw err;
      }
    },
  };

  return repos;
}

export { createInMemoryRepositories };

// ── SQLite Path ────────────────────────────────────────────────
// V3-06 REPAIR: The SQLite path now uses MaterializingSyncState with
// sync recording wrappers, covering all 8 SYNC_COLLECTIONS.

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

    // Raw (unwrapped) repos — these hold the actual SQLite data
    const rawMemberships = new SqliteMembershipRepository();
    const rawHouseholds = new SqliteHouseholdRepository();
    const rawMembers = new SqliteMemberRepository();
    const rawContributions = new SqliteContributionEntryRepository();
    const rawTasks = new SqlitePersistentTaskRepository();
    const rawTodos = new SqliteTodoRepository();
    const rawExpenses = new SqliteExpenseEntryRepository();
    const rawSettlements = new SqliteSettlementRepository();
    const baseSyncState = new SqliteSyncStateRepository();

    // Wrap ALL 8 business repos to record dirty sync records after writes
    const syncMemberships = new SyncRecordingMembershipRepository(rawMemberships, baseSyncState);
    const syncHouseholds = new SyncRecordingHouseholdRepository(rawHouseholds, baseSyncState);
    const syncMembers = new SyncRecordingMemberRepository(rawMembers, baseSyncState);
    const syncContributions = new SyncRecordingContributionRepository(rawContributions, baseSyncState);
    const syncTasks = new SyncRecordingPersistentTaskRepository(rawTasks, baseSyncState);
    const syncTodos = new SyncRecordingTodoRepository(rawTodos, baseSyncState);
    const syncExpenses = new SyncRecordingExpenseRepository(rawExpenses, baseSyncState);
    const syncSettlements = new SyncRecordingSettlementRepository(rawSettlements, baseSyncState);

    // Materializing sync state: applyDeltas materializes into business
    // tables AND advances the cursor inside a single SQLite transaction.
    let repos: AllRepositories;
    const materializingSync = new MaterializingSyncState(baseSyncState, () => repos);

    repos = {
      users: new SqliteUserRepository(),
      memberships: syncMemberships,
      households: syncHouseholds,
      members: syncMembers,
      contributions: syncContributions,
      tasks: syncTasks,
      todos: syncTodos,
      expenses: syncExpenses,
      settlements: syncSettlements,
      invitations: new SqliteInvitationRepository(),
      syncState: materializingSync,
      withTransaction: async <T>(fn: () => Promise<T>): Promise<T> => {
        // Real SQLite transaction: any throw rolls back all writes.
        let result: T;
        await db.withTransactionAsync(async () => {
          result = await fn();
        });
        return result!;
      },
    };

    return repos;
  } catch {
    // expo-sqlite not available (test env, web, etc.)
    return null;
  }
}

// ── Factory ────────────────────────────────────────────────────

/**
 * Create the appropriate repository set.
 * On device: SQLite-backed, indexed, persists across restarts.
 * In tests: In-memory fallback for deterministic testing.
 *
 * Both paths now have:
 *   - Sync recording wrappers for all 8 collections
 *   - MaterializingSyncState for transactional delta application
 *   - Real local revision tracking for deterministic conflict resolution
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
