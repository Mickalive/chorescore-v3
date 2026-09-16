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
}

/**
 * Detect whether we are running in a test environment.
 * In tests, SQLite is not available (no native modules), so we use in-memory.
 */
function isTestEnvironment(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    (globalThis as Record<string, unknown>).__TEST__ === true
  );
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
    await getDatabase();

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
    };
  } catch {
    // expo-sqlite not available (test env, web, etc.)
    return null;
  }
}

function createInMemoryRepositories(): AllRepositories {
  return {
    users: new InMemoryUserRepository(),
    memberships: new InMemoryMembershipRepository(),
    households: new InMemoryHouseholdRepository(),
    members: new InMemoryMemberRepository(),
    contributions: new InMemoryContributionEntryRepository(),
    tasks: new InMemoryPersistentTaskRepository(),
    todos: new InMemoryTodoRepository(),
    expenses: new InMemoryExpenseEntryRepository(),
    settlements: new InMemorySettlementRepository(),
  };
}

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
