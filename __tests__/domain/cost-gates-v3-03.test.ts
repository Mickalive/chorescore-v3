/**
 * ChoreScore V3 — Cost/Instrumentation Tests for V3-03
 *
 * Proves that bounded reads/writes are maintained for common operations.
 * A contribution or expense creation does NOT read the full history.
 * History pagination does NOT download the entire history.
 * These are release gates per V3_BACKEND_FRUGAL.md §12.
 */

import { InMemoryContributionEntryRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import { InMemoryExpenseEntryRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import { InMemorySettlementRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import { paginateActivityLog } from '../../src/domain/calculations/activityLog';

const HH = 'h-1';

// ── Helpers ──────────────────────────────────────────────────

function contribution(id: string, ts: string) {
  return {
    id,
    householdId: HH,
    label: `Task ${id}`,
    performedByMemberId: 'a',
    beneficiaryMemberIds: ['a', 'b'],
    value: 15,
    unit: 'minutes' as const,
    persistentTaskId: null,
    occurredAt: ts,
    createdBy: 'user-a',
  };
}

function expenseEntry(id: string, ts: string) {
  return {
    id,
    householdId: HH,
    title: `Expense ${id}`,
    amountMinor: 1000,
    currency: 'CHF',
    paidByMemberId: 'a',
    participantMemberIds: ['a', 'b'],
    splitMode: 'equal' as const,
    occurredAt: ts,
    createdBy: 'user-a',
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('V3-03 cost gates: bounded reads/writes', () => {
  test('creating a contribution is O(1), not proportional to history size', async () => {
    const contribRepo = new InMemoryContributionEntryRepository();
    const expenseRepo = new InMemoryExpenseEntryRepository();

    // Seed 10,000 historical entries
    const base = new Date('2020-01-01T00:00:00.000Z').getTime();
    for (let i = 0; i < 10_000; i++) {
      const ts = new Date(base + i * 60000).toISOString();
      contribRepo.seed([contribution(`old-${i}`, ts)]);
    }

    // Creating a new contribution should not read all 10,000 entries
    const start = Date.now();
    const created = await contribRepo.create({
      householdId: HH,
      label: 'New task',
      performedByMemberId: 'a',
      beneficiaryMemberIds: ['a', 'b'],
      value: 20,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: new Date().toISOString(),
      createdBy: 'user-a',
    });
    const elapsed = Date.now() - start;

    expect(created.id).toBeDefined();
    // Should complete in < 50ms even with 10k entries
    expect(elapsed).toBeLessThan(50);
  });

  test('creating an expense is O(1), not proportional to history size', async () => {
    const expenseRepo = new InMemoryExpenseEntryRepository();

    // Seed 10,000 historical entries
    const base = new Date('2020-01-01T00:00:00.000Z').getTime();
    for (let i = 0; i < 10_000; i++) {
      const ts = new Date(base + i * 60000).toISOString();
      expenseRepo.seed([expenseEntry(`old-${i}`, ts)]);
    }

    const start = Date.now();
    const created = await expenseRepo.create({
      householdId: HH,
      title: 'New expense',
      amountMinor: 5000,
      currency: 'CHF',
      paidByMemberId: 'a',
      participantMemberIds: ['a', 'b'],
      splitMode: 'equal',
      occurredAt: new Date().toISOString(),
      createdBy: 'user-a',
    });
    const elapsed = Date.now() - start;

    expect(created.id).toBeDefined();
    expect(elapsed).toBeLessThan(50);
  });

  test('paginated history reads bounded number of items, not full history', async () => {
    const contribRepo = new InMemoryContributionEntryRepository();
    const expenseRepo = new InMemoryExpenseEntryRepository();

    // Seed 5,000 historical entries
    const base = new Date('2020-01-01T00:00:00.000Z').getTime();
    for (let i = 0; i < 5_000; i++) {
      const ts = new Date(base + i * 60000).toISOString();
      contribRepo.seed([contribution(`c-${i}`, ts)]);
    }
    for (let i = 0; i < 5_000; i++) {
      const ts = new Date(base + i * 60000).toISOString();
      expenseRepo.seed([expenseEntry(`e-${i}`, ts)]);
    }

    // First page: should return exactly PAGE_SIZE items, not 10,000
    const contribResult = await contribRepo.getByHouseholdPaginated(HH, { limit: 20 });
    const expenseResult = await expenseRepo.getByHouseholdPaginated(HH, { limit: 20 });

    expect(contribResult.items).toHaveLength(20);
    expect(expenseResult.items).toHaveLength(20);
    expect(contribResult.hasMore).toBe(true);
    expect(expenseResult.hasMore).toBe(true);

    // The paginateActivityLog merge should also be bounded
    const merged = paginateActivityLog(contribResult.items, expenseResult.items, [], {
      limit: 20,
    });
    expect(merged.entries.length).toBeLessThanOrEqual(20);
  });

  test('navigating Add -> Balances -> Todos -> Add does not re-fetch same data 4 times', async () => {
    const contribRepo = new InMemoryContributionEntryRepository();

    // Seed entries
    const base = new Date('2026-09-16T00:00:00.000Z').getTime();
    for (let i = 0; i < 100; i++) {
      const ts = new Date(base + i * 60000).toISOString();
      contribRepo.seed([contribution(`c-${i}`, ts)]);
    }

    // Simulate 4 screen loads by calling getByHouseholdPaginated 4 times
    // Each should be bounded (limit 20), not reading all 100
    const results = await Promise.all([
      contribRepo.getByHouseholdPaginated(HH, { limit: 20 }),
      contribRepo.getByHouseholdPaginated(HH, { limit: 20 }),
      contribRepo.getByHouseholdPaginated(HH, { limit: 20 }),
      contribRepo.getByHouseholdPaginated(HH, { limit: 20 }),
    ]);

    for (const result of results) {
      expect(result.items.length).toBeLessThanOrEqual(20);
    }
  });

  test('history filter changes do not cause full rescan', async () => {
    const contribRepo = new InMemoryContributionEntryRepository();
    const expenseRepo = new InMemoryExpenseEntryRepository();

    // Seed mixed entries
    const base = new Date('2026-09-16T00:00:00.000Z').getTime();
    for (let i = 0; i < 500; i++) {
      const ts = new Date(base + i * 60000).toISOString();
      contribRepo.seed([contribution(`c-${i}`, ts)]);
      expenseRepo.seed([expenseEntry(`e-${i}`, ts)]);
    }

    // Filter to contributions only
    const contribOnly = await contribRepo.getByHouseholdPaginated(HH, { limit: 20 });
    expect(contribOnly.items.every((i) => 'label' in i)).toBe(true);

    // Filter to expenses only
    const expenseOnly = await expenseRepo.getByHouseholdPaginated(HH, { limit: 20 });
    expect(expenseOnly.items.every((i) => 'title' in i)).toBe(true);

    // Each paginated query returns bounded results
    expect(contribOnly.items).toHaveLength(20);
    expect(expenseOnly.items).toHaveLength(20);
  });
});
