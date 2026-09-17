/**
 * ChoreScore V3 — Repository Factory
 *
 * Provides SQLite-backed repositories on device with in-memory fallback for tests.
 * Business data is persisted in the indexed local store and survives restarts.
 * Navigation reads from local state without any cloud dependency.
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
} from './InMemoryRepositories';

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

function createInMemoryRepositories(): AllRepositories {
  const todoRepo = new InMemoryTodoRepository();
  const contributionRepo = new InMemoryContributionEntryRepository();

  return {
    users: new InMemoryUserRepository(),
    memberships: new InMemoryMembershipRepository(),
    households: new InMemoryHouseholdRepository(),
    members: new InMemoryMemberRepository(),
    contributions: contributionRepo,
    tasks: new InMemoryPersistentTaskRepository(),
    todos: todoRepo,
    expenses: new InMemoryExpenseEntryRepository(),
    settlements: new InMemorySettlementRepository(),
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
