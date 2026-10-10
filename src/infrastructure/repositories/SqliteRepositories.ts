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
  Category,
  Attachment,
  ContributionEntry,
  PersistentTask,
  TodoItem,
  ExpenseEntry,
  CrossLedgerSettlement,
  ContributionMoneyRate,
  Invitation,
  InvitationStatus,
  TaskSplitWeight,
  SyncCursor,
  SyncRecord,
  SyncCollection,
} from '../../domain/entities';
import {
  UserRepository,
  MembershipRepository,
  HouseholdRepository,
  MemberRepository,
  CategoryRepository,
  CategoryUpdate,
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
import { getDatabase, parseJsonArray, toJsonArray } from '../local/SqliteStorage';

let idCounter = 0;
function generateId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${Date.now()}`;
}

/**
 * V4-01 — named vs linked members.
 *
 * The `members` table historically has `userId TEXT NOT NULL`, so a V3 install
 * cannot receive a NULL column without a table rebuild. A named member (a name
 * typed at group creation, no account yet) is therefore stored as `''` and read
 * back as `null`; a linked member keeps its real user id untouched. The domain
 * never sees the encoding: `memberIdentityKind` only ever sees `null | userId`.
 */
function encodeMemberUserId(userId: string | null | undefined): string {
  return userId ?? '';
}

function decodeMemberUserId(userId: string | null | undefined): string | null {
  return userId === null || userId === undefined || userId === '' ? null : userId;
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
        [m.id, m.householdId, m.name, encodeMemberUserId(m.userId), m.joinedAt]
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
      userId: decodeMemberUserId(r.userId),
      joinedAt: r.joinedAt,
    }));
  }

  async getByHouseholdPaginated(householdId: string, query: PaginatedQuery = {}): Promise<PaginatedResult<Member>> {
    const limit = query.limit ?? 20;
    const db = await getDatabase();

    let sql = 'SELECT * FROM members WHERE householdId = ?';
    const params: (string | number)[] = [householdId];

    if (query.after) {
      sql += ' AND joinedAt >= ?';
      params.push(query.after);
    }

    if (query.cursor) {
      const c = JSON.parse(query.cursor!) as { o: string; i: string };
      sql += ' AND (joinedAt < ? OR (joinedAt = ? AND id < ?))';
      params.push(c.o, c.o, c.i);
    }

    sql += ' ORDER BY joinedAt DESC, id DESC LIMIT ?';
    params.push(limit + 1); // fetch one extra to detect hasMore

    const rows = await db.getAllAsync<{ id: string; householdId: string; name: string; userId: string; joinedAt: string }>(sql, params);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => ({
      id: r.id,
      householdId: r.householdId,
      name: r.name,
      userId: decodeMemberUserId(r.userId),
      joinedAt: r.joinedAt,
    }));
    const last = items.length > 0 ? items[items.length - 1] : null;
    const cursor = hasMore && last ? JSON.stringify({ o: last.joinedAt, i: last.id }) : null;

    return { items, cursor, hasMore };
  }

  async getById(id: string): Promise<Member | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ id: string; householdId: string; name: string; userId: string; joinedAt: string }>(
      'SELECT * FROM members WHERE id = ?',
      [id]
    );
    if (!row) return null;
    return {
      id: row.id,
      householdId: row.householdId,
      name: row.name,
      userId: decodeMemberUserId(row.userId),
      joinedAt: row.joinedAt,
    };
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
      [member.id, member.householdId, member.name, encodeMemberUserId(member.userId), member.joinedAt]
    );
    return member;
  }

  async update(id: string, data: Partial<Member>): Promise<Member> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`Member ${id} not found`);
    const db = await getDatabase();
    const updated: Member = { ...existing, ...data, id: existing.id };
    await db.runAsync(
      'UPDATE members SET householdId = ?, name = ?, userId = ?, joinedAt = ? WHERE id = ?',
      [
        updated.householdId,
        updated.name,
        encodeMemberUserId(updated.userId),
        updated.joinedAt,
        id,
      ]
    );
    return updated;
  }
}

// ── V4-01: Category Repository ─────────────────────────────────

/**
 * User-created categories, stored in the local SQLite store.
 *
 * There is deliberately no seed path wired into the product flow and no
 * default rows: a household starts with zero categories. Deleting a category
 * only removes the row — ledger entries keep their `categoryId` plus the label
 * snapshot captured at creation, so history is never rewritten.
 */
export class SqliteCategoryRepository implements CategoryRepository {
  async seed(categories: Category[]): Promise<void> {
    const db = await getDatabase();
    for (const category of categories) {
      await db.runAsync(
        'INSERT OR REPLACE INTO categories (id, householdId, name, defaultTaskRatioJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
        [
          category.id,
          category.householdId,
          category.name,
          category.defaultTaskRatio ? toJsonArray(category.defaultTaskRatio) : null,
          category.createdAt,
          category.updatedAt,
        ]
      );
    }
  }

  async getByHousehold(householdId: string): Promise<Category[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<CategoryRow>(
      'SELECT * FROM categories WHERE householdId = ? ORDER BY createdAt ASC',
      [householdId]
    );
    return rows.map(categoryFromRow);
  }

  async getByHouseholdPaginated(householdId: string, query: PaginatedQuery = {}): Promise<PaginatedResult<Category>> {
    const limit = query.limit ?? 20;
    const db = await getDatabase();

    let sql = 'SELECT * FROM categories WHERE householdId = ?';
    const params: (string | number)[] = [householdId];

    if (query.after) {
      sql += ' AND createdAt >= ?';
      params.push(query.after);
    }

    if (query.cursor) {
      const c = JSON.parse(query.cursor!) as { o: string; i: string };
      sql += ' AND (createdAt < ? OR (createdAt = ? AND id < ?))';
      params.push(c.o, c.o, c.i);
    }

    sql += ' ORDER BY createdAt DESC, id DESC LIMIT ?';
    params.push(limit + 1); // fetch one extra to detect hasMore

    const rows = await db.getAllAsync<CategoryRow>(sql, params);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(categoryFromRow);
    const last = items.length > 0 ? items[items.length - 1] : null;
    const cursor = hasMore && last ? JSON.stringify({ o: last.createdAt, i: last.id }) : null;

    return { items, cursor, hasMore };
  }

  async getById(id: string): Promise<Category | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<CategoryRow>('SELECT * FROM categories WHERE id = ?', [id]);
    return row ? categoryFromRow(row) : null;
  }

  async create(data: Omit<Category, 'id' | 'createdAt' | 'updatedAt'>): Promise<Category> {
    const db = await getDatabase();
    const now = new Date().toISOString();
    const created: Category = {
      ...data,
      id: generateId('category'),
      createdAt: now,
      updatedAt: now,
    };
    await db.runAsync(
      'INSERT INTO categories (id, householdId, name, defaultTaskRatioJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
      [
        created.id,
        created.householdId,
        created.name,
        created.defaultTaskRatio ? toJsonArray(created.defaultTaskRatio) : null,
        created.createdAt,
        created.updatedAt,
      ]
    );
    return created;
  }

  async update(id: string, data: CategoryUpdate): Promise<Category> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`Category ${id} not found`);
    // Only name/defaultTaskRatio are writable (CategoryUpdate); an explicitly
    // undefined value means "leave unchanged". Identity, tenancy and
    // provenance are never writable.
    const nextName = data.name !== undefined ? data.name : existing.name;
    const nextRatio =
      data.defaultTaskRatio !== undefined ? data.defaultTaskRatio : existing.defaultTaskRatio;
    const updated: Category = {
      ...existing,
      name: nextName,
      defaultTaskRatio: nextRatio ?? null,
      id: existing.id,
      householdId: existing.householdId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE categories SET name = ?, defaultTaskRatioJson = ?, updatedAt = ? WHERE id = ?',
      [
        updated.name,
        updated.defaultTaskRatio ? toJsonArray(updated.defaultTaskRatio) : null,
        updated.updatedAt,
        id,
      ]
    );
    return updated;
  }

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    // Ledger entries referencing this id are intentionally untouched.
    await db.runAsync('DELETE FROM categories WHERE id = ?', [id]);
  }
}

interface CategoryRow {
  id: string;
  householdId: string;
  name: string;
  defaultTaskRatioJson: string | null;
  createdAt: string;
  updatedAt: string;
}

function categoryFromRow(row: CategoryRow): Category {
  return {
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    defaultTaskRatio: row.defaultTaskRatioJson
      ? parseJsonArray(row.defaultTaskRatioJson)
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── Contribution Entry Repository ──────────────────────────────

/**
 * V4-01 column list shared by seed/create/update so a contribution can never
 * be written with a subset of its fields (which would silently drop the
 * category snapshot, the split ratio or the attachments on replay).
 */
const CONTRIBUTION_COLUMNS =
  'id, householdId, label, performedByMemberId, beneficiaryMemberIds, value, unit, persistentTaskId, occurredAt, createdBy, modifiedBy, ' +
  'categoryId, categoryLabelSnapshot, note, attachmentsJson, splitMode, splitWeightsJson, splitSource';

/** One placeholder per column, generated so SQL and params cannot drift apart. */
const contributionPlaceholders = Array(18).fill('?').join(', ');

const CONTRIBUTION_INSERT_SQL =
  `INSERT INTO contribution_entries (${CONTRIBUTION_COLUMNS}) VALUES (${contributionPlaceholders})`;

const CONTRIBUTION_UPSERT_SQL =
  `INSERT OR REPLACE INTO contribution_entries (${CONTRIBUTION_COLUMNS}) VALUES (${contributionPlaceholders})`;

const CONTRIBUTION_UPDATE_SQL =
  'UPDATE contribution_entries SET label = ?, performedByMemberId = ?, beneficiaryMemberIds = ?, value = ?, unit = ?, persistentTaskId = ?, occurredAt = ?, modifiedBy = ?, ' +
  'categoryId = ?, categoryLabelSnapshot = ?, note = ?, attachmentsJson = ?, splitMode = ?, splitWeightsJson = ?, splitSource = ? WHERE id = ?';

function contributionParams(entry: ContributionEntry): (string | number | null)[] {
  return [
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
    entry.categoryId ?? null,
    entry.categoryLabelSnapshot ?? null,
    entry.note ?? null,
    entry.attachments && entry.attachments.length > 0 ? toJsonArray(entry.attachments) : null,
    entry.splitMode ?? null,
    entry.splitWeights && entry.splitWeights.length > 0 ? toJsonArray(entry.splitWeights) : null,
    entry.splitSource ?? null,
  ];
}

export class SqliteContributionEntryRepository implements ContributionEntryRepository {
  async seed(entries: ContributionEntry[]): Promise<void> {
    const db = await getDatabase();
    for (const entry of entries) {
      await db.runAsync(CONTRIBUTION_UPSERT_SQL, contributionParams(entry));
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
      const c = JSON.parse(query.cursor!) as { o: string; i: string };
      sql += ' AND (occurredAt < ? OR (occurredAt = ? AND id < ?))';
      params.push(c.o, c.o, c.i);
    }

    sql += ' ORDER BY occurredAt DESC, id DESC LIMIT ?';
    params.push(limit + 1); // fetch one extra to detect hasMore

    const rows = await db.getAllAsync<ContributionEntryRow>(sql, params);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(contributionFromRow);
    const last = items.length > 0 ? items[items.length - 1] : null;
    const cursor = hasMore && last ? JSON.stringify({ o: last.occurredAt, i: last.id }) : null;

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
    await db.runAsync(CONTRIBUTION_INSERT_SQL, contributionParams(created));
    return created;
  }

  async update(id: string, data: Partial<ContributionEntry>): Promise<ContributionEntry> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`ContributionEntry ${id} not found`);
    const updated = { ...existing, ...data };
    const db = await getDatabase();
    await db.runAsync(CONTRIBUTION_UPDATE_SQL, [
      updated.label,
      updated.performedByMemberId,
      toJsonArray(updated.beneficiaryMemberIds),
      updated.value,
      updated.unit,
      updated.persistentTaskId,
      updated.occurredAt,
      updated.modifiedBy ?? null,
      updated.categoryId ?? null,
      updated.categoryLabelSnapshot ?? null,
      updated.note ?? null,
      updated.attachments && updated.attachments.length > 0 ? toJsonArray(updated.attachments) : null,
      updated.splitMode ?? null,
      updated.splitWeights && updated.splitWeights.length > 0 ? toJsonArray(updated.splitWeights) : null,
      updated.splitSource ?? null,
      id,
    ]);
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
  categoryId: string | null;
  categoryLabelSnapshot: string | null;
  note: string | null;
  attachmentsJson: string | null;
  splitMode: string | null;
  splitWeightsJson: string | null;
  splitSource: string | null;
}

function contributionFromRow(row: ContributionEntryRow): ContributionEntry {
  const entry: ContributionEntry = {
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

  // V4-01 optional fields: absent stays absent so every V3 entry keeps its
  // original shape (equal split, no category, no attachments, no note).
  if (row.categoryId !== null && row.categoryId !== undefined) entry.categoryId = row.categoryId;
  if (row.categoryLabelSnapshot !== null && row.categoryLabelSnapshot !== undefined) {
    entry.categoryLabelSnapshot = row.categoryLabelSnapshot;
  }
  if (row.note !== null && row.note !== undefined) entry.note = row.note;
  if (row.attachmentsJson) entry.attachments = parseJsonArray<Attachment>(row.attachmentsJson);
  if (row.splitMode !== null && row.splitMode !== undefined) {
    entry.splitMode = row.splitMode as ContributionEntry['splitMode'];
  }
  if (row.splitWeightsJson) {
    entry.splitWeights = parseJsonArray<TaskSplitWeight>(row.splitWeightsJson);
  }
  if (row.splitSource !== null && row.splitSource !== undefined) {
    entry.splitSource = row.splitSource as ContributionEntry['splitSource'];
  }

  return entry;
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

  async getByHouseholdPaginated(householdId: string, query: PaginatedQuery = {}): Promise<PaginatedResult<PersistentTask>> {
    const limit = query.limit ?? 20;
    const db = await getDatabase();

    let sql = 'SELECT * FROM persistent_tasks WHERE householdId = ?';
    const params: (string | number)[] = [householdId];

    if (query.after) {
      sql += ' AND createdAt >= ?';
      params.push(query.after);
    }

    if (query.cursor) {
      const c = JSON.parse(query.cursor!) as { o: string; i: string };
      sql += ' AND (createdAt < ? OR (createdAt = ? AND id < ?))';
      params.push(c.o, c.o, c.i);
    }

    sql += ' ORDER BY createdAt DESC, id DESC LIMIT ?';
    params.push(limit + 1); // fetch one extra to detect hasMore

    const rows = await db.getAllAsync<PersistentTaskRow>(sql, params);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(taskFromRow);
    const last = items.length > 0 ? items[items.length - 1] : null;
    const cursor = hasMore && last ? JSON.stringify({ o: last.createdAt, i: last.id }) : null;

    return { items, cursor, hasMore };
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

/** V4-01: kind ('task' | 'expense') + the optional expense payload. */
const TODO_COLUMNS =
  'id, householdId, title, assigneeMemberId, beneficiaryMemberIds, dueAt, reminderAt, notes, persistentTaskId, status, createdAt, completedAt, ' +
  'kind, categoryId, expenseAmountMinor, expenseCurrency';

const todoPlaceholders = Array(16).fill('?').join(', ');

const TODO_INSERT_SQL = `INSERT INTO todo_items (${TODO_COLUMNS}) VALUES (${todoPlaceholders})`;
const TODO_UPSERT_SQL = `INSERT OR REPLACE INTO todo_items (${TODO_COLUMNS}) VALUES (${todoPlaceholders})`;

const TODO_UPDATE_SQL =
  'UPDATE todo_items SET title = ?, assigneeMemberId = ?, beneficiaryMemberIds = ?, dueAt = ?, reminderAt = ?, notes = ?, persistentTaskId = ?, status = ?, completedAt = ?, ' +
  'kind = ?, categoryId = ?, expenseAmountMinor = ?, expenseCurrency = ? WHERE id = ?';

function todoParams(todo: TodoItem): (string | number | null)[] {
  return [
    todo.id,
    todo.householdId,
    todo.title,
    todo.assigneeMemberId ?? null,
    toJsonArray(todo.beneficiaryMemberIds),
    todo.dueAt ?? null,
    todo.reminderAt ?? null,
    todo.notes,
    todo.persistentTaskId ?? null,
    todo.status,
    todo.createdAt,
    todo.completedAt ?? null,
    todo.kind ?? null,
    todo.categoryId ?? null,
    todo.expenseAmountMinor ?? null,
    todo.expenseCurrency ?? null,
  ];
}

export class SqliteTodoRepository implements TodoRepository {
  async seed(todos: TodoItem[]): Promise<void> {
    const db = await getDatabase();
    for (const todo of todos) {
      await db.runAsync(TODO_UPSERT_SQL, todoParams(todo));
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

  async getByHouseholdPaginated(householdId: string, query: PaginatedQuery = {}): Promise<PaginatedResult<TodoItem>> {
    const limit = query.limit ?? 20;
    const db = await getDatabase();

    let sql = 'SELECT * FROM todo_items WHERE householdId = ?';
    const params: (string | number)[] = [householdId];

    if (query.after) {
      sql += ' AND createdAt >= ?';
      params.push(query.after);
    }

    if (query.cursor) {
      const c = JSON.parse(query.cursor!) as { o: string; i: string };
      sql += ' AND (createdAt < ? OR (createdAt = ? AND id < ?))';
      params.push(c.o, c.o, c.i);
    }

    sql += ' ORDER BY createdAt DESC, id DESC LIMIT ?';
    params.push(limit + 1); // fetch one extra to detect hasMore

    const rows = await db.getAllAsync<TodoRow>(sql, params);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(todoFromRow);
    const last = items.length > 0 ? items[items.length - 1] : null;
    const cursor = hasMore && last ? JSON.stringify({ o: last.createdAt, i: last.id }) : null;

    return { items, cursor, hasMore };
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
    await db.runAsync(TODO_INSERT_SQL, todoParams(created));
    return created;
  }

  async update(id: string, data: Partial<TodoItem>): Promise<TodoItem> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`Todo ${id} not found`);
    const updated = { ...existing, ...data };
    const db = await getDatabase();
    await db.runAsync(TODO_UPDATE_SQL, [
      updated.title,
      updated.assigneeMemberId ?? null,
      toJsonArray(updated.beneficiaryMemberIds),
      updated.dueAt ?? null,
      updated.reminderAt ?? null,
      updated.notes,
      updated.persistentTaskId ?? null,
      updated.status,
      updated.completedAt ?? null,
      updated.kind ?? null,
      updated.categoryId ?? null,
      updated.expenseAmountMinor ?? null,
      updated.expenseCurrency ?? null,
      id,
    ]);
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
  kind: string | null;
  categoryId: string | null;
  expenseAmountMinor: number | null;
  expenseCurrency: string | null;
}

function todoFromRow(row: TodoRow): TodoItem {
  const todo: TodoItem = {
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

  // V4-01 optional fields: absent stays absent so V3 todos keep meaning 'task'.
  if (row.kind !== null && row.kind !== undefined) todo.kind = row.kind as TodoItem['kind'];
  if (row.categoryId !== null && row.categoryId !== undefined) todo.categoryId = row.categoryId;
  if (row.expenseAmountMinor !== null && row.expenseAmountMinor !== undefined) {
    todo.expenseAmountMinor = row.expenseAmountMinor;
  }
  if (row.expenseCurrency !== null && row.expenseCurrency !== undefined) {
    todo.expenseCurrency = row.expenseCurrency;
  }

  return todo;
}

// ── Expense Entry Repository ───────────────────────────────────

/** V4-01: user-created category reference + snapshot + attachments. */
const EXPENSE_COLUMNS =
  'id, householdId, title, amountMinor, currency, paidByMemberId, participantMemberIds, splitMode, customSharesJson, note, category, occurredAt, createdBy, modifiedBy, ' +
  'categoryId, categoryLabelSnapshot, attachmentsJson';

const expensePlaceholders = Array(17).fill('?').join(', ');

const EXPENSE_INSERT_SQL = `INSERT INTO expense_entries (${EXPENSE_COLUMNS}) VALUES (${expensePlaceholders})`;
const EXPENSE_UPSERT_SQL = `INSERT OR REPLACE INTO expense_entries (${EXPENSE_COLUMNS}) VALUES (${expensePlaceholders})`;

const EXPENSE_UPDATE_SQL =
  'UPDATE expense_entries SET title = ?, amountMinor = ?, currency = ?, paidByMemberId = ?, participantMemberIds = ?, splitMode = ?, customSharesJson = ?, note = ?, category = ?, occurredAt = ?, modifiedBy = ?, ' +
  'categoryId = ?, categoryLabelSnapshot = ?, attachmentsJson = ? WHERE id = ?';

function expenseParams(entry: ExpenseEntry): (string | number | null)[] {
  return [
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
    entry.categoryId ?? null,
    entry.categoryLabelSnapshot ?? null,
    entry.attachments && entry.attachments.length > 0 ? toJsonArray(entry.attachments) : null,
  ];
}

export class SqliteExpenseEntryRepository implements ExpenseEntryRepository {
  async seed(entries: ExpenseEntry[]): Promise<void> {
    const db = await getDatabase();
    for (const entry of entries) {
      await db.runAsync(EXPENSE_UPSERT_SQL, expenseParams(entry));
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
      const c = JSON.parse(query.cursor!) as { o: string; i: string };
      sql += ' AND (occurredAt < ? OR (occurredAt = ? AND id < ?))';
      params.push(c.o, c.o, c.i);
    }

    sql += ' ORDER BY occurredAt DESC, id DESC LIMIT ?';
    params.push(limit + 1);

    const rows = await db.getAllAsync<ExpenseEntryRow>(sql, params);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(expenseFromRow);
    const last = items.length > 0 ? items[items.length - 1] : null;
    const cursor = hasMore && last ? JSON.stringify({ o: last.occurredAt, i: last.id }) : null;

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
    await db.runAsync(EXPENSE_INSERT_SQL, expenseParams(created));
    return created;
  }

  async update(id: string, data: Partial<ExpenseEntry>): Promise<ExpenseEntry> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`ExpenseEntry ${id} not found`);
    const updated = { ...existing, ...data };
    const db = await getDatabase();
    await db.runAsync(EXPENSE_UPDATE_SQL, [
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
      updated.categoryId ?? null,
      updated.categoryLabelSnapshot ?? null,
      updated.attachments && updated.attachments.length > 0 ? toJsonArray(updated.attachments) : null,
      id,
    ]);
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
  categoryId: string | null;
  categoryLabelSnapshot: string | null;
  attachmentsJson: string | null;
}

function expenseFromRow(row: ExpenseEntryRow): ExpenseEntry {
  const entry: ExpenseEntry = {
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

  // V4-01 optional fields: absent stays absent for every V3 expense.
  if (row.categoryId !== null && row.categoryId !== undefined) entry.categoryId = row.categoryId;
  if (row.categoryLabelSnapshot !== null && row.categoryLabelSnapshot !== undefined) {
    entry.categoryLabelSnapshot = row.categoryLabelSnapshot;
  }
  if (row.attachmentsJson) entry.attachments = parseJsonArray<Attachment>(row.attachmentsJson);

  return entry;
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
      const c = JSON.parse(query.cursor!) as { o: string; i: string };
      sql += ' AND (occurredAt < ? OR (occurredAt = ? AND id < ?))';
      params.push(c.o, c.o, c.i);
    }

    sql += ' ORDER BY occurredAt DESC, id DESC LIMIT ?';
    params.push(limit + 1);

    const rows = await db.getAllAsync<SettlementRow>(sql, params);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(settlementFromRow);
    const last = items.length > 0 ? items[items.length - 1] : null;
    const cursor = hasMore && last ? JSON.stringify({ o: last.occurredAt, i: last.id }) : null;

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

// ── V3-06: SQLite Invitation Repository ────────────────────────

export class SqliteInvitationRepository implements InvitationRepository {
  async seed(items: Invitation[]): Promise<void> {
    const db = await getDatabase();
    for (const inv of items) {
      await db.runAsync(
        'INSERT OR REPLACE INTO invitations (id, householdId, invitedByUserId, invitedEmail, role, status, linkToken, targetMemberId, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [inv.id, inv.householdId, inv.invitedByUserId, inv.invitedEmail, inv.role, inv.status, inv.linkToken, inv.targetMemberId ?? null, inv.createdAt, inv.expiresAt],
      );
    }
  }

  async getById(id: string): Promise<Invitation | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<InvitationRow>(
      'SELECT * FROM invitations WHERE id = ?',
      [id],
    );
    return row ? invitationFromRow(row) : null;
  }

  async getByLinkToken(token: string): Promise<Invitation | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<InvitationRow>(
      'SELECT * FROM invitations WHERE linkToken = ?',
      [token],
    );
    return row ? invitationFromRow(row) : null;
  }

  async getByHousehold(householdId: string): Promise<Invitation[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<InvitationRow>(
      'SELECT * FROM invitations WHERE householdId = ? ORDER BY createdAt DESC',
      [householdId],
    );
    return rows.map(invitationFromRow);
  }

  async getByHouseholdPaginated(householdId: string, query: PaginatedQuery = {}): Promise<PaginatedResult<Invitation>> {
    const limit = query.limit ?? 20;
    const db = await getDatabase();

    let sql = 'SELECT * FROM invitations WHERE householdId = ?';
    const params: (string | number)[] = [householdId];

    if (query.after) {
      sql += ' AND createdAt >= ?';
      params.push(query.after);
    }

    if (query.cursor) {
      const c = JSON.parse(query.cursor!) as { o: string; i: string };
      sql += ' AND (createdAt < ? OR (createdAt = ? AND id < ?))';
      params.push(c.o, c.o, c.i);
    }

    sql += ' ORDER BY createdAt DESC, id DESC LIMIT ?';
    params.push(limit + 1); // fetch one extra to detect hasMore

    const rows = await db.getAllAsync<InvitationRow>(sql, params);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(invitationFromRow);
    const last = items.length > 0 ? items[items.length - 1] : null;
    const cursor = hasMore && last ? JSON.stringify({ o: last.createdAt, i: last.id }) : null;

    return { items, cursor, hasMore };
  }

  async getPendingByEmail(email: string): Promise<Invitation[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<InvitationRow>(
      "SELECT * FROM invitations WHERE invitedEmail = ? AND status = 'pending'",
      [email],
    );
    return rows.map(invitationFromRow);
  }

  async create(data: Omit<Invitation, 'id' | 'createdAt'>): Promise<Invitation> {
    const db = await getDatabase();
    const invitation: Invitation = {
      ...data,
      id: generateId('invitation'),
      createdAt: new Date().toISOString(),
    };
    await db.runAsync(
      'INSERT INTO invitations (id, householdId, invitedByUserId, invitedEmail, role, status, linkToken, targetMemberId, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [invitation.id, invitation.householdId, invitation.invitedByUserId, invitation.invitedEmail, invitation.role, invitation.status, invitation.linkToken, invitation.targetMemberId ?? null, invitation.createdAt, invitation.expiresAt],
    );
    return invitation;
  }

  async updateStatus(id: string, status: Invitation['status']): Promise<Invitation> {
    const existing = await this.getById(id);
    if (!existing) throw new Error(`Invitation ${id} not found`);
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE invitations SET status = ? WHERE id = ?',
      [status, id],
    );
    return { ...existing, status };
  }

  async delete(id: string): Promise<void> {
    const db = await getDatabase();
    await db.runAsync('DELETE FROM invitations WHERE id = ?', [id]);
  }
}

interface InvitationRow {
  id: string;
  householdId: string;
  invitedByUserId: string;
  invitedEmail: string;
  role: string;
  status: string;
  linkToken: string;
  targetMemberId: string | null;
  createdAt: string;
  expiresAt: string;
}

function invitationFromRow(row: InvitationRow): Invitation {
  return {
    id: row.id,
    householdId: row.householdId,
    invitedByUserId: row.invitedByUserId,
    invitedEmail: row.invitedEmail,
    role: row.role as 'MEMBER' | 'OWNER',
    status: row.status as Invitation['status'],
    linkToken: row.linkToken,
    targetMemberId: row.targetMemberId ?? null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

// ── V3-06: SQLite Sync State Repository ────────────────────────

export class SqliteSyncStateRepository implements SyncStateRepository {
  async getCursor(householdId: string, collection: SyncCollection): Promise<SyncCursor | null> {
    const db = await getDatabase();
    const row = await db.getFirstAsync<SyncCursorRow>(
      'SELECT * FROM sync_cursors WHERE householdId = ? AND collection = ?',
      [householdId, collection],
    );
    return row
      ? {
          householdId: row.householdId,
          collection: row.collection as SyncCollection,
          lastRevision: row.lastRevision,
          lastSyncedAt: row.lastSyncedAt,
        }
      : null;
  }

  async setCursor(cursor: SyncCursor): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT OR REPLACE INTO sync_cursors (householdId, collection, lastRevision, lastSyncedAt) VALUES (?, ?, ?, ?)',
      [cursor.householdId, cursor.collection, cursor.lastRevision, cursor.lastSyncedAt],
    );
  }

  async applyDeltas(
    householdId: string,
    collection: SyncCollection,
    records: SyncRecord[],
    pullCursorToAdvance?: SyncCursor,
  ): Promise<SyncRecord[]> {
    const db = await getDatabase();
    const applied: SyncRecord[] = [];

    for (const record of records) {
      await db.runAsync(
        'INSERT OR REPLACE INTO sync_records (id, householdId, collection, revision, updatedAt, deletedAt, payload) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [record.id, record.householdId, record.collection, record.revision, record.updatedAt, record.deletedAt, record.payload],
      );
      applied.push(record);
    }

    // V3-06 REPAIR: Advance cursor inside applyDeltas when provided
    if (pullCursorToAdvance) {
      await this.setCursor(pullCursorToAdvance);
    } else {
      // Fallback: advance cursor as before for backward compatibility
      const maxRev = records.reduce((max, r) => Math.max(max, r.revision), 0);
      const prev = await this.getCursor(householdId, collection);
      await this.setCursor({
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
    const db = await getDatabase();

    for (const record of records) {
      await db.runAsync(
        'INSERT OR REPLACE INTO sync_records (id, householdId, collection, revision, updatedAt, deletedAt, payload) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [record.id, record.householdId, record.collection, record.revision, record.updatedAt, record.deletedAt, record.payload],
      );
    }
    // NOTE: cursor is NOT advanced — records still need to be pushed.
  }

  async getDirtyRecords(
    householdId: string,
    collection: SyncCollection,
    sinceRevision: number,
  ): Promise<SyncRecord[]> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<SyncRecordRow>(
      'SELECT * FROM sync_records WHERE householdId = ? AND collection = ? AND revision > ? ORDER BY revision ASC',
      [householdId, collection, sinceRevision],
    );
    return rows.map((r) => ({
      id: r.id,
      householdId: r.householdId,
      collection: r.collection as SyncCollection,
      revision: r.revision,
      updatedAt: r.updatedAt,
      deletedAt: r.deletedAt,
      payload: r.payload,
    }));
  }
}

interface SyncCursorRow {
  householdId: string;
  collection: string;
  lastRevision: number;
  lastSyncedAt: string;
}

interface SyncRecordRow {
  id: string;
  householdId: string;
  collection: string;
  revision: number;
  updatedAt: string;
  deletedAt: string | null;
  payload: string | null;
}
