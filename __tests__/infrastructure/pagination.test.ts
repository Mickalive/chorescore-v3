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
import {
  ContributionEntry,
  ExpenseEntry,
  CrossLedgerSettlement,
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
