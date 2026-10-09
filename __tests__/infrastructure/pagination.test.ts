/**
 * ChoreScore V3 — Paginated Repository Tests
 *
 * Tests cursor-based pagination on InMemory repositories for contributions,
 * expenses and settlements. Validates:
 * - correct page sizes
 * - cursor correctness (exclusive)
 * - hasMore detection
 * - after filter
 * - empty results
 */

import { InMemoryContributionEntryRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import { InMemoryExpenseEntryRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import { InMemorySettlementRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import { InMemoryMemberRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import { InMemoryCategoryRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import { InMemoryPersistentTaskRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import { InMemoryTodoRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import { InMemoryInvitationRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import {
  ContributionEntry,
  ExpenseEntry,
  CrossLedgerSettlement,
  Member,
  Category,
  PersistentTask,
  TodoItem,
  Invitation,
} from '../../src/domain/entities';

const HH = 'h-1';

function contribution(id: string, occurredAt: string): ContributionEntry {
  return {
    id,
    householdId: HH,
    label: `Task ${id}`,
    performedByMemberId: 'a',
    beneficiaryMemberIds: ['a', 'b'],
    value: 15,
    unit: 'minutes',
    persistentTaskId: null,
    occurredAt,
    createdBy: 'user-a',
  };
}

function expenseEntry(id: string, occurredAt: string): ExpenseEntry {
  return {
    id,
    householdId: HH,
    title: `Expense ${id}`,
    amountMinor: 1000,
    currency: 'CHF',
    paidByMemberId: 'a',
    participantMemberIds: ['a', 'b'],
    splitMode: 'equal',
    occurredAt,
    createdBy: 'user-a',
  };
}

function settlementEntry(id: string, occurredAt: string): CrossLedgerSettlement {
  return {
    id,
    householdId: HH,
    contributionCreditorMemberId: 'a',
    counterpartyMemberId: 'b',
    contributionValue: 10,
    contributionUnit: 'minutes',
    moneyAmountMinor: 500,
    currency: 'CHF',
    rateSnapshot: {
      contributionValue: 60,
      contributionUnit: 'minutes',
      moneyAmountMinor: 2000,
      currency: 'CHF',
    },
    occurredAt,
    createdBy: 'user-a',
  };
}

function member(id: string, joinedAt: string): Member {
  return {
    id,
    householdId: HH,
    name: `Member ${id}`,
    userId: `user-${id}`,
    joinedAt,
  };
}

function category(id: string, createdAt: string): Category {
  return {
    id,
    householdId: HH,
    name: `Category ${id}`,
    defaultTaskRatio: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function persistentTask(id: string, createdAt: string): PersistentTask {
  return {
    id,
    householdId: HH,
    name: `Task ${id}`,
    defaultValue: 15,
    defaultUnit: 'minutes',
    createdAt,
  };
}

function todoItem(id: string, createdAt: string): TodoItem {
  return {
    id,
    householdId: HH,
    title: `Todo ${id}`,
    assigneeMemberId: 'a',
    beneficiaryMemberIds: ['a', 'b'],
    dueAt: null,
    reminderAt: null,
    notes: '',
    persistentTaskId: null,
    status: 'todo',
    createdAt,
  };
}

function invitation(id: string, createdAt: string): Invitation {
  return {
    id,
    householdId: HH,
    invitedByUserId: 'user-a',
    invitedEmail: `${id}@example.com`,
    role: 'MEMBER',
    status: 'pending',
    linkToken: `tok-${id}`,
    createdAt,
    expiresAt: '2026-12-31T00:00:00.000Z',
  };
}

// ── Contribution Pagination ──────────────────────────────────

describe('InMemoryContributionEntryRepository pagination', () => {
  let repo: InMemoryContributionEntryRepository;

  beforeEach(() => {
    repo = new InMemoryContributionEntryRepository();
    // Seed 5 entries: c0 (oldest) to c4 (newest), 1 hour apart
    const base = new Date('2026-09-16T10:00:00.000Z').getTime();
    for (let i = 0; i < 5; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      repo.seed([contribution(`c${i}`, ts)]);
    }
  });

  test('first page returns newest entries up to limit', async () => {
    const result = await repo.getByHouseholdPaginated(HH, { limit: 2 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].id).toBe('c4');
    expect(result.items[1].id).toBe('c3');
    expect(result.hasMore).toBe(true);
    // Cursor is a composite JSON string encoding { o: occurredAt, i: id }
    const cursor = JSON.parse(result.cursor!);
    expect(cursor.o).toBe(result.items[1].occurredAt);
    expect(cursor.i).toBe(result.items[1].id);
  });

  test('second page returns next batch via cursor', async () => {
    const page1 = await repo.getByHouseholdPaginated(HH, { limit: 2 });
    const page2 = await repo.getByHouseholdPaginated(HH, {
      limit: 2,
      cursor: page1.cursor,
    });
    expect(page2.items).toHaveLength(2);
    expect(page2.items[0].id).toBe('c2');
    expect(page2.items[1].id).toBe('c1');
    expect(page2.hasMore).toBe(true);
  });

  test('last page has hasMore=false', async () => {
    const page = await repo.getByHouseholdPaginated(HH, { limit: 10 });
    expect(page.items).toHaveLength(5);
    expect(page.hasMore).toBe(false);
    expect(page.cursor).toBeNull();
  });

  test('after filter returns only entries at or after timestamp', async () => {
    const afterTime = new Date('2026-09-16T12:00:00.000Z').toISOString();
    const result = await repo.getByHouseholdPaginated(HH, { after: afterTime });
    // Should return c2 (12:00), c3 (13:00), c4 (14:00) = 3 entries
    expect(result.items).toHaveLength(3);
    expect(result.items.map((i) => i.id)).toEqual(['c4', 'c3', 'c2']);
  });

  test('returns empty when cursor is before all entries', async () => {
    // Cursor pointing to a position before all seeded entries
    const cursor = JSON.stringify({ o: '2026-09-16T09:00:00.000Z', i: 'zzz' });
    const result = await repo.getByHouseholdPaginated(HH, {
      limit: 2,
      cursor,
    });
    expect(result.items).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });

  test('returns empty for non-existent household', async () => {
    const result = await repo.getByHouseholdPaginated('non-existent', { limit: 10 });
    expect(result.items).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });
});

// ── Expense Pagination ───────────────────────────────────────

describe('InMemoryExpenseEntryRepository pagination', () => {
  let repo: InMemoryExpenseEntryRepository;

  beforeEach(() => {
    repo = new InMemoryExpenseEntryRepository();
    const base = new Date('2026-09-16T10:00:00.000Z').getTime();
    for (let i = 0; i < 3; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      repo.seed([expenseEntry(`e${i}`, ts)]);
    }
  });

  test('paginates expenses correctly', async () => {
    const page1 = await repo.getByHouseholdPaginated(HH, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].id).toBe('e2');
    expect(page1.hasMore).toBe(true);

    const page2 = await repo.getByHouseholdPaginated(HH, {
      limit: 2,
      cursor: page1.cursor,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].id).toBe('e0');
    expect(page2.hasMore).toBe(false);
  });
});

// ── Settlement Pagination ────────────────────────────────────

describe('InMemorySettlementRepository pagination', () => {
  let repo: InMemorySettlementRepository;

  beforeEach(() => {
    repo = new InMemorySettlementRepository();
    const base = new Date('2026-09-16T10:00:00.000Z').getTime();
    for (let i = 0; i < 4; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      repo.seed([settlementEntry(`s${i}`, ts)]);
    }
  });

  test('paginates settlements correctly', async () => {
    const page1 = await repo.getByHouseholdPaginated(HH, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].id).toBe('s3');
    expect(page1.hasMore).toBe(true);

    const page2 = await repo.getByHouseholdPaginated(HH, {
      limit: 2,
      cursor: page1.cursor,
    });
    expect(page2.items).toHaveLength(2);
    expect(page2.items[0].id).toBe('s1');
    expect(page2.items[1].id).toBe('s0');
    expect(page2.hasMore).toBe(false);
  });
});

// ── Member Pagination (V4-07) ─────────────────────────────────

describe('InMemoryMemberRepository pagination', () => {
  let repo: InMemoryMemberRepository;

  beforeEach(() => {
    repo = new InMemoryMemberRepository();
    const base = new Date('2026-09-16T10:00:00.000Z').getTime();
    for (let i = 0; i < 4; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      repo.seed([member(`m${i}`, ts)]);
    }
  });

  test('paginates members by joinedAt DESC', async () => {
    const page1 = await repo.getByHouseholdPaginated(HH, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].id).toBe('m3');
    expect(page1.hasMore).toBe(true);

    const page2 = await repo.getByHouseholdPaginated(HH, {
      limit: 2,
      cursor: page1.cursor,
    });
    expect(page2.items).toHaveLength(2);
    expect(page2.items[0].id).toBe('m1');
    expect(page2.items[1].id).toBe('m0');
    expect(page2.hasMore).toBe(false);
  });

  test('after filter returns only members joined at or after timestamp', async () => {
    const afterTime = new Date('2026-09-16T12:00:00.000Z').toISOString();
    const result = await repo.getByHouseholdPaginated(HH, { after: afterTime });
    expect(result.items.map((i) => i.id)).toEqual(['m3', 'm2']);
  });
});

// ── Category Pagination (V4-07) ───────────────────────────────

describe('InMemoryCategoryRepository pagination', () => {
  let repo: InMemoryCategoryRepository;

  beforeEach(() => {
    repo = new InMemoryCategoryRepository();
    const base = new Date('2026-09-16T10:00:00.000Z').getTime();
    for (let i = 0; i < 4; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      repo.seed([category(`cat${i}`, ts)]);
    }
  });

  test('paginates categories by createdAt DESC', async () => {
    const page1 = await repo.getByHouseholdPaginated(HH, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].id).toBe('cat3');
    expect(page1.hasMore).toBe(true);

    const page2 = await repo.getByHouseholdPaginated(HH, {
      limit: 2,
      cursor: page1.cursor,
    });
    expect(page2.items).toHaveLength(2);
    expect(page2.items[0].id).toBe('cat1');
    expect(page2.items[1].id).toBe('cat0');
    expect(page2.hasMore).toBe(false);
  });

  test('returns empty for non-existent household', async () => {
    const result = await repo.getByHouseholdPaginated('non-existent', { limit: 10 });
    expect(result.items).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });
});

// ── PersistentTask Pagination (V4-07) ─────────────────────────

describe('InMemoryPersistentTaskRepository pagination', () => {
  let repo: InMemoryPersistentTaskRepository;

  beforeEach(() => {
    repo = new InMemoryPersistentTaskRepository();
    const base = new Date('2026-09-16T10:00:00.000Z').getTime();
    for (let i = 0; i < 3; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      repo.seed([persistentTask(`t${i}`, ts)]);
    }
  });

  test('paginates persistent tasks by createdAt DESC', async () => {
    const page1 = await repo.getByHouseholdPaginated(HH, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].id).toBe('t2');
    expect(page1.hasMore).toBe(true);

    const page2 = await repo.getByHouseholdPaginated(HH, {
      limit: 2,
      cursor: page1.cursor,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].id).toBe('t0');
    expect(page2.hasMore).toBe(false);
  });
});

// ── Todo Pagination (V4-07) ───────────────────────────────────

describe('InMemoryTodoRepository pagination', () => {
  let repo: InMemoryTodoRepository;

  beforeEach(() => {
    repo = new InMemoryTodoRepository();
    const base = new Date('2026-09-16T10:00:00.000Z').getTime();
    for (let i = 0; i < 3; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      repo.seed([todoItem(`todo${i}`, ts)]);
    }
  });

  test('paginates todos by createdAt DESC', async () => {
    const page1 = await repo.getByHouseholdPaginated(HH, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].id).toBe('todo2');
    expect(page1.hasMore).toBe(true);

    const page2 = await repo.getByHouseholdPaginated(HH, {
      limit: 2,
      cursor: page1.cursor,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].id).toBe('todo0');
    expect(page2.hasMore).toBe(false);
  });
});

// ── Invitation Pagination (V4-07) ─────────────────────────────

describe('InMemoryInvitationRepository pagination', () => {
  let repo: InMemoryInvitationRepository;

  beforeEach(() => {
    repo = new InMemoryInvitationRepository();
    const base = new Date('2026-09-16T10:00:00.000Z').getTime();
    for (let i = 0; i < 4; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      repo.seed([invitation(`inv${i}`, ts)]);
    }
  });

  test('paginates invitations by createdAt DESC', async () => {
    const page1 = await repo.getByHouseholdPaginated(HH, { limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].id).toBe('inv3');
    expect(page1.hasMore).toBe(true);

    const page2 = await repo.getByHouseholdPaginated(HH, {
      limit: 2,
      cursor: page1.cursor,
    });
    expect(page2.items).toHaveLength(2);
    expect(page2.items[0].id).toBe('inv1');
    expect(page2.items[1].id).toBe('inv0');
    expect(page2.hasMore).toBe(false);
  });
});
