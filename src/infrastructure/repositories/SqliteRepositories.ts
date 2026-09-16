/**
 * ChoreScore V3 — SQLite Repositories
 *
 * Local-first, indexed storage via expo-sqlite.
 * All business data lives in SQLite with proper indexes.
 * UI reads from this local store without network dependency.
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
  ContributionMoneyRate,
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
import { getDatabase, parseJsonArray, toJsonArray } from '../local/SqliteStorage';

let idCounter = 0;
function generateId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Date.now()}`;
}

// ── User Repository ────────────────────────────────────────────

export class SqliteUserRepository implements UserRepository {
  async seed(users: User[]): Promise<void> {
    const db = await getDatabase();
    for (const user of users) {
      await db.runAsync(
        'INSERT OR REPLACE INTO users (id, email, displayName, createdAt) VALUES (?, ?, ?, ?)',
        [user.id, user.email, user.displayName, user.createdAt]
      );
    }
  }

  async getById(id: string): Promise<User | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ id: string; email: string; displayName: string; createdAt: string }>(
      'SELECT * FROM users WHERE id = ?',
      [id]
    );
    if (!row) return null;
    return { id: row.id, email: row.email, displayName: row.displayName, createdAt: row.createdAt };
  }

  async getByEmail(email: string): Promise<User | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ id: string; email: string; displayName: string; createdAt: string }>(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );
    if (!row) return null;
    return { id: row.id, email: row.email, displayName: row.displayName, createdAt: row.createdAt };
  }

  async create(data: Omit<User, 'id' | 'createdAt'>): Promise<User> {
    const db = await getDatabase();
    const user: User = {
      ...data,
      id: generateId('user'),
      createdAt: new Date().toISOString(),
    };
    await db.runAsync(
      'INSERT INTO users (id, email, displayName, createdAt) VALUES (?, ?, ?, ?)',
      [user.id, user.email, user.displayName, user.createdAt]
    );
    return user;
  }

  async update(id: string, data: Partial<User>): Promise<User> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`User ${id} not found`);
    const updated = { ...existing, ...data };
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE users SET email = ?, displayName = ? WHERE id = ?',
      [updated.email, updated.displayName, id]
    );
    return updated;
  }

  async getAll(): Promise<User[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ id: string; email: string; displayName: string; createdAt: string }>(
      'SELECT * FROM users'
    );
    return rows.map((r) => ({ id: r.id, email: r.email, displayName: r.displayName, createdAt: r.createdAt }));
  }
}

// ── Membership Repository ──────────────────────────────────────

export class SqliteMembershipRepository implements MembershipRepository {
  async seed(memberships: Membership[]): Promise<void> {
    const db = await getDatabase();
    for (const m of memberships) {
      await db.runAsync(
        'INSERT OR REPLACE INTO memberships (id, userId, householdId, role, joinedAt) VALUES (?, ?, ?, ?, ?)',
        [m.id, m.userId, m.householdId, m.role, m.joinedAt]
      );
    }
  }

  async getByUser(userId: string): Promise<Membership[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ id: string; userId: string; householdId: string; role: string; joinedAt: string }>(
      'SELECT * FROM memberships WHERE userId = ?',
      [userId]
    );
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      householdId: r.householdId,
      role: r.role as 'MEMBER' | 'OWNER',
      joinedAt: r.joinedAt,
    }));
  }

  async getByHousehold(householdId: string): Promise<Membership[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ id: string; userId: string; householdId: string; role: string; joinedAt: string }>(
      'SELECT * FROM memberships WHERE householdId = ?',
      [householdId]
    );
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      householdId: r.householdId,
      role: r.role as 'MEMBER' | 'OWNER',
      joinedAt: r.joinedAt,
    }));
  }

  async getByUserAndHousehold(userId: string, householdId: string): Promise<Membership | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ id: string; userId: string; householdId: string; role: string; joinedAt: string }>(
      'SELECT * FROM memberships WHERE userId = ? AND householdId = ?',
      [userId, householdId]
    );
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      householdId: row.householdId,
      role: row.role as 'MEMBER' | 'OWNER',
      joinedAt: row.joinedAt,
    };
  }

  async create(data: Omit<Membership, 'id' | 'joinedAt'>): Promise<Membership> {
    const db = await getDatabase();
    const membership: Membership = {
      ...data,
      id: generateId('membership'),
      joinedAt: new Date().toISOString(),
    };
    await db.runAsync(
      'INSERT INTO memberships (id, userId, householdId, role, joinedAt) VALUES (?, ?, ?, ?, ?)',
      [membership.id, membership.userId, membership.householdId, membership.role, membership.joinedAt]
    );
    return membership;
  }

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM memberships WHERE id = ?', [id]);
  }
}

// ── Household Repository ───────────────────────────────────────

export class SqliteHouseholdRepository implements HouseholdRepository {
  async seed(households: Household[]): Promise<void> {
    const db = await getDatabase();
    for (const h of households) {
      await db.runAsync(
        'INSERT OR REPLACE INTO households (id, name, ownerId, contributionUnit, crossLedgerCompensationEnabled, contributionToMoneyRateJson, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          h.id,
          h.name,
          h.ownerId,
          h.contributionUnit,
          h.crossLedgerCompensationEnabled ? 1 : 0,
          h.contributionToMoneyRate ? JSON.stringify(h.contributionToMoneyRate) : null,
          h.createdAt,
        ]
      );
    }
  }

  async getAll(): Promise<Household[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<HouseholdRow>('SELECT * FROM households');
    return rows.map(householdFromRow);
  }

  async getById(id: string): Promise<Household | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<HouseholdRow>('SELECT * FROM households WHERE id = ?', [id]);
    if (!row) return null;
    return householdFromRow(row);
  }

  async create(data: Omit<Household, 'id' | 'createdAt'>): Promise<Household> {
    const db = await getDatabase();
    const household: Household = {
      ...data,
      id: generateId('household'),
      createdAt: new Date().toISOString(),
    };
    await db.runAsync(
      'INSERT INTO households (id, name, ownerId, contributionUnit, crossLedgerCompensationEnabled, contributionToMoneyRateJson, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        household.id,
        household.name,
        household.ownerId,
        household.contributionUnit,
        household.crossLedgerCompensationEnabled ? 1 : 0,
        household.contributionToMoneyRate ? JSON.stringify(household.contributionToMoneyRate) : null,
        household.createdAt,
      ]
    );
    return household;
  }

  async update(id: string, data: Partial<Household>): Promise<Household> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`Household ${id} not found`);
    const updated = { ...existing, ...data };
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE households SET name = ?, ownerId = ?, contributionUnit = ?, crossLedgerCompensationEnabled = ?, contributionToMoneyRateJson = ? WHERE id = ?',
      [
        updated.name,
        updated.ownerId,
        updated.contributionUnit,
        updated.crossLedgerCompensationEnabled ? 1 : 0,
        updated.contributionToMoneyRate ? JSON.stringify(updated.contributionToMoneyRate) : null,
        id,
      ]
    );
    return updated;
  }

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM households WHERE id = ?', [id]);
  }
}

interface HouseholdRow {
  id: string;
  name: string;
  ownerId: string;
  contributionUnit: string;
  crossLedgerCompensationEnabled: number;
  contributionToMoneyRateJson: string | null;
  createdAt: string;
}

function householdFromRow(row: HouseholdRow): Household {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.ownerId,
    contributionUnit: row.contributionUnit as 'minutes' | 'points',
    crossLedgerCompensationEnabled: row.crossLedgerCompensationEnabled === 1,
    contributionToMoneyRate: row.contributionToMoneyRateJson
      ? (JSON.parse(row.contributionToMoneyRateJson) as ContributionMoneyRate)
      : null,
    createdAt: row.createdAt,
  };
}

// ── Member Repository ──────────────────────────────────────────

export class SqliteMemberRepository implements MemberRepository {
  async seed(members: Member[]): Promise<void> {
    const db = await getDatabase();
    for (const m of members) {
      await db.runAsync(
        'INSERT OR REPLACE INTO members (id, householdId, name, userId, joinedAt) VALUES (?, ?, ?, ?, ?)',
        [m.id, m.householdId, m.name, m.userId, m.joinedAt]
      );
    }
  }

  async getByHousehold(householdId: string): Promise<Member[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ id: string; householdId: string; name: string; userId: string; joinedAt: string }>(
      'SELECT * FROM members WHERE householdId = ?',
      [householdId]
    );
    return rows.map((r) => ({
      id: r.id,
      householdId: r.householdId,
      name: r.name,
      userId: r.userId,
      joinedAt: r.joinedAt,
    }));
  }

  async getById(id: string): Promise<Member | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ id: string; householdId: string; name: string; userId: string; joinedAt: string }>(
      'SELECT * FROM members WHERE id = ?',
      [id]
    );
    if (!row) return null;
    return { id: row.id, householdId: row.householdId, name: row.name, userId: row.userId, joinedAt: row.joinedAt };
  }

  async create(data: Omit<Member, 'id' | 'joinedAt'>): Promise<Member> {
    const db = await getDatabase();
    const member: Member = {
      ...data,
      id: generateId('member'),
      joinedAt: new Date().toISOString(),
    };
    await db.runAsync(
      'INSERT INTO members (id, householdId, name, userId, joinedAt) VALUES (?, ?, ?, ?, ?)',
      [member.id, member.householdId, member.name, member.userId, member.joinedAt]
    );
    return member;
  }
}

// ── Contribution Entry Repository ──────────────────────────────

export class SqliteContributionEntryRepository implements ContributionEntryRepository {
  async seed(entries: ContributionEntry[]): Promise<void> {
    const db = await getDatabase();
    for (const entry of entries) {
      await db.runAsync(
        'INSERT OR REPLACE INTO contribution_entries (id, householdId, label, performedByMemberId, beneficiaryMemberIds, value, unit, persistentTaskId, occurredAt, createdBy, modifiedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          entry.id,
          entry.householdId,
          entry.label,
          entry.performedByMemberId,
          toJsonArray(entry.beneficiaryMemberIds),
          entry.value,
          entry.unit,
          entry.persistentTaskId,
          entry.occurredAt,
          entry.createdBy,
          entry.modifiedBy ?? null,
        ]
      );
    }
  }

  async getByHousehold(householdId: string): Promise<ContributionEntry[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<ContributionEntryRow>(
      'SELECT * FROM contribution_entries WHERE householdId = ? ORDER BY occurredAt DESC',
      [householdId]
    );
    return rows.map(contributionFromRow);
  }

  async getByHouseholdPaginated(householdId: string, query: PaginatedQuery = {}): Promise<PaginatedResult<ContributionEntry>> {
    const limit = query.limit ?? 20;
    const db = await getDatabase();

    let sql = 'SELECT * FROM contribution_entries WHERE householdId = ?';
    const params: (string | number)[] = [householdId];

    if (query.after) {
      sql += ' AND occurredAt >= ?';
      params.push(query.after);
    }

    if (query.cursor) {
      sql += ' AND occurredAt < ?';
      params.push(query.cursor);
    }

    sql += ' ORDER BY occurredAt DESC LIMIT ?';
    params.push(limit + 1); // fetch one extra to detect hasMore

    const rows = await db.getAllAsync<ContributionEntryRow>(sql, params);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(contributionFromRow);
    const cursor = hasMore && items.length > 0 ? items[items.length - 1].occurredAt : null;

    return { items, cursor, hasMore };
  }

  async getById(id: string): Promise<ContributionEntry | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ContributionEntryRow>(
      'SELECT * FROM contribution_entries WHERE id = ?',
      [id]
    );
    if (!row) return null;
    return contributionFromRow(row);
  }

  async create(entry: Omit<ContributionEntry, 'id'>): Promise<ContributionEntry> {
    const db = await getDatabase();
    const created: ContributionEntry = {
      ...entry,
      id: generateId('contribution'),
    };
    await db.runAsync(
      'INSERT INTO contribution_entries (id, householdId, label, performedByMemberId, beneficiaryMemberIds, value, unit, persistentTaskId, occurredAt, createdBy, modifiedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        created.id,
        created.householdId,
        created.label,
        created.performedByMemberId,
        toJsonArray(created.beneficiaryMemberIds),
        created.value,
        created.unit,
        created.persistentTaskId,
        created.occurredAt,
        created.createdBy,
        created.modifiedBy ?? null,
      ]
    );
    return created;
  }

  async update(id: string, data: Partial<ContributionEntry>): Promise<ContributionEntry> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`ContributionEntry ${id} not found`);
    const updated = { ...existing, ...data };
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE contribution_entries SET label = ?, performedByMemberId = ?, beneficiaryMemberIds = ?, value = ?, unit = ?, persistentTaskId = ?, occurredAt = ?, modifiedBy = ? WHERE id = ?',
      [
        updated.label,
        updated.performedByMemberId,
        toJsonArray(updated.beneficiaryMemberIds),
        updated.value,
        updated.unit,
        updated.persistentTaskId,
        updated.occurredAt,
        updated.modifiedBy ?? null,
        id,
      ]
    );
    return updated;
  }

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM contribution_entries WHERE id = ?', [id]);
  }
}

interface ContributionEntryRow {
  id: string;
  householdId: string;
  label: string;
  performedByMemberId: string;
  beneficiaryMemberIds: string;
  value: number;
  unit: string;
  persistentTaskId: string | null;
  occurredAt: string;
  createdBy: string;
  modifiedBy: string | null;
}

function contributionFromRow(row: ContributionEntryRow): ContributionEntry {
  return {
    id: row.id,
    householdId: row.householdId,
    label: row.label,
    performedByMemberId: row.performedByMemberId,
    beneficiaryMemberIds: parseJsonArray<string>(row.beneficiaryMemberIds),
    value: row.value,
    unit: row.unit as 'minutes' | 'points',
    persistentTaskId: row.persistentTaskId,
    occurredAt: row.occurredAt,
    createdBy: row.createdBy,
    modifiedBy: row.modifiedBy ?? undefined,
  };
}

// ── Persistent Task Repository ─────────────────────────────────

export class SqlitePersistentTaskRepository implements PersistentTaskRepository {
  async seed(tasks: PersistentTask[]): Promise<void> {
    const db = await getDatabase();
    for (const task of tasks) {
      await db.runAsync(
        'INSERT OR REPLACE INTO persistent_tasks (id, householdId, name, defaultValue, defaultUnit, defaultBeneficiaryMemberIds, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          task.id,
          task.householdId,
          task.name,
          task.defaultValue,
          task.defaultUnit,
          task.defaultBeneficiaryMemberIds ? toJsonArray(task.defaultBeneficiaryMemberIds) : null,
          task.createdAt,
        ]
      );
    }
  }

  async getByHousehold(householdId: string): Promise<PersistentTask[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<PersistentTaskRow>(
      'SELECT * FROM persistent_tasks WHERE householdId = ?',
      [householdId]
    );
    return rows.map(taskFromRow);
  }

  async getById(id: string): Promise<PersistentTask | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<PersistentTaskRow>(
      'SELECT * FROM persistent_tasks WHERE id = ?',
      [id]
    );
    if (!row) return null;
    return taskFromRow(row);
  }

  async create(task: Omit<PersistentTask, 'id' | 'createdAt'>): Promise<PersistentTask> {
    const db = await getDatabase();
    const created: PersistentTask = {
      ...task,
      id: generateId('persistent-task'),
      createdAt: new Date().toISOString(),
    };
    await db.runAsync(
      'INSERT INTO persistent_tasks (id, householdId, name, defaultValue, defaultUnit, defaultBeneficiaryMemberIds, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        created.id,
        created.householdId,
        created.name,
        created.defaultValue,
        created.defaultUnit,
        created.defaultBeneficiaryMemberIds ? toJsonArray(created.defaultBeneficiaryMemberIds) : null,
        created.createdAt,
      ]
    );
    return created;
  }

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM persistent_tasks WHERE id = ?', [id]);
  }
}

interface PersistentTaskRow {
  id: string;
  householdId: string;
  name: string;
  defaultValue: number;
  defaultUnit: string;
  defaultBeneficiaryMemberIds: string | null;
  createdAt: string;
}

function taskFromRow(row: PersistentTaskRow): PersistentTask {
  return {
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    defaultValue: row.defaultValue,
    defaultUnit: row.defaultUnit as 'minutes' | 'points',
    defaultBeneficiaryMemberIds: row.defaultBeneficiaryMemberIds
      ? parseJsonArray<string>(row.defaultBeneficiaryMemberIds)
      : undefined,
    createdAt: row.createdAt,
  };
}

// ── Todo Repository ────────────────────────────────────────────

export class SqliteTodoRepository implements TodoRepository {
  async seed(todos: TodoItem[]): Promise<void> {
    const db = await getDatabase();
    for (const todo of todos) {
      await db.runAsync(
        'INSERT OR REPLACE INTO todo_items (id, householdId, title, assigneeMemberId, beneficiaryMemberIds, dueAt, reminderAt, notes, persistentTaskId, status, createdAt, completedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          todo.id,
          todo.householdId,
          todo.title,
          todo.assigneeMemberId,
          toJsonArray(todo.beneficiaryMemberIds),
          todo.dueAt,
          todo.reminderAt,
          todo.notes,
          todo.persistentTaskId,
          todo.status,
          todo.createdAt,
          todo.completedAt ?? null,
        ]
      );
    }
  }

  async getByHousehold(householdId: string): Promise<TodoItem[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<TodoRow>(
      'SELECT * FROM todo_items WHERE householdId = ? ORDER BY createdAt DESC',
      [householdId]
    );
    return rows.map(todoFromRow);
  }

  async getById(id: string): Promise<TodoItem | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<TodoRow>('SELECT * FROM todo_items WHERE id = ?', [id]);
    if (!row) return null;
    return todoFromRow(row);
  }

  async create(todo: Omit<TodoItem, 'id' | 'createdAt'>): Promise<TodoItem> {
    const db = await getDatabase();
    const created: TodoItem = {
      ...todo,
      id: generateId('todo'),
      createdAt: new Date().toISOString(),
    };
    await db.runAsync(
      'INSERT INTO todo_items (id, householdId, title, assigneeMemberId, beneficiaryMemberIds, dueAt, reminderAt, notes, persistentTaskId, status, createdAt, completedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        created.id,
        created.householdId,
        created.title,
        created.assigneeMemberId,
        toJsonArray(created.beneficiaryMemberIds),
        created.dueAt,
        created.reminderAt,
        created.notes,
        created.persistentTaskId,
        created.status,
        created.createdAt,
        created.completedAt ?? null,
      ]
    );
    return created;
  }

  async update(id: string, data: Partial<TodoItem>): Promise<TodoItem> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`Todo ${id} not found`);
    const updated = { ...existing, ...data };
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE todo_items SET title = ?, assigneeMemberId = ?, beneficiaryMemberIds = ?, dueAt = ?, reminderAt = ?, notes = ?, persistentTaskId = ?, status = ?, completedAt = ? WHERE id = ?',
      [
        updated.title,
        updated.assigneeMemberId,
        toJsonArray(updated.beneficiaryMemberIds),
        updated.dueAt,
        updated.reminderAt,
        updated.notes,
        updated.persistentTaskId,
        updated.status,
        updated.completedAt ?? null,
        id,
      ]
    );
    return updated;
  }

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM todo_items WHERE id = ?', [id]);
  }
}

interface TodoRow {
  id: string;
  householdId: string;
  title: string;
  assigneeMemberId: string | null;
  beneficiaryMemberIds: string;
  dueAt: string | null;
  reminderAt: string | null;
  notes: string;
  persistentTaskId: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

function todoFromRow(row: TodoRow): TodoItem {
  return {
    id: row.id,
    householdId: row.householdId,
    title: row.title,
    assigneeMemberId: row.assigneeMemberId,
    beneficiaryMemberIds: parseJsonArray<string>(row.beneficiaryMemberIds),
    dueAt: row.dueAt,
    reminderAt: row.reminderAt,
    notes: row.notes,
    persistentTaskId: row.persistentTaskId,
    status: row.status as 'todo' | 'in-progress' | 'completed',
    createdAt: row.createdAt,
    completedAt: row.completedAt ?? undefined,
  };
}

// ── Expense Entry Repository ───────────────────────────────────

export class SqliteExpenseEntryRepository implements ExpenseEntryRepository {
  async seed(entries: ExpenseEntry[]): Promise<void> {
    const db = await getDatabase();
    for (const entry of entries) {
      await db.runAsync(
        'INSERT OR REPLACE INTO expense_entries (id, householdId, title, amountMinor, currency, paidByMemberId, participantMemberIds, splitMode, customSharesJson, note, category, occurredAt, createdBy, modifiedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          entry.id,
          entry.householdId,
          entry.title,
          entry.amountMinor,
          entry.currency,
          entry.paidByMemberId,
          toJsonArray(entry.participantMemberIds),
          entry.splitMode,
          entry.customShares ? toJsonArray(entry.customShares) : null,
          entry.note ?? null,
          entry.category ?? null,
          entry.occurredAt,
          entry.createdBy,
          entry.modifiedBy ?? null,
        ]
      );
    }
  }

  async getByHousehold(householdId: string): Promise<ExpenseEntry[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<ExpenseEntryRow>(
      'SELECT * FROM expense_entries WHERE householdId = ? ORDER BY occurredAt DESC',
      [householdId]
    );
    return rows.map(expenseFromRow);
  }

  async getByHouseholdPaginated(householdId: string, query: PaginatedQuery = {}): Promise<PaginatedResult<ExpenseEntry>> {
    const limit = query.limit ?? 20;
    const db = await getDatabase();

    let sql = 'SELECT * FROM expense_entries WHERE householdId = ?';
    const params: (string | number)[] = [householdId];

    if (query.after) {
      sql += ' AND occurredAt >= ?';
      params.push(query.after);
    }

    if (query.cursor) {
      sql += ' AND occurredAt < ?';
      params.push(query.cursor);
    }

    sql += ' ORDER BY occurredAt DESC LIMIT ?';
    params.push(limit + 1);

    const rows = await db.getAllAsync<ExpenseEntryRow>(sql, params);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(expenseFromRow);
    const cursor = hasMore && items.length > 0 ? items[items.length - 1].occurredAt : null;

    return { items, cursor, hasMore };
  }

  async getById(id: string): Promise<ExpenseEntry | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<ExpenseEntryRow>(
      'SELECT * FROM expense_entries WHERE id = ?',
      [id]
    );
    if (!row) return null;
    return expenseFromRow(row);
  }

  async create(entry: Omit<ExpenseEntry, 'id'>): Promise<ExpenseEntry> {
    const db = await getDatabase();
    const created: ExpenseEntry = {
      ...entry,
      id: generateId('expense'),
    };
    await db.runAsync(
      'INSERT INTO expense_entries (id, householdId, title, amountMinor, currency, paidByMemberId, participantMemberIds, splitMode, customSharesJson, note, category, occurredAt, createdBy, modifiedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        created.id,
        created.householdId,
        created.title,
        created.amountMinor,
        created.currency,
        created.paidByMemberId,
        toJsonArray(created.participantMemberIds),
        created.splitMode,
        created.customShares ? toJsonArray(created.customShares) : null,
        created.note ?? null,
        created.category ?? null,
        created.occurredAt,
        created.createdBy,
        created.modifiedBy ?? null,
      ]
    );
    return created;
  }

  async update(id: string, data: Partial<ExpenseEntry>): Promise<ExpenseEntry> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`ExpenseEntry ${id} not found`);
    const updated = { ...existing, ...data };
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE expense_entries SET title = ?, amountMinor = ?, currency = ?, paidByMemberId = ?, participantMemberIds = ?, splitMode = ?, customSharesJson = ?, note = ?, category = ?, occurredAt = ?, modifiedBy = ? WHERE id = ?',
      [
        updated.title,
        updated.amountMinor,
        updated.currency,
        updated.paidByMemberId,
        toJsonArray(updated.participantMemberIds),
        updated.splitMode,
        updated.customShares ? toJsonArray(updated.customShares) : null,
        updated.note ?? null,
        updated.category ?? null,
        updated.occurredAt,
        updated.modifiedBy ?? null,
        id,
      ]
    );
    return updated;
  }

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM expense_entries WHERE id = ?', [id]);
  }
}

interface ExpenseEntryRow {
  id: string;
  householdId: string;
  title: string;
  amountMinor: number;
  currency: string;
  paidByMemberId: string;
  participantMemberIds: string;
  splitMode: string;
  customSharesJson: string | null;
  note: string | null;
  category: string | null;
  occurredAt: string;
  createdBy: string;
  modifiedBy: string | null;
}

function expenseFromRow(row: ExpenseEntryRow): ExpenseEntry {
  return {
    id: row.id,
    householdId: row.householdId,
    title: row.title,
    amountMinor: row.amountMinor,
    currency: row.currency,
    paidByMemberId: row.paidByMemberId,
    participantMemberIds: parseJsonArray<string>(row.participantMemberIds),
    splitMode: row.splitMode as 'equal' | 'custom',
    customShares: row.customSharesJson ? parseJsonArray(row.customSharesJson) : undefined,
    note: row.note ?? undefined,
    category: row.category ?? undefined,
    occurredAt: row.occurredAt,
    createdBy: row.createdBy,
    modifiedBy: row.modifiedBy ?? undefined,
  };
}

// ── Settlement Repository ──────────────────────────────────────

export class SqliteSettlementRepository implements SettlementRepository {
  async seed(settlements: CrossLedgerSettlement[]): Promise<void> {
    const db = await getDatabase();
    for (const settlement of settlements) {
      await db.runAsync(
        'INSERT OR REPLACE INTO settlements (id, householdId, contributionCreditorMemberId, counterpartyMemberId, contributionValue, contributionUnit, moneyAmountMinor, currency, rateSnapshotJson, occurredAt, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          settlement.id,
          settlement.householdId,
          settlement.contributionCreditorMemberId,
          settlement.counterpartyMemberId,
          settlement.contributionValue,
          settlement.contributionUnit,
          settlement.moneyAmountMinor,
          settlement.currency,
          JSON.stringify(settlement.rateSnapshot),
          settlement.occurredAt,
          settlement.createdBy,
        ]
      );
    }
  }

  async getByHousehold(householdId: string): Promise<CrossLedgerSettlement[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<SettlementRow>(
      'SELECT * FROM settlements WHERE householdId = ? ORDER BY occurredAt DESC',
      [householdId]
    );
    return rows.map(settlementFromRow);
  }

  async getByHouseholdPaginated(householdId: string, query: PaginatedQuery = {}): Promise<PaginatedResult<CrossLedgerSettlement>> {
    const limit = query.limit ?? 20;
    const db = await getDatabase();

    let sql = 'SELECT * FROM settlements WHERE householdId = ?';
    const params: (string | number)[] = [householdId];

    if (query.after) {
      sql += ' AND occurredAt >= ?';
      params.push(query.after);
    }

    if (query.cursor) {
      sql += ' AND occurredAt < ?';
      params.push(query.cursor);
    }

    sql += ' ORDER BY occurredAt DESC LIMIT ?';
    params.push(limit + 1);

    const rows = await db.getAllAsync<SettlementRow>(sql, params);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(settlementFromRow);
    const cursor = hasMore && items.length > 0 ? items[items.length - 1].occurredAt : null;

    return { items, cursor, hasMore };
  }

  async getById(id: string): Promise<CrossLedgerSettlement | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<SettlementRow>(
      'SELECT * FROM settlements WHERE id = ?',
      [id]
    );
    if (!row) return null;
    return settlementFromRow(row);
  }

  async create(settlement: Omit<CrossLedgerSettlement, 'id'>): Promise<CrossLedgerSettlement> {
    const db = await getDatabase();
    const created: CrossLedgerSettlement = {
      ...settlement,
      id: generateId('settlement'),
    };
    await db.runAsync(
      'INSERT INTO settlements (id, householdId, contributionCreditorMemberId, counterpartyMemberId, contributionValue, contributionUnit, moneyAmountMinor, currency, rateSnapshotJson, occurredAt, createdBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        created.id,
        created.householdId,
        created.contributionCreditorMemberId,
        created.counterpartyMemberId,
        created.contributionValue,
        created.contributionUnit,
        created.moneyAmountMinor,
        created.currency,
        JSON.stringify(created.rateSnapshot),
        created.occurredAt,
        created.createdBy,
      ]
    );
    return created;
  }

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM settlements WHERE id = ?', [id]);
  }
}

interface SettlementRow {
  id: string;
  householdId: string;
  contributionCreditorMemberId: string;
  counterpartyMemberId: string;
  contributionValue: number;
  contributionUnit: string;
  moneyAmountMinor: number;
  currency: string;
  rateSnapshotJson: string;
  occurredAt: string;
  createdBy: string;
}

function settlementFromRow(row: SettlementRow): CrossLedgerSettlement {
  return {
    id: row.id,
    householdId: row.householdId,
    contributionCreditorMemberId: row.contributionCreditorMemberId,
    counterpartyMemberId: row.counterpartyMemberId,
    contributionValue: row.contributionValue,
    contributionUnit: row.contributionUnit as 'minutes' | 'points',
    moneyAmountMinor: row.moneyAmountMinor,
    currency: row.currency,
    rateSnapshot: JSON.parse(row.rateSnapshotJson) as ContributionMoneyRate,
    occurredAt: row.occurredAt,
    createdBy: row.createdBy,
  };
}
