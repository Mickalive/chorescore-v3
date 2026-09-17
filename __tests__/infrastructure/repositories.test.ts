/**
 * V3-02 — Infrastructure tests
 *
 * Verifies in-memory repositories work correctly and that
 * the domain entities flow through the infrastructure layer.
 * These are provider-independent tests that validate the contracts.
 *
 * Also covers the SQLite-backed repositories (against a mocked in-memory
 * expo-sqlite driver), the RepositoryFactory fallback selection and the
 * demo fixture consistency (canonical ids, idempotent sign-in).
 */

// Mock expo-sqlite with an in-memory fake driver so the real
// SqliteStorage/SqliteRepositories code can be exercised in jest.
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
}));

import * as SQLite from 'expo-sqlite';
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
} from '../../src/infrastructure/repositories/InMemoryRepositories';
import {
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
} from '../../src/infrastructure/repositories/SqliteRepositories';
import { createRepositories } from '../../src/infrastructure/repositories/RepositoryFactory';
import {
  ensureDemoFixture,
  loadHouseholdsForUser,
  DEMO_HOUSEHOLD_ID,
  DEMO_ALEX_MEMBER_ID,
  DEMO_SAM_MEMBER_ID,
  DEMO_SAM_USER_ID,
} from '../../src/features/app/demoFixture';
import { AuthUser } from '../../src/application/ports';
import {
  pullDeltas,
  pushDeltas,
} from '../../src/domain/services/syncEngine';

const openDatabaseAsyncMock = SQLite.openDatabaseAsync as jest.Mock;

/**
 * Minimal in-memory SQL engine covering the exact SQL subset used by
 * SqliteStorage (DDL, ignored) and SqliteRepositories (INSERT/INSERT OR
 * REPLACE/UPDATE/DELETE/SELECT with ? params and ORDER BY).
 */
class FakeSQLiteDatabase {
  private tables = new Map<string, Map<string, Record<string, unknown>>>();

  async execAsync(_sql: string): Promise<void> {
    // DDL (CREATE TABLE/INDEX, PRAGMA) is a no-op; tables are created lazily.
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<{ lastInsertRowId: number; changes: number }> {
    const insertMatch = sql.match(/^INSERT(?: OR REPLACE)? INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/i);
    if (insertMatch) {
      const [, table, colsStr, placeholdersStr] = insertMatch;
      const cols = colsStr.split(',').map((c) => c.trim());
      const placeholders = placeholdersStr.split(',').map((p) => p.trim());
      const row: Record<string, unknown> = {};
      let paramIndex = 0;
      for (let i = 0; i < cols.length; i++) {
        row[cols[i]] = placeholders[i] === '?' ? params[paramIndex++] : placeholders[i];
      }
      // Use row.id as key if present; otherwise build a composite key from
      // all non-null columns (needed for tables without an id column, like
      // sync_cursors which uses householdId+collection as the primary key).
      const id = row.id != null
        ? String(row.id)
        : cols.filter((c) => row[c] != null).map((c) => `${c}=${row[c]}`).join('|');
      this.getTable(table).set(id, row);
      return { lastInsertRowId: Number(String(row.id ?? '').replace(/\D/g, '') || 0), changes: 1 };
    }

    const updateMatch = sql.match(/^UPDATE (\w+) SET (.+) WHERE id = \?$/i);
    if (updateMatch) {
      const [, table, setClause] = updateMatch;
      const id = String(params[params.length - 1]);
      const row = this.getTable(table).get(id);
      if (!row) throw new Error(`${table} ${id} not found`);
      const assignments = setClause.split(',').map((a) => a.trim());
      let paramIndex = 0;
      for (const assignment of assignments) {
        const [col] = assignment.split('=').map((s) => s.trim());
        row[col] = params[paramIndex++];
      }
      return { lastInsertRowId: 0, changes: 1 };
    }

    const deleteMatch = sql.match(/^DELETE FROM (\w+) WHERE id = \?$/i);
    if (deleteMatch) {
      const [, table] = deleteMatch;
      this.getTable(table).delete(String(params[0]));
      return { lastInsertRowId: 0, changes: 1 };
    }

    throw new Error(`Unsupported SQL: ${sql}`);
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = this.query(sql, params);
    return (rows[0] as T) ?? null;
  }

  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.query(sql, params) as T[];
  }

  private query(sql: string, params: unknown[]): Record<string, unknown>[] {
    const selectMatch = sql.match(/^SELECT \* FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY (.+))?$/i);
    if (!selectMatch) throw new Error(`Unsupported SQL: ${sql}`);
    const [, table, whereClause, orderClause] = selectMatch;
    let rows = Array.from(this.getTable(table).values());
    if (whereClause) {
      const conditions = whereClause.split(' AND ').map((c) => c.trim());
      rows = rows.filter((row) => {
        let paramIndex = 0;
        for (const condition of conditions) {
          // Support operators: =, >, >=, <, <=, !=
          const opMatch = condition.match(/^(\w+)\s*(!=|>=|<=|>|<|=)\s*\?$/);
          if (opMatch) {
            const [, col, op] = opMatch;
            const expected = params[paramIndex++];
            const rowVal = row[col];
            const rowNum = typeof rowVal === 'number' ? rowVal : Number(rowVal);
            const expNum = typeof expected === 'number' ? expected : Number(expected);
            const isNumeric = !isNaN(rowNum) && !isNaN(expNum);
            let matches = false;
            switch (op) {
              case '=':  matches = isNumeric ? rowNum === expNum : String(rowVal) === String(expected); break;
              case '!=': matches = isNumeric ? rowNum !== expNum : String(rowVal) !== String(expected); break;
              case '>':  matches = isNumeric ? rowNum > expNum  : String(rowVal) > String(expected); break;
              case '>=': matches = isNumeric ? rowNum >= expNum : String(rowVal) >= String(expected); break;
              case '<':  matches = isNumeric ? rowNum < expNum  : String(rowVal) < String(expected); break;
              case '<=': matches = isNumeric ? rowNum <= expNum : String(rowVal) <= String(expected); break;
            }
            if (!matches) return false;
            continue;
          }
          // Fallback: legacy = only
          const [col] = condition.split('=').map((s) => s.trim());
          const expected = params[paramIndex++];
          if (String(row[col]) !== String(expected)) return false;
        }
        return true;
      });
    }
    if (orderClause) {
      const [col, dir] = orderClause.split(' ').map((s) => s.trim());
      const multiplier = dir?.toUpperCase() === 'DESC' ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        const av = a[col] as string | number;
        const bv = b[col] as string | number;
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * multiplier;
      });
    }
    return rows;
  }

  private getTable(name: string): Map<string, Record<string, unknown>> {
    if (!this.tables.has(name)) this.tables.set(name, new Map());
    return this.tables.get(name)!;
  }

  clearAll(): void {
    this.tables.clear();
  }
}

beforeAll(() => {
  openDatabaseAsyncMock.mockImplementation(
    async () => new FakeSQLiteDatabase() as unknown as SQLite.SQLiteDatabase
  );
});

beforeEach(async () => {
  // SqliteStorage caches a single database instance per module; clear its
  // tables between tests so each test starts from an empty store.
  const calls = openDatabaseAsyncMock.mock.results;
  if (calls.length > 0) {
    const db = (await calls[0].value) as FakeSQLiteDatabase;
    db.clearAll();
  }
});

describe('V3-02 InMemory repositories', () => {
  test('household CRUD works without restrictions', async () => {
    const repo = new InMemoryHouseholdRepository();

    const h1 = await repo.create({
      name: 'Colocation',
      ownerId: 'user-1',
      contributionUnit: 'minutes',
      crossLedgerCompensationEnabled: false,
      contributionToMoneyRate: null,
    });
    expect(h1.id).toBeTruthy();
    expect(h1.name).toBe('Colocation');
    expect(h1.contributionUnit).toBe('minutes');
    expect(h1.crossLedgerCompensationEnabled).toBe(false);

    const h2 = await repo.create({
      name: 'Vacances',
      ownerId: 'user-1',
      contributionUnit: 'points',
      crossLedgerCompensationEnabled: false,
      contributionToMoneyRate: null,
    });

    const all = await repo.getAll();
    expect(all).toHaveLength(2);

    const found = await repo.getById(h1.id);
    expect(found?.name).toBe('Colocation');

    // No limit on creation — unlimited groups
    const h3 = await repo.create({
      name: 'Troisieme groupe',
      ownerId: 'user-2',
      contributionUnit: 'minutes',
      crossLedgerCompensationEnabled: false,
      contributionToMoneyRate: null,
    });
    expect(all).toHaveLength(2); // all was captured before h3

    const allAfter = await repo.getAll();
    expect(allAfter).toHaveLength(3);
  });

  test('contribution entries store unit and beneficiary IDs correctly', async () => {
    const repo = new InMemoryContributionEntryRepository();

    const entry = await repo.create({
      householdId: 'h-1',
      label: 'Vaisselle',
      performedByMemberId: 'm-alex',
      beneficiaryMemberIds: ['m-alex', 'm-sam'],
      value: 15,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T12:00:00.000Z',
      createdBy: 'user-alex',
    });

    expect(entry.id).toBeTruthy();
    expect(entry.unit).toBe('minutes');
    expect(entry.value).toBe(15);
    expect(entry.beneficiaryMemberIds).toEqual(['m-alex', 'm-sam']);

    const fetched = await repo.getById(entry.id);
    expect(fetched?.label).toBe('Vaisselle');

    const byHousehold = await repo.getByHousehold('h-1');
    expect(byHousehold).toHaveLength(1);
  });

  test('expense entries store integer minor units and split mode', async () => {
    const repo = new InMemoryExpenseEntryRepository();

    const entry = await repo.create({
      householdId: 'h-1',
      title: 'Courses Migros',
      amountMinor: 4250,
      currency: 'CHF',
      paidByMemberId: 'm-alex',
      participantMemberIds: ['m-alex', 'm-sam'],
      splitMode: 'equal',
      occurredAt: '2026-09-16T12:00:00.000Z',
      createdBy: 'user-alex',
    });

    expect(entry.amountMinor).toBe(4250);
    expect(entry.currency).toBe('CHF');
    expect(entry.splitMode).toBe('equal');

    const fetched = await repo.getById(entry.id);
    expect(fetched?.title).toBe('Courses Migros');
  });

  test('settlements store rate snapshots immutably', async () => {
    const repo = new InMemorySettlementRepository();

    const settlement = await repo.create({
      householdId: 'h-1',
      contributionCreditorMemberId: 'm-alex',
      counterpartyMemberId: 'm-sam',
      contributionValue: 15,
      contributionUnit: 'minutes',
      moneyAmountMinor: 500,
      currency: 'CHF',
      rateSnapshot: {
        contributionValue: 60,
        contributionUnit: 'minutes',
        moneyAmountMinor: 2000,
        currency: 'CHF',
      },
      occurredAt: '2026-09-16T13:00:00.000Z',
      createdBy: 'user-alex',
    });

    expect(settlement.rateSnapshot.contributionValue).toBe(60);
    expect(settlement.moneyAmountMinor).toBe(500);

    const fetched = await repo.getById(settlement.id);
    expect(fetched?.rateSnapshot.moneyAmountMinor).toBe(2000);
  });

  test('membership prevents duplicate user-household pairs', async () => {
    const repo = new InMemoryMembershipRepository();

    await repo.create({
      userId: 'user-1',
      householdId: 'h-1',
      role: 'OWNER',
    });

    const existing = await repo.getByUserAndHousehold('user-1', 'h-1');
    expect(existing).not.toBeNull();
    expect(existing?.role).toBe('OWNER');

    // Another membership for different household works
    await repo.create({
      userId: 'user-1',
      householdId: 'h-2',
      role: 'MEMBER',
    });

    const h2Membership = await repo.getByUserAndHousehold('user-1', 'h-2');
    expect(h2Membership).not.toBeNull();
  });

  test('todo items track status and completion', async () => {
    const repo = new InMemoryTodoRepository();

    const todo = await repo.create({
      householdId: 'h-1',
      title: 'Sortir les poubelles',
      assigneeMemberId: 'm-sam',
      beneficiaryMemberIds: ['m-alex', 'm-sam'],
      dueAt: null,
      reminderAt: null,
      notes: '',
      persistentTaskId: null,
      status: 'todo',
    });

    expect(todo.status).toBe('todo');
    expect(todo.completedAt).toBeUndefined();

    const completed = await repo.update(todo.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });

    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeTruthy();
  });

  test('persistent tasks store default values and unit', async () => {
    const repo = new InMemoryPersistentTaskRepository();

    const task = await repo.create({
      householdId: 'h-1',
      name: 'Vaisselle',
      defaultValue: 15,
      defaultUnit: 'minutes',
    });

    expect(task.defaultValue).toBe(15);
    expect(task.defaultUnit).toBe('minutes');

    const byHousehold = await repo.getByHousehold('h-1');
    expect(byHousehold).toHaveLength(1);
    expect(byHousehold[0].name).toBe('Vaisselle');
  });
});

describe('V3-02 multi-group support', () => {
  test('user can belong to multiple groups without restriction', async () => {
    const userRepo = new InMemoryUserRepository();
    const householdRepo = new InMemoryHouseholdRepository();
    const membershipRepo = new InMemoryMembershipRepository();

    const user = await userRepo.create({
      email: 'test@example.com',
      displayName: 'Test User',
    });

    // Create 5 groups — no limit
    for (let i = 1; i <= 5; i++) {
      const household = await householdRepo.create({
        name: `Groupe ${i}`,
        ownerId: user.id,
        contributionUnit: 'minutes',
        crossLedgerCompensationEnabled: false,
        contributionToMoneyRate: null,
      });

      await membershipRepo.create({
        userId: user.id,
        householdId: household.id,
        role: 'OWNER',
      });
    }

    const memberships = await membershipRepo.getByUser(user.id);
    expect(memberships).toHaveLength(5);

    const households = await householdRepo.getAll();
    expect(households).toHaveLength(5);
  });
});

describe('V3-02 SQLite repositories (mocked expo-sqlite driver)', () => {
  test('user CRUD round-trip and idempotent seed', async () => {
    const repo = new SqliteUserRepository();

    const created = await repo.create({ email: 'alex@example.com', displayName: 'Alex' });
    expect(created.id).toBeTruthy();

    const fetched = await repo.getById(created.id);
    expect(fetched?.email).toBe('alex@example.com');
    expect(fetched?.displayName).toBe('Alex');
    expect(await repo.getByEmail('alex@example.com')).toEqual(fetched);

    const updated = await repo.update(created.id, { displayName: 'Alexandre' });
    expect(updated.displayName).toBe('Alexandre');
    expect((await repo.getById(created.id))?.displayName).toBe('Alexandre');
    expect(await repo.getAll()).toHaveLength(1);

    // seed is an idempotent upsert with known ids
    const demoUser = {
      id: 'demo-user-alex',
      email: 'demo@chorescore.app',
      displayName: 'Alex',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await repo.seed([demoUser]);
    await repo.seed([demoUser]);
    expect(await repo.getById('demo-user-alex')).not.toBeNull();
    expect(await repo.getAll()).toHaveLength(2);
  });

  test('household CRUD round-trip preserves unit and compensation config', async () => {
    const repo = new SqliteHouseholdRepository();

    const created = await repo.create({
      name: 'Appartement',
      ownerId: 'user-1',
      contributionUnit: 'points',
      crossLedgerCompensationEnabled: true,
      contributionToMoneyRate: {
        contributionValue: 10,
        contributionUnit: 'points',
        moneyAmountMinor: 1500,
        currency: 'CHF',
      },
    });

    const fetched = await repo.getById(created.id);
    expect(fetched?.name).toBe('Appartement');
    expect(fetched?.contributionUnit).toBe('points');
    expect(fetched?.crossLedgerCompensationEnabled).toBe(true);
    expect(fetched?.contributionToMoneyRate?.moneyAmountMinor).toBe(1500);

    const updated = await repo.update(created.id, { contributionUnit: 'minutes' });
    expect(updated.contributionUnit).toBe('minutes');
    expect((await repo.getById(created.id))?.contributionUnit).toBe('minutes');
    expect(await repo.getAll()).toHaveLength(1);
  });

  test('membership CRUD round-trip and unique user-household lookup', async () => {
    const repo = new SqliteMembershipRepository();

    const created = await repo.create({ userId: 'user-1', householdId: 'h-1', role: 'OWNER' });
    expect(created.joinedAt).toBeTruthy();
    expect(await repo.getByUser('user-1')).toHaveLength(1);
    expect(await repo.getByHousehold('h-1')).toHaveLength(1);

    const pair = await repo.getByUserAndHousehold('user-1', 'h-1');
    expect(pair?.role).toBe('OWNER');

    await repo.delete(created.id);
    expect(await repo.getByUser('user-1')).toHaveLength(0);
  });

  test('member CRUD round-trip', async () => {
    const repo = new SqliteMemberRepository();

    const created = await repo.create({ householdId: 'h-1', name: 'Alex', userId: 'user-1' });
    expect(created.joinedAt).toBeTruthy();
    expect(await repo.getById(created.id)).toEqual(created);

    const byHousehold = await repo.getByHousehold('h-1');
    expect(byHousehold).toHaveLength(1);
    expect(byHousehold[0].name).toBe('Alex');
  });

  test('contribution entry round-trip preserves unit, value and beneficiaries', async () => {
    const repo = new SqliteContributionEntryRepository();

    const created = await repo.create({
      householdId: 'h-1',
      label: 'Vaisselle',
      performedByMemberId: 'm-alex',
      beneficiaryMemberIds: ['m-alex', 'm-sam'],
      value: 15,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T12:00:00.000Z',
      createdBy: 'user-alex',
    });

    const fetched = await repo.getById(created.id);
    expect(fetched?.label).toBe('Vaisselle');
    expect(fetched?.value).toBe(15);
    expect(fetched?.unit).toBe('minutes');
    expect(fetched?.beneficiaryMemberIds).toEqual(['m-alex', 'm-sam']);

    const updated = await repo.update(created.id, { value: 20 });
    expect(updated.value).toBe(20);
    expect((await repo.getById(created.id))?.value).toBe(20);
    expect(await repo.getByHousehold('h-1')).toHaveLength(1);

    await repo.delete(created.id);
    expect(await repo.getByHousehold('h-1')).toHaveLength(0);
  });

  test('persistent task round-trip', async () => {
    const repo = new SqlitePersistentTaskRepository();

    const created = await repo.create({
      householdId: 'h-1',
      name: 'Vaisselle',
      defaultValue: 15,
      defaultUnit: 'minutes',
    });
    expect(await repo.getById(created.id)).toEqual(created);
    expect(await repo.getByHousehold('h-1')).toHaveLength(1);

    await repo.delete(created.id);
    expect(await repo.getByHousehold('h-1')).toHaveLength(0);
  });

  test('todo round-trip tracks status and completion', async () => {
    const repo = new SqliteTodoRepository();

    const created = await repo.create({
      householdId: 'h-1',
      title: 'Sortir les poubelles',
      assigneeMemberId: 'm-sam',
      beneficiaryMemberIds: ['m-alex', 'm-sam'],
      dueAt: null,
      reminderAt: null,
      notes: '',
      persistentTaskId: null,
      status: 'todo',
    });

    const completed = await repo.update(created.id, {
      status: 'completed',
      completedAt: '2026-09-16T13:00:00.000Z',
    });
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBe('2026-09-16T13:00:00.000Z');

    const fetched = await repo.getById(created.id);
    expect(fetched?.status).toBe('completed');
    expect(fetched?.completedAt).toBe('2026-09-16T13:00:00.000Z');
  });

  test('expense round-trip preserves integer minor units and split mode', async () => {
    const repo = new SqliteExpenseEntryRepository();

    const created = await repo.create({
      householdId: 'h-1',
      title: 'Courses Migros',
      amountMinor: 4250,
      currency: 'CHF',
      paidByMemberId: 'm-alex',
      participantMemberIds: ['m-alex', 'm-sam'],
      splitMode: 'equal',
      occurredAt: '2026-09-16T12:00:00.000Z',
      createdBy: 'user-alex',
    });

    const fetched = await repo.getById(created.id);
    expect(fetched?.amountMinor).toBe(4250);
    expect(fetched?.currency).toBe('CHF');
    expect(fetched?.participantMemberIds).toEqual(['m-alex', 'm-sam']);
    expect(fetched?.splitMode).toBe('equal');

    const updated = await repo.update(created.id, {
      splitMode: 'custom',
      customShares: [{ memberId: 'm-alex', amountMinor: 4250 }],
    });
    expect(updated.splitMode).toBe('custom');
    expect(updated.customShares).toEqual([{ memberId: 'm-alex', amountMinor: 4250 }]);
  });

  test('settlement round-trip preserves immutable rate snapshot', async () => {
    const repo = new SqliteSettlementRepository();

    const created = await repo.create({
      householdId: 'h-1',
      contributionCreditorMemberId: 'm-alex',
      counterpartyMemberId: 'm-sam',
      contributionValue: 15,
      contributionUnit: 'minutes',
      moneyAmountMinor: 500,
      currency: 'CHF',
      rateSnapshot: {
        contributionValue: 60,
        contributionUnit: 'minutes',
        moneyAmountMinor: 2000,
        currency: 'CHF',
      },
      occurredAt: '2026-09-16T13:00:00.000Z',
      createdBy: 'user-alex',
    });

    const fetched = await repo.getById(created.id);
    expect(fetched?.rateSnapshot).toEqual({
      contributionValue: 60,
      contributionUnit: 'minutes',
      moneyAmountMinor: 2000,
      currency: 'CHF',
    });
    expect(fetched?.moneyAmountMinor).toBe(500);
    expect(await repo.getByHousehold('h-1')).toHaveLength(1);
  });

  test('seed is an idempotent upsert across repositories', async () => {
    const userRepo = new SqliteUserRepository();
    const householdRepo = new SqliteHouseholdRepository();
    const membershipRepo = new SqliteMembershipRepository();
    const memberRepo = new SqliteMemberRepository();

    const demoUser = {
      id: 'demo-user-alex',
      email: 'demo@chorescore.app',
      displayName: 'Alex',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await userRepo.seed([demoUser]);
    await userRepo.seed([demoUser]);
    expect(await userRepo.getAll()).toHaveLength(1);

    const demoHousehold = {
      id: DEMO_HOUSEHOLD_ID,
      name: 'Appartement',
      ownerId: 'demo-user-alex',
      contributionUnit: 'minutes' as const,
      crossLedgerCompensationEnabled: false,
      contributionToMoneyRate: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    await householdRepo.seed([demoHousehold]);
    await householdRepo.seed([demoHousehold]);
    expect(await householdRepo.getAll()).toHaveLength(1);

    const demoMembership = {
      id: 'membership-demo-alex',
      userId: 'demo-user-alex',
      householdId: DEMO_HOUSEHOLD_ID,
      role: 'OWNER' as const,
      joinedAt: '2026-01-01T00:00:00.000Z',
    };
    await membershipRepo.seed([demoMembership]);
    await membershipRepo.seed([demoMembership]);
    expect(await membershipRepo.getByUser('demo-user-alex')).toHaveLength(1);

    const demoMember = {
      id: DEMO_ALEX_MEMBER_ID,
      householdId: DEMO_HOUSEHOLD_ID,
      name: 'Alex',
      userId: 'demo-user-alex',
      joinedAt: '2026-01-01T00:00:00.000Z',
    };
    await memberRepo.seed([demoMember]);
    await memberRepo.seed([demoMember]);
    expect(await memberRepo.getByHousehold(DEMO_HOUSEHOLD_ID)).toHaveLength(1);
  });
});

describe('V3-02 RepositoryFactory selection', () => {
  test('in-memory fallback is selected in the test environment', async () => {
    const repos = await createRepositories();
    expect(repos.users).toBeInstanceOf(InMemoryUserRepository);
    // memberships, households, members are now wrapped with SyncRecording wrappers
    // that delegate to InMemory repos — verify they implement the interface
    expect(typeof repos.memberships.getByUser).toBe('function');
    expect(typeof repos.memberships.create).toBe('function');
    expect(typeof repos.households.getById).toBe('function');
    expect(typeof repos.households.create).toBe('function');
    expect(typeof repos.members.getByHousehold).toBe('function');
    expect(typeof repos.members.create).toBe('function');
    // contributions, todos, expenses, settlements are sync-recording wrappers
    // that delegate to InMemory repos — verify they implement the interface
    expect(typeof repos.contributions.create).toBe('function');
    expect(typeof repos.contributions.getById).toBe('function');
    expect(typeof repos.contributions.getByHousehold).toBe('function');
    expect(typeof repos.tasks.create).toBe('function');
    expect(typeof repos.todos.create).toBe('function');
    expect(typeof repos.todos.getById).toBe('function');
    expect(typeof repos.expenses.create).toBe('function');
    expect(typeof repos.settlements.create).toBe('function');
  });

  test('business data written through factory-selected repos can be read back', async () => {
    const repos = await createRepositories();

    const household = await repos.households.create({
      name: 'Colocation',
      ownerId: 'user-1',
      contributionUnit: 'minutes',
      crossLedgerCompensationEnabled: false,
      contributionToMoneyRate: null,
    });
    await repos.memberships.create({ userId: 'user-1', householdId: household.id, role: 'OWNER' });
    await repos.members.create({ householdId: household.id, name: 'Alex', userId: 'user-1' });
    await repos.contributions.create({
      householdId: household.id,
      label: 'Vaisselle',
      performedByMemberId: 'm-1',
      beneficiaryMemberIds: ['m-1'],
      value: 15,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T12:00:00.000Z',
      createdBy: 'user-1',
    });

    const fetched = await repos.households.getById(household.id);
    expect(fetched?.name).toBe('Colocation');
    expect(await repos.memberships.getByUser('user-1')).toHaveLength(1);
    expect(await repos.contributions.getByHousehold(household.id)).toHaveLength(1);
  });
});

describe('V3-02 demo fixture consistency', () => {
  const DEMO_USER: AuthUser = {
    userId: 'demo-user-alex',
    email: 'demo@chorescore.app',
    displayName: 'Alex',
    provider: 'local',
  };

  test('after demo sign-in the root groups list resolves the Appartement group', async () => {
    const repos = await createRepositories();
    await ensureDemoFixture(repos, DEMO_USER);

    const households = await loadHouseholdsForUser(repos, DEMO_USER.userId);
    expect(households).toHaveLength(1);
    expect(households[0].id).toBe(DEMO_HOUSEHOLD_ID);
    expect(households[0].name).toBe('Appartement');

    // The household is reachable through the canonical id used by memberships.
    expect(await repos.households.getById(DEMO_HOUSEHOLD_ID)).not.toBeNull();
  });

  test('a second sign-in does not duplicate the demo user or memberships', async () => {
    const repos = await createRepositories();
    await ensureDemoFixture(repos, DEMO_USER);
    await ensureDemoFixture(repos, DEMO_USER);

    const users = await repos.users.getAll();
    expect(users.filter((u) => u.id === DEMO_USER.userId)).toHaveLength(1);
    expect(users.filter((u) => u.id === DEMO_SAM_USER_ID)).toHaveLength(1);
    expect(await repos.memberships.getByUser(DEMO_USER.userId)).toHaveLength(1);
    expect(await repos.members.getByHousehold(DEMO_HOUSEHOLD_ID)).toHaveLength(2);

    // Fixture content is not duplicated either.
    expect(await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID)).toHaveLength(2);
    expect(await repos.todos.getByHousehold(DEMO_HOUSEHOLD_ID)).toHaveLength(1);
  });

  test('fixture data is readable through the same repositories that wrote it', async () => {
    const repos = await createRepositories();
    await ensureDemoFixture(repos, DEMO_USER);

    const members = await repos.members.getByHousehold(DEMO_HOUSEHOLD_ID);
    expect(members.map((m) => m.id).sort()).toEqual([DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID]);

    const entries = await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID);
    expect(entries.map((e) => e.label).sort()).toEqual(['Courses Migros', 'Vaisselle du soir']);

    const todos = await repos.todos.getByHousehold(DEMO_HOUSEHOLD_ID);
    expect(todos[0].title).toBe('Sortir les poubelles');
  });

  test('demo fixture converges through the SQLite-backed repositories', async () => {
    const repos = {
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
      withTransaction: async <T>(fn: () => Promise<T>): Promise<T> => fn(),
    };

    await ensureDemoFixture(repos, DEMO_USER);
    const households = await loadHouseholdsForUser(repos, DEMO_USER.userId);
    expect(households).toHaveLength(1);
    expect(households[0].name).toBe('Appartement');

    // A second sign-in converges to the same state (no duplicates).
    await ensureDemoFixture(repos, DEMO_USER);
    expect(await repos.users.getAll()).toHaveLength(2);
    expect(await repos.memberships.getByUser(DEMO_USER.userId)).toHaveLength(1);
    expect(await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID)).toHaveLength(2);
  });
});

// ══════════════════════════════════════════════════════════════
// V3-06 REPAIR Finding #4: SQLite sync pipeline contract test
// ══════════════════════════════════════════════════════════════

describe('V3-06 REPAIR Finding #4: SQLite sync pipeline', () => {
  /**
   * Shared contract test: proves remote delta → business record readable
   * AND local write → getDirtyRecords payload using SQLite-backed repos.
   *
   * Uses the mocked expo-sqlite driver from repositories.test.ts.
   * Tests the core sync state + materialization flow against SQLite.
   */
  test('remote delta stored in SQLite sync buffer is readable via getDirtyRecords', async () => {
    const syncState = new SqliteSyncStateRepository();
    const contributions = new SqliteContributionEntryRepository();

    const HH = 'h-sqlite-sync';

    // Simulate remote delta arriving: store in sync buffer
    const remotePayload = JSON.stringify({
      id: 'c-sql-remote', householdId: HH, label: 'Remote via SQLite',
      performedByMemberId: 'm-1', beneficiaryMemberIds: ['m-1', 'm-2'],
      value: 25, unit: 'minutes', persistentTaskId: null,
      occurredAt: '2026-09-16T10:00:00.000Z', createdBy: 'user-1',
    });

    const remoteRecord = {
      id: 'c-sql-remote',
      householdId: HH,
      collection: 'contribution_entries' as const,
      revision: 1,
      updatedAt: '2026-09-16T10:00:00Z',
      deletedAt: null,
      payload: remotePayload,
    };

    // Store via applyDeltas (which also advances cursor)
    await syncState.applyDeltas(HH, 'contribution_entries', [remoteRecord]);

    // Verify cursor advanced
    const cursor = await syncState.getCursor(HH, 'contribution_entries');
    expect(cursor?.lastRevision).toBe(1);

    // Verify getDirtyRecords returns the record
    const dirty = await syncState.getDirtyRecords(HH, 'contribution_entries', 0);
    expect(dirty).toHaveLength(1);
    expect(dirty[0].id).toBe('c-sql-remote');
    expect(dirty[0].payload).toBe(remotePayload);

    // Materialize into business table manually
    const entity = JSON.parse(remotePayload);
    await contributions.seed([{ ...entity, id: 'c-sql-remote' }]);

    // Verify business record is readable
    const entry = await contributions.getById('c-sql-remote');
    expect(entry).not.toBeNull();
    expect(entry!.label).toBe('Remote via SQLite');
    expect(entry!.value).toBe(25);
  });

  test('local write to SQLite business table produces dirty record for push', async () => {
    const syncState = new SqliteSyncStateRepository();
    const contributions = new SqliteContributionEntryRepository();

    const HH = 'h-sqlite-local';

    // Create a local contribution
    const created = await contributions.create({
      householdId: HH, label: 'Local SQLite write',
      performedByMemberId: 'm-1', beneficiaryMemberIds: ['m-1'],
      value: 15, unit: 'minutes', persistentTaskId: null,
      occurredAt: '2026-09-16T11:00:00.000Z', createdBy: 'user-1',
    });

    // Simulate what SyncRecordingWrapper does: store in sync buffer
    const dirtyRecord = {
      id: created.id,
      householdId: HH,
      collection: 'contribution_entries' as const,
      revision: 1,
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      payload: JSON.stringify(created),
    };
    await syncState.storeLocalRecords(HH, 'contribution_entries', [dirtyRecord]);

    // Verify getDirtyRecords returns the local payload
    const dirty = await syncState.getDirtyRecords(HH, 'contribution_entries', 0);
    expect(dirty).toHaveLength(1);
    expect(dirty[0].id).toBe(created.id);
    expect(JSON.parse(dirty[0].payload!).label).toBe('Local SQLite write');

    // Verify pushDeltas would send this record
    const pushedRecords: any[] = [];
    const result = await pushDeltas(syncState, HH, async (_coll, records) => {
      pushedRecords.push(...records);
      return records.map((r, i) => ({ ...r, revision: 100 + i }));
    });

    expect(result.totalPushed).toBe(1);
    expect(pushedRecords).toHaveLength(1);
    expect(JSON.parse(pushedRecords[0].payload!).label).toBe('Local SQLite write');
  });

  test('pull + push cycle on SQLite: remote materializes then local pushes', async () => {
    const syncState = new SqliteSyncStateRepository();
    const contributions = new SqliteContributionEntryRepository();

    const HH = 'h-sqlite-e2e';

    // 1. Create a local contribution (simulate SyncRecordingWrapper)
    const local = await contributions.create({
      householdId: HH, label: 'Local edit',
      performedByMemberId: 'm-1', beneficiaryMemberIds: ['m-1'],
      value: 10, unit: 'minutes', persistentTaskId: null,
      occurredAt: '2026-09-16T10:00:00.000Z', createdBy: 'user-1',
    });
    await syncState.storeLocalRecords(HH, 'contribution_entries', [{
      id: local.id, householdId: HH, collection: 'contribution_entries',
      revision: 1, updatedAt: new Date().toISOString(), deletedAt: null,
      payload: JSON.stringify(local),
    }]);

    // 2. Pull a remote delta via pullDeltas (which advances the __pull__: cursor,
    //    NOT the push cursor — push and pull cursors are independent).
    await pullDeltas(syncState, HH, async (_coll, _sinceRev) => {
      return [{
        id: 'c-sql-remote', householdId: HH, collection: 'contribution_entries',
        revision: 5, updatedAt: '2026-09-16T11:00:00Z', deletedAt: null,
        payload: JSON.stringify({
          id: 'c-sql-remote', householdId: HH, label: 'Remote pull',
          performedByMemberId: 'm-2', beneficiaryMemberIds: ['m-1', 'm-2'],
          value: 20, unit: 'minutes', persistentTaskId: null,
          occurredAt: '2026-09-16T11:00:00.000Z', createdBy: 'user-2',
        }),
      }];
    });

    // Verify pull cursor advanced (pull uses separate __pull__: prefix)
    const pullCursor = await syncState.getCursor(HH, '__pull__:contribution_entries' as any);
    expect(pullCursor?.lastRevision).toBe(5);

    // 3. Verify both records exist in sync buffer
    const allDirty = await syncState.getDirtyRecords(HH, 'contribution_entries', 0);
    expect(allDirty.length).toBeGreaterThanOrEqual(2);

    // 4. Push sends local records (push cursor is still at 0, so all records are dirty)
    const pushedRecords: any[] = [];
    await pushDeltas(syncState, HH, async (_coll, records) => {
      pushedRecords.push(...records);
      return records.map((r, i) => ({ ...r, revision: 100 + i }));
    });

    // Local record should be pushed (push cursor was 0, local revision 1 > 0)
    const pushedLocal = pushedRecords.find(r => r.id === local.id);
    expect(pushedLocal).toBeDefined();
    expect(JSON.parse(pushedLocal!.payload!).label).toBe('Local edit');
  });
});
