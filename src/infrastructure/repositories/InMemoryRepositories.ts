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
  Invitation,
  InvitationStatus,
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

  /** Snapshot internal state for transactional rollback. */
  snapshot(): Map<string, ContributionEntry> {
    return new Map(
      Array.from(this.items.entries()).map(([k, v]) => [
        k,
        { ...v, beneficiaryMemberIds: [...v.beneficiaryMemberIds] },
      ]),
    );
  }

  /** Restore from a snapshot taken before a transaction. */
  restoreFromSnapshot(snap: Map<string, ContributionEntry>): void {
    this.items = new Map(snap);
  }

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
      id: (entry as any).id || generateId('contribution'),
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
      id: (task as any).id || generateId('persistent-task'),
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

  /** Snapshot internal state for transactional rollback. */
  snapshot(): Map<string, TodoItem> {
    return new Map(
      Array.from(this.items.entries()).map(([k, v]) => [
        k,
        { ...v, beneficiaryMemberIds: [...v.beneficiaryMemberIds] },
      ]),
    );
  }

  /** Restore from a snapshot taken before a transaction. */
  restoreFromSnapshot(snap: Map<string, TodoItem>): void {
    this.items = new Map(snap);
  }

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
      id: (todo as any).id || generateId('todo'),
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
      id: (entry as any).id || generateId('expense'),
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
      id: (settlement as any).id || generateId('settlement'),
    };
    this.items.set(created.id, { ...created });
    return created;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

// ── V3-06: InMemory Invitation Repository ──────────────────────

export class InMemoryInvitationRepository implements InvitationRepository {
  private items = new Map<string, Invitation>();

  seed(items: Invitation[]): void {
    for (const inv of items) {
      this.items.set(inv.id, { ...inv });
    }
  }

  async getById(id: string): Promise<Invitation | null> {
    return this.items.get(id) ?? null;
  }

  async getByLinkToken(token: string): Promise<Invitation | null> {
    for (const inv of this.items.values()) {
      if (inv.linkToken === token) return { ...inv };
    }
    return null;
  }

  async getByHousehold(householdId: string): Promise<Invitation[]> {
    return Array.from(this.items.values()).filter((i) => i.householdId === householdId);
  }

  async getPendingByEmail(email: string): Promise<Invitation[]> {
    return Array.from(this.items.values()).filter(
      (i) => i.invitedEmail === email && i.status === 'pending',
    );
  }

  async create(data: Omit<Invitation, 'id' | 'createdAt'>): Promise<Invitation> {
    const invitation: Invitation = {
      ...data,
      id: generateId('invitation'),
      createdAt: new Date().toISOString(),
    };
    this.items.set(invitation.id, { ...invitation });
    return invitation;
  }

  async updateStatus(id: string, status: Invitation['status']): Promise<Invitation> {
    const existing = this.items.get(id);
    if (!existing) throw new Error(`Invitation ${id} not found`);
    const updated = { ...existing, status };
    this.items.set(id, updated);
    return updated;
  }
}

// ── V3-06: InMemory Sync State Repository ──────────────────────

export class InMemorySyncStateRepository implements SyncStateRepository {
  private cursors = new Map<string, SyncCursor>();
  private records = new Map<string, SyncRecord[]>();

  // V3-06 REPAIR: Snapshot/restore for transactional rollback of sync state
  snapshotCursors(): Map<string, SyncCursor> {
    return new Map(
      Array.from(this.cursors.entries()).map(([k, v]) => [k, { ...v }]),
    );
  }

  restoreCursors(snap: Map<string, SyncCursor>): void {
    this.cursors = new Map(snap);
  }

  snapshotRecords(): Map<string, SyncRecord[]> {
    return new Map(
      Array.from(this.records.entries()).map(([k, v]) => [
        k,
        v.map((r) => ({ ...r })),
      ]),
    );
  }

  restoreRecords(snap: Map<string, SyncRecord[]>): void {
    this.records = new Map(snap);
  }

  async getCursor(householdId: string, collection: SyncCollection): Promise<SyncCursor | null> {
    return this.cursors.get(`${householdId}:${collection}`) ?? null;
  }

  async setCursor(cursor: SyncCursor): Promise<void> {
    this.cursors.set(`${cursor.householdId}:${cursor.collection}`, { ...cursor });
  }

  async applyDeltas(
    householdId: string,
    collection: SyncCollection,
    records: SyncRecord[],
    pullCursorToAdvance?: SyncCursor,
  ): Promise<SyncRecord[]> {
    const key = `${householdId}:${collection}`;
    const existing = this.records.get(key) ?? [];
    const applied: SyncRecord[] = [];

    for (const record of records) {
      const idx = existing.findIndex((r) => r.id === record.id);
      if (idx >= 0) {
        existing[idx] = { ...record };
      } else {
        existing.push({ ...record });
      }
      applied.push(record);
    }

    this.records.set(key, existing);

    // V3-06 REPAIR: Advance cursor inside applyDeltas when provided
    if (pullCursorToAdvance) {
      this.cursors.set(
        `${pullCursorToAdvance.householdId}:${pullCursorToAdvance.collection}`,
        { ...pullCursorToAdvance },
      );
    } else {
      // Fallback: advance cursor as before for backward compatibility
      const maxRev = records.reduce((max, r) => Math.max(max, r.revision), 0);
      const prev = this.cursors.get(key);
      this.cursors.set(key, {
        householdId,
        collection,
        lastRevision: Math.max(maxRev, prev?.lastRevision ?? 0),
        lastSyncedAt: new Date().toISOString(),
      });
    }

    return applied;
  }

  async storeLocalRecords(
    householdId: string,
    collection: SyncCollection,
    records: SyncRecord[],
  ): Promise<void> {
    const key = `${householdId}:${collection}`;
    const existing = this.records.get(key) ?? [];

    for (const record of records) {
      const idx = existing.findIndex((r) => r.id === record.id);
      if (idx >= 0) {
        existing[idx] = { ...record };
      } else {
        existing.push({ ...record });
      }
    }

    this.records.set(key, existing);
    // NOTE: cursor is NOT advanced — records still need to be pushed.
  }

  async getDirtyRecords(
    householdId: string,
    collection: SyncCollection,
    sinceRevision: number,
  ): Promise<SyncRecord[]> {
    const key = `${householdId}:${collection}`;
    const existing = this.records.get(key) ?? [];
    return existing.filter((r) => r.revision > sinceRevision);
  }
}
