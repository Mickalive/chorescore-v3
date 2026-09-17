/**
 * ChoreScore V3 — Repository Interfaces
 *
 * Provider-independent contracts for data access.
 * V3 domain entities carry their own unit/currency so history is never reinterpreted.
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

/**
 * Idempotent upsert of full entities with known ids.
 *
 * Used by the demo fixture (canonical ids), tests and future sync
 * reconciliation. Implementations must not duplicate rows when the same
 * id (or unique key) is seeded again.
 */
export interface SeedableRepository<T> {
  seed(items: T[]): Promise<void> | void;
}

export interface UserRepository extends SeedableRepository<User> {
  getById(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  create(data: Omit<User, 'id' | 'createdAt'>): Promise<User>;
  update(id: string, data: Partial<User>): Promise<User>;
  getAll(): Promise<User[]>;
}

export interface MembershipRepository extends SeedableRepository<Membership> {
  getByUser(userId: string): Promise<Membership[]>;
  getByHousehold(householdId: string): Promise<Membership[]>;
  getByUserAndHousehold(userId: string, householdId: string): Promise<Membership | null>;
  create(data: Omit<Membership, 'id' | 'joinedAt'>): Promise<Membership>;
  delete(id: string): Promise<void>;
}

export interface HouseholdRepository extends SeedableRepository<Household> {
  getAll(): Promise<Household[]>;
  getById(id: string): Promise<Household | null>;
  create(data: Omit<Household, 'id' | 'createdAt'>): Promise<Household>;
  update(id: string, data: Partial<Household>): Promise<Household>;
  delete(id: string): Promise<void>;
}

export interface MemberRepository extends SeedableRepository<Member> {
  getByHousehold(householdId: string): Promise<Member[]>;
  getById(id: string): Promise<Member | null>;
  create(data: Omit<Member, 'id' | 'joinedAt'>): Promise<Member>;
}

export interface PaginatedResult<T> {
  items: T[];
  /**
   * Opaque composite cursor encoding `{ o: occurredAt, i: id }` for stable
   * tie-breaking when multiple entries share the same occurredAt.  Null when
   * no more pages exist.
   */
  cursor: string | null;
  hasMore: boolean;
}

export interface PaginatedQuery {
  limit?: number;
  /** Exclusive composite cursor — items strictly older than the encoded position. */
  cursor?: string | null;
  /** Only include entries at or after this timestamp (inclusive). */
  after?: string;
}

export interface ContributionEntryRepository extends SeedableRepository<ContributionEntry> {
  getByHousehold(householdId: string): Promise<ContributionEntry[]>;
  getByHouseholdPaginated(householdId: string, query?: PaginatedQuery): Promise<PaginatedResult<ContributionEntry>>;
  getById(id: string): Promise<ContributionEntry | null>;
  create(entry: Omit<ContributionEntry, 'id'>): Promise<ContributionEntry>;
  update(id: string, data: Partial<ContributionEntry>): Promise<ContributionEntry>;
  delete(id: string): Promise<void>;
}

export interface PersistentTaskRepository extends SeedableRepository<PersistentTask> {
  getByHousehold(householdId: string): Promise<PersistentTask[]>;
  getById(id: string): Promise<PersistentTask | null>;
  create(task: Omit<PersistentTask, 'id' | 'createdAt'>): Promise<PersistentTask>;
  delete(id: string): Promise<void>;
}

export interface TodoRepository extends SeedableRepository<TodoItem> {
  getByHousehold(householdId: string): Promise<TodoItem[]>;
  getById(id: string): Promise<TodoItem | null>;
  create(todo: Omit<TodoItem, 'id' | 'createdAt'>): Promise<TodoItem>;
  update(id: string, data: Partial<TodoItem>): Promise<TodoItem>;
  delete(id: string): Promise<void>;
}

export interface ExpenseEntryRepository extends SeedableRepository<ExpenseEntry> {
  getByHousehold(householdId: string): Promise<ExpenseEntry[]>;
  getByHouseholdPaginated(householdId: string, query?: PaginatedQuery): Promise<PaginatedResult<ExpenseEntry>>;
  getById(id: string): Promise<ExpenseEntry | null>;
  create(entry: Omit<ExpenseEntry, 'id'>): Promise<ExpenseEntry>;
  update(id: string, data: Partial<ExpenseEntry>): Promise<ExpenseEntry>;
  delete(id: string): Promise<void>;
}

export interface SettlementRepository extends SeedableRepository<CrossLedgerSettlement> {
  getByHousehold(householdId: string): Promise<CrossLedgerSettlement[]>;
  getByHouseholdPaginated(householdId: string, query?: PaginatedQuery): Promise<PaginatedResult<CrossLedgerSettlement>>;
  getById(id: string): Promise<CrossLedgerSettlement | null>;
  create(settlement: Omit<CrossLedgerSettlement, 'id'>): Promise<CrossLedgerSettlement>;
  delete(id: string): Promise<void>;
}
