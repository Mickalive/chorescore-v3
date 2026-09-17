/**
 * ChoreScore V3 — In-Memory Repositories
 *
 * Used for testing and as a fallback when SQLite is not available.
 * Each repository generates deterministic IDs for testability.
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
  PaginatedResult,
  PaginatedQuery,
} from './index';

let idCounter = 0;
function generateId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Date.now()}`;
}

export class InMemoryUserRepository implements UserRepository {
  private items = new Map<string, User>();

  seed(users: User[]): void {
    for (const user of users) {
      this.items.set(user.id, { ...user });
    }
  }

  async getById(id: string): Promise<User | null> {
    return this.items.get(id) ?? null;
  }

  async getByEmail(email: string): Promise<User | null> {
    for (const user of this.items.values()) {
      if (user.email === email) return { ...user };
    }
    return null;
  }

  async create(data: Omit<User, 'id' | 'createdAt'>): Promise<User> {
    const user: User = {
      ...data,
      id: generateId('user'),
      createdAt: new Date().toISOString(),
    };
    this.items.set(user.id, { ...user });
    return user;
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`User ${id} not found`);
    const updated = { ...existing, ...data };
    this.items.set(id, updated);
    return updated;
  }

  async getAll(): Promise<User[]> {
    return Array.from(this.items.values());
  }
}

export class InMemoryMembershipRepository implements MembershipRepository {
  private items = new Map<string, Membership>();

  seed(memberships: Membership[]): void {
    for (const m of memberships) {
      this.items.set(m.id, { ...m });
    }
  }

  async getByUser(userId: string): Promise<Membership[]> {
    return Array.from(this.items.values()).filter((m) => m.userId === userId);
  }

  async getByHousehold(householdId: string): Promise<Membership[]> {
    return Array.from(this.items.values()).filter((m) => m.householdId === householdId);
  }

  async getByUserAndHousehold(userId: string, householdId: string): Promise<Membership | null> {
    for (const m of this.items.values()) {
      if (m.userId === userId && m.householdId === householdId) return { ...m };
    }
    return null;
  }

  async create(data: Omit<Membership, 'id' | 'joinedAt'>): Promise<Membership> {
    const membership: Membership = {
      ...data,
      id: generateId('membership'),
      joinedAt: new Date().toISOString(),
    };
    this.items.set(membership.id, { ...membership });
    return membership;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class InMemoryHouseholdRepository implements HouseholdRepository {
  private items = new Map<string, Household>();

  seed(households: Household[]): void {
    for (const h of households) {
      this.items.set(h.id, { ...h });
    }
  }

  async getAll(): Promise<Household[]> {
    return Array.from(this.items.values());
  }

  async getById(id: string): Promise<Household | null> {
    return this.items.get(id) ?? null;
  }

  async create(data: Omit<Household, 'id' | 'createdAt'>): Promise<Household> {
    const household: Household = {
      ...data,
      id: generateId('household'),
      createdAt: new Date().toISOString(),
    };
    this.items.set(household.id, { ...household });
    return household;
  }

  async update(id: string, data: Partial<Household>): Promise<Household> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Household ${id} not found`);
    const updated = { ...existing, ...data };
    this.items.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class InMemoryMemberRepository implements MemberRepository {
  private items = new Map<string, Member>();

  seed(members: Member[]): void {
    for (const m of members) {
      this.items.set(m.id, { ...m });
    }
  }

  async getByHousehold(householdId: string): Promise<Member[]> {
    return Array.from(this.items.values()).filter((m) => m.householdId === householdId);
  }

  async getById(id: string): Promise<Member | null> {
    return this.items.get(id) ?? null;
  }

  async create(data: Omit<Member, 'id' | 'joinedAt'>): Promise<Member> {
    const member: Member = {
      ...data,
      id: generateId('member'),
      joinedAt: new Date().toISOString(),
    };
    this.items.set(member.id, { ...member });
    return member;
  }
}

export class InMemoryContributionEntryRepository implements ContributionEntryRepository {
  private items = new Map<string, ContributionEntry>();

  seed(entries: ContributionEntry[]): void {
    for (const e of entries) {
      this.items.set(e.id, { ...e });
    }
  }

  async getByHousehold(householdId: string): Promise<ContributionEntry[]> {
    return Array.from(this.items.values()).filter((e) => e.householdId === householdId);
  }

  async getByHouseholdPaginated(householdId: string, query: PaginatedQuery = {}): Promise<PaginatedResult<ContributionEntry>> {
    const limit = query.limit ?? 20;
    let items = Array.from(this.items.values())
      .filter((e) => e.householdId === householdId);

    // Apply after filter (inclusive)
    if (query.after) {
      items = items.filter((e) => e.occurredAt >= query.after!);
    }

    // Sort by occurredAt DESC, then id DESC for deterministic tie-breaking
    items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));

    // Apply composite cursor (exclusive): (occurredAt < c.o OR (occurredAt = c.o AND id < c.i))
    let start = 0;
    if (query.cursor) {
      const c = JSON.parse(query.cursor!) as { o: string; i: string };
      start = items.findIndex(
        (e) => e.occurredAt < c.o || (e.occurredAt === c.o && e.id < c.i)
      );
      if (start === -1) {
        return { items: [], cursor: null, hasMore: false };
      }
    }

    const page = items.slice(start, start + limit);
    const last = page.length > 0 ? page[page.length - 1] : null;
    const nextCursor = page.length === limit && last ? JSON.stringify({ o: last.occurredAt, i: last.id }) : null;
    const hasMore = page.length === limit && start + limit < items.length;

    return { items: page, cursor: nextCursor, hasMore };
  }

  async getById(id: string): Promise<ContributionEntry | null> {
    return this.items.get(id) ?? null;
  }

  async create(entry: Omit<ContributionEntry, 'id'>): Promise<ContributionEntry> {
    const created: ContributionEntry = {
      ...entry,
      id: generateId('contribution'),
    };
    this.items.set(created.id, { ...created });
    return created;
  }

  async update(id: string, data: Partial<ContributionEntry>): Promise<ContributionEntry> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`ContributionEntry ${id} not found`);
    const updated = { ...existing, ...data };
    this.items.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class InMemoryPersistentTaskRepository implements PersistentTaskRepository {
  private items = new Map<string, PersistentTask>();

  seed(tasks: PersistentTask[]): void {
    for (const t of tasks) {
      this.items.set(t.id, { ...t });
    }
  }

  async getByHousehold(householdId: string): Promise<PersistentTask[]> {
    return Array.from(this.items.values()).filter((t) => t.householdId === householdId);
  }

  async getById(id: string): Promise<PersistentTask | null> {
    return this.items.get(id) ?? null;
  }

  async create(task: Omit<PersistentTask, 'id' | 'createdAt'>): Promise<PersistentTask> {
    const created: PersistentTask = {
      ...task,
      id: generateId('persistent-task'),
      createdAt: new Date().toISOString(),
    };
    this.items.set(created.id, { ...created });
    return created;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class InMemoryTodoRepository implements TodoRepository {
  private items = new Map<string, TodoItem>();

  seed(todos: TodoItem[]): void {
    for (const t of todos) {
      this.items.set(t.id, { ...t });
    }
  }

  async getByHousehold(householdId: string): Promise<TodoItem[]> {
    return Array.from(this.items.values()).filter((t) => t.householdId === householdId);
  }

  async getById(id: string): Promise<TodoItem | null> {
    return this.items.get(id) ?? null;
  }

  async create(todo: Omit<TodoItem, 'id' | 'createdAt'>): Promise<TodoItem> {
    const created: TodoItem = {
      ...todo,
      id: generateId('todo'),
      createdAt: new Date().toISOString(),
    };
    this.items.set(created.id, { ...created });
    return created;
  }

  async update(id: string, data: Partial<TodoItem>): Promise<TodoItem> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Todo ${id} not found`);
    const updated = { ...existing, ...data };
    this.items.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class InMemoryExpenseEntryRepository implements ExpenseEntryRepository {
  private items = new Map<string, ExpenseEntry>();

  seed(entries: ExpenseEntry[]): void {
    for (const e of entries) {
      this.items.set(e.id, { ...e });
    }
  }

  async getByHousehold(householdId: string): Promise<ExpenseEntry[]> {
    return Array.from(this.items.values()).filter((e) => e.householdId === householdId);
  }

  async getByHouseholdPaginated(householdId: string, query: PaginatedQuery = {}): Promise<PaginatedResult<ExpenseEntry>> {
    const limit = query.limit ?? 20;
    let items = Array.from(this.items.values())
      .filter((e) => e.householdId === householdId);

    if (query.after) {
      items = items.filter((e) => e.occurredAt >= query.after!);
    }

    // Sort by occurredAt DESC, then id DESC for deterministic tie-breaking
    items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));

    // Apply composite cursor (exclusive)
    let start = 0;
    if (query.cursor) {
      const c = JSON.parse(query.cursor!) as { o: string; i: string };
      start = items.findIndex(
        (e) => e.occurredAt < c.o || (e.occurredAt === c.o && e.id < c.i)
      );
      if (start === -1) {
        return { items: [], cursor: null, hasMore: false };
      }
    }

    const page = items.slice(start, start + limit);
    const last = page.length > 0 ? page[page.length - 1] : null;
    const nextCursor = page.length === limit && last ? JSON.stringify({ o: last.occurredAt, i: last.id }) : null;
    const hasMore = page.length === limit && start + limit < items.length;

    return { items: page, cursor: nextCursor, hasMore };
  }

  async getById(id: string): Promise<ExpenseEntry | null> {
    return this.items.get(id) ?? null;
  }

  async create(entry: Omit<ExpenseEntry, 'id'>): Promise<ExpenseEntry> {
    const created: ExpenseEntry = {
      ...entry,
      id: generateId('expense'),
    };
    this.items.set(created.id, { ...created });
    return created;
  }

  async update(id: string, data: Partial<ExpenseEntry>): Promise<ExpenseEntry> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`ExpenseEntry ${id} not found`);
    const updated = { ...existing, ...data };
    this.items.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class InMemorySettlementRepository implements SettlementRepository {
  private items = new Map<string, CrossLedgerSettlement>();

  seed(settlements: CrossLedgerSettlement[]): void {
    for (const s of settlements) {
      this.items.set(s.id, { ...s });
    }
  }

  async getByHousehold(householdId: string): Promise<CrossLedgerSettlement[]> {
    return Array.from(this.items.values()).filter((s) => s.householdId === householdId);
  }

  async getByHouseholdPaginated(householdId: string, query: PaginatedQuery = {}): Promise<PaginatedResult<CrossLedgerSettlement>> {
    const limit = query.limit ?? 20;
    let items = Array.from(this.items.values())
      .filter((s) => s.householdId === householdId);

    if (query.after) {
      items = items.filter((s) => s.occurredAt >= query.after!);
    }

    // Sort by occurredAt DESC, then id DESC for deterministic tie-breaking
    items.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));

    // Apply composite cursor (exclusive)
    let start = 0;
    if (query.cursor) {
      const c = JSON.parse(query.cursor!) as { o: string; i: string };
      start = items.findIndex(
        (s) => s.occurredAt < c.o || (s.occurredAt === c.o && s.id < c.i)
      );
      if (start === -1) {
        return { items: [], cursor: null, hasMore: false };
      }
    }

    const page = items.slice(start, start + limit);
    const last = page.length > 0 ? page[page.length - 1] : null;
    const nextCursor = page.length === limit && last ? JSON.stringify({ o: last.occurredAt, i: last.id }) : null;
    const hasMore = page.length === limit && start + limit < items.length;

    return { items: page, cursor: nextCursor, hasMore };
  }

  async getById(id: string): Promise<CrossLedgerSettlement | null> {
    return this.items.get(id) ?? null;
  }

  async create(settlement: Omit<CrossLedgerSettlement, 'id'>): Promise<CrossLedgerSettlement> {
    const created: CrossLedgerSettlement = {
      ...settlement,
      id: generateId('settlement'),
    };
    this.items.set(created.id, { ...created });
    return created;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}
