/**
 * ChoreScore V3 — Merged Two-Repo Pagination Tests
 *
 * Tests the two-repo merged pagination path used by the Add screen:
 * - separate cursors per repo (contributions and expenses)
 * - deterministic merge by occurredAt DESC
 * - no duplicate ids across pages
 * - no gaps in the merged stream
 * - older pages reachable via "load more"
 * - no hard 150-entry cap
 * - cost gate: bounded reads
 */

import {
  InMemoryContributionEntryRepository,
  InMemoryExpenseEntryRepository,
} from '../../src/infrastructure/repositories/InMemoryRepositories';
import {
  ContributionEntry,
  ExpenseEntry,
} from '../../src/domain/entities';
import { paginateActivityLog } from '../../src/domain/calculations/activityLog';

const HH = 'h-1';
const PAGE_SIZE = 15;

// ── Fixtures ──────────────────────────────────────────────────

function makeContribution(id: string, ts: string): ContributionEntry {
  return {
    id,
    householdId: HH,
    label: `Task ${id}`,
    performedByMemberId: 'a',
    beneficiaryMemberIds: ['a', 'b'],
    value: 15,
    unit: 'minutes',
    persistentTaskId: null,
    occurredAt: ts,
    createdBy: 'user-a',
  };
}

function makeExpense(id: string, ts: string): ExpenseEntry {
  return {
    id,
    householdId: HH,
    title: `Expense ${id}`,
    amountMinor: 1000,
    currency: 'CHF',
    paidByMemberId: 'a',
    participantMemberIds: ['a', 'b'],
    splitMode: 'equal',
    occurredAt: ts,
    createdBy: 'user-a',
  };
}

/**
 * Simulate the Add screen's pagination across multiple pages.
 *
 * The screen accumulates entries from both repos, then merge-sorts all
 * accumulated entries. Each "load more" fetches PAGE_SIZE from each repo,
 * appends to the accumulated arrays, and the useMemo re-derives the
 * merged list.
 *
 * Returns the final merged list after all pages are loaded.
 */
async function loadAllPages(
  contribRepo: InMemoryContributionEntryRepository,
  expenseRepo: InMemoryExpenseEntryRepository,
  filter: 'all' | 'contribution' | 'expense' = 'all',
): Promise<{
  allEntries: ReturnType<typeof paginateActivityLog>['entries'];
  pageCount: number;
  allContribs: ContributionEntry[];
  allExpenses: ExpenseEntry[];
}> {
  let contribCursor: string | null = null;
  let expenseCursor: string | null = null;
  let contribExhausted = false;
  let expenseExhausted = false;
  let hasMore = true;
  let allContribs: ContributionEntry[] = [];
  let allExpenses: ExpenseEntry[] = [];
  let pageCount = 0;

  while (hasMore) {
    // Fetch PAGE_SIZE from each repo (skip exhausted repos)
    const contribResult: { items: ContributionEntry[]; cursor: string | null; hasMore: boolean } =
      contribExhausted
        ? { items: [], cursor: null, hasMore: false }
        : await contribRepo.getByHouseholdPaginated(HH, {
            limit: PAGE_SIZE,
            cursor: contribCursor ?? undefined,
          });
    const expenseResult: { items: ExpenseEntry[]; cursor: string | null; hasMore: boolean } =
      expenseExhausted
        ? { items: [], cursor: null, hasMore: false }
        : await expenseRepo.getByHouseholdPaginated(HH, {
            limit: PAGE_SIZE,
            cursor: expenseCursor ?? undefined,
          });

    // Accumulate (screen appends to state arrays)
    allContribs = [...allContribs, ...contribResult.items];
    allExpenses = [...allExpenses, ...expenseResult.items];

    contribCursor = contribResult.cursor;
    expenseCursor = expenseResult.cursor;
    contribExhausted = contribResult.cursor === null && !contribResult.hasMore;
    expenseExhausted = expenseResult.cursor === null && !expenseResult.hasMore;
    hasMore = contribResult.hasMore || expenseResult.hasMore;
    pageCount++;

    if (pageCount > 20) break; // safety
  }

  // Merge all accumulated entries (screen's useMemo, large limit)
  const merged = paginateActivityLog(allContribs, allExpenses, [], {
    limit: 10_000,
    filter,
  });

  return {
    allEntries: merged.entries,
    pageCount,
    allContribs,
    allExpenses,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('Two-repo merged pagination', () => {
  let contribRepo: InMemoryContributionEntryRepository;
  let expenseRepo: InMemoryExpenseEntryRepository;

  beforeEach(() => {
    contribRepo = new InMemoryContributionEntryRepository();
    expenseRepo = new InMemoryExpenseEntryRepository();
  });

  test('no duplicate ids across multiple pages', async () => {
    // Seed interleaved contributions and expenses (more than PAGE_SIZE each)
    const base = new Date('2026-09-16T00:00:00.000Z').getTime();
    for (let i = 0; i < 40; i++) {
      const ts = new Date(base + i * 3600000).toISOString(); // 1 hour apart
      contribRepo.seed([makeContribution(`c-${i}`, ts)]);
      expenseRepo.seed([makeExpense(`e-${i}`, ts)]);
    }

    const { allEntries } = await loadAllPages(contribRepo, expenseRepo);

    // Total: 40 contributions + 40 expenses = 80 entries
    expect(allEntries).toHaveLength(80);

    // No duplicate ids
    const ids = allEntries.map((e) => e.entry.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test('no gaps in the merged stream (all entries reachable)', async () => {
    const base = new Date('2026-09-16T00:00:00.000Z').getTime();
    for (let i = 0; i < 30; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      contribRepo.seed([makeContribution(`c-${i}`, ts)]);
      expenseRepo.seed([makeExpense(`e-${i}`, ts)]);
    }

    const { allEntries } = await loadAllPages(contribRepo, expenseRepo);

    // Total: 60 entries
    expect(allEntries).toHaveLength(60);

    // All entries are present (no gaps)
    const ids = new Set(allEntries.map((e) => e.entry.id));
    for (let i = 0; i < 30; i++) {
      expect(ids.has(`c-${i}`)).toBe(true);
      expect(ids.has(`e-${i}`)).toBe(true);
    }
  });

  test('older pages reachable via cursor progression', async () => {
    const base = new Date('2026-09-16T00:00:00.000Z').getTime();
    // Seed 50 contributions and 50 expenses
    for (let i = 0; i < 50; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      contribRepo.seed([makeContribution(`c-${i}`, ts)]);
      expenseRepo.seed([makeExpense(`e-${i}`, ts)]);
    }

    // Load page 1: PAGE_SIZE from each repo, merge
    const page1Contribs = await contribRepo.getByHouseholdPaginated(HH, { limit: PAGE_SIZE });
    const page1Expenses = await expenseRepo.getByHouseholdPaginated(HH, { limit: PAGE_SIZE });
    const page1 = paginateActivityLog(page1Contribs.items, page1Expenses.items, [], { limit: 10_000 });
    expect(page1.entries.length).toBeGreaterThan(0);

    // Load page 2: using cursors from page 1
    const page2Contribs = await contribRepo.getByHouseholdPaginated(HH, {
      limit: PAGE_SIZE,
      cursor: page1Contribs.cursor ?? undefined,
    });
    const page2Expenses = await expenseRepo.getByHouseholdPaginated(HH, {
      limit: PAGE_SIZE,
      cursor: page1Expenses.cursor ?? undefined,
    });
    const page2 = paginateActivityLog(page2Contribs.items, page2Expenses.items, [], { limit: 10_000 });
    expect(page2.entries.length).toBeGreaterThan(0);

    // Page 2 entries are older than page 1 entries
    const page1Newest = page1.entries[0].entry.occurredAt;
    const page2Newest = page2.entries[0].entry.occurredAt;
    expect(page2Newest.localeCompare(page1Newest)).toBeLessThan(0);

    // No overlap between page batches
    const page1Ids = new Set(page1.entries.map((e) => e.entry.id));
    for (const entry of page2.entries) {
      expect(page1Ids.has(entry.entry.id)).toBe(false);
    }
  });

  test('no hard 150-entry cap — all loaded pages visible', async () => {
    // Seed more entries than the old 150 cap
    const base = new Date('2026-09-16T00:00:00.000Z').getTime();
    for (let i = 0; i < 100; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      contribRepo.seed([makeContribution(`c-${i}`, ts)]);
    }
    for (let i = 0; i < 100; i++) {
      const ts = new Date(base + i * 3600000 + 1800000).toISOString(); // offset by 30min
      expenseRepo.seed([makeExpense(`e-${i}`, ts)]);
    }

    const { allEntries, pageCount } = await loadAllPages(contribRepo, expenseRepo);

    // Total: 200 entries (100 contrib + 100 expense), all visible
    expect(allEntries).toHaveLength(200);
    expect(pageCount).toBeGreaterThan(1);

    // The old cap was 150 — now all 200 are accessible
    const ids = new Set(allEntries.map((e) => e.entry.id));
    expect(ids.size).toBe(200);
  });

  test('merged list is sorted by occurredAt DESC', async () => {
    const base = new Date('2026-09-16T00:00:00.000Z').getTime();
    for (let i = 0; i < 20; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      contribRepo.seed([makeContribution(`c-${i}`, ts)]);
      expenseRepo.seed([makeExpense(`e-${i}`, ts)]);
    }

    const { allEntries } = await loadAllPages(contribRepo, expenseRepo);

    // Verify DESC order
    for (let i = 1; i < allEntries.length; i++) {
      const prev = allEntries[i - 1].entry.occurredAt;
      const curr = allEntries[i].entry.occurredAt;
      // prev should be >= curr (DESC)
      expect(prev.localeCompare(curr)).toBeGreaterThanOrEqual(0);
    }
  });

  test('filter=contribution shows only contributions', async () => {
    const base = new Date('2026-09-16T00:00:00.000Z').getTime();
    for (let i = 0; i < 20; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      contribRepo.seed([makeContribution(`c-${i}`, ts)]);
      expenseRepo.seed([makeExpense(`e-${i}`, ts)]);
    }

    const { allEntries } = await loadAllPages(contribRepo, expenseRepo, 'contribution');
    expect(allEntries.every((e) => e.type === 'contribution')).toBe(true);
    expect(allEntries).toHaveLength(20);
  });

  test('filter=expense shows only expenses', async () => {
    const base = new Date('2026-09-16T00:00:00.000Z').getTime();
    for (let i = 0; i < 20; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      contribRepo.seed([makeContribution(`c-${i}`, ts)]);
      expenseRepo.seed([makeExpense(`e-${i}`, ts)]);
    }

    const { allEntries } = await loadAllPages(contribRepo, expenseRepo, 'expense');
    expect(allEntries.every((e) => e.type === 'expense')).toBe(true);
    expect(allEntries).toHaveLength(20);
  });

  test('per-repo cursors advance independently (one repo much newer)', async () => {
    // Seed contributions that are much newer than expenses
    const base = new Date('2026-09-16T00:00:00.000Z').getTime();

    // 30 contributions in the far future
    for (let i = 0; i < 30; i++) {
      const ts = new Date(base + (1000 + i) * 3600000).toISOString();
      contribRepo.seed([makeContribution(`c-${i}`, ts)]);
    }
    // 30 expenses in the near past
    for (let i = 0; i < 30; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      expenseRepo.seed([makeExpense(`e-${i}`, ts)]);
    }

    const { allEntries } = await loadAllPages(contribRepo, expenseRepo);

    // All 60 entries should be reachable
    expect(allEntries).toHaveLength(60);

    const contribIds = allEntries.filter((e) => e.type === 'contribution').map((e) => e.entry.id);
    const expenseIds = allEntries.filter((e) => e.type === 'expense').map((e) => e.entry.id);
    expect(contribIds).toHaveLength(30);
    expect(expenseIds).toHaveLength(30);
  });

  test('handles one repo exhausted while the other still has items', async () => {
    const base = new Date('2026-09-16T00:00:00.000Z').getTime();

    // 5 contributions
    for (let i = 0; i < 5; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      contribRepo.seed([makeContribution(`c-${i}`, ts)]);
    }
    // 50 expenses
    for (let i = 0; i < 50; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      expenseRepo.seed([makeExpense(`e-${i}`, ts)]);
    }

    const { allEntries } = await loadAllPages(contribRepo, expenseRepo);

    // All 55 entries reachable
    expect(allEntries).toHaveLength(55);

    const contribIds = allEntries.filter((e) => e.type === 'contribution').map((e) => e.entry.id);
    const expenseIds = allEntries.filter((e) => e.type === 'expense').map((e) => e.entry.id);
    expect(contribIds).toHaveLength(5);
    expect(expenseIds).toHaveLength(50);
  });

  test('handles empty repos gracefully', async () => {
    const { allEntries, pageCount } = await loadAllPages(contribRepo, expenseRepo);
    expect(allEntries).toHaveLength(0);
    expect(pageCount).toBe(1); // First page always runs
  });

  test('handles one empty repo and one with items', async () => {
    const base = new Date('2026-09-16T00:00:00.000Z').getTime();
    for (let i = 0; i < 20; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      contribRepo.seed([makeContribution(`c-${i}`, ts)]);
    }

    const { allEntries } = await loadAllPages(contribRepo, expenseRepo);
    expect(allEntries).toHaveLength(20);
    expect(allEntries.every((e) => e.type === 'contribution')).toBe(true);
  });

  test('entries with identical occurredAt are tie-broken by entry id', async () => {
    const ts = '2026-09-16T10:00:00.000Z';
    contribRepo.seed([makeContribution('c-1', ts)]);
    expenseRepo.seed([makeExpense('e-1', ts)]);

    const contribResult = await contribRepo.getByHouseholdPaginated(HH, { limit: PAGE_SIZE });
    const expenseResult = await expenseRepo.getByHouseholdPaginated(HH, { limit: PAGE_SIZE });
    const merged = paginateActivityLog(contribResult.items, expenseResult.items, [], { limit: 10_000 });

    expect(merged.entries).toHaveLength(2);
    // Tie broken by entry id DESC: 'e-1' > 'c-1' alphabetically
    expect(merged.entries[0].entry.id).toBe('e-1');
    expect(merged.entries[1].entry.id).toBe('c-1');
  });

  test('entries with identical occurredAt spanning PAGE_SIZE boundary are all reachable', async () => {
    // Seed PAGE_SIZE + 5 contributions with the SAME occurredAt plus 5 older entries
    const sharedTs = '2026-09-16T10:00:00.000Z';
    const olderTs = '2026-09-15T10:00:00.000Z';
    const sharedIds: string[] = [];
    for (let i = 0; i < PAGE_SIZE + 5; i++) {
      const id = `shared-${i}`;
      sharedIds.push(id);
      contribRepo.seed([makeContribution(id, sharedTs)]);
    }
    // 5 older entries (different timestamp)
    for (let i = 0; i < 5; i++) {
      contribRepo.seed([makeContribution(`older-${i}`, olderTs)]);
    }

    // Page through until exhausted
    const allFoundIds: string[] = [];
    let cursor: string | undefined;
    let hasMore = true;
    while (hasMore) {
      const result = await contribRepo.getByHouseholdPaginated(HH, {
        limit: PAGE_SIZE,
        cursor,
      });
      for (const item of result.items) {
        allFoundIds.push(item.id);
      }
      hasMore = result.hasMore;
      cursor = result.cursor ?? undefined;
    }

    // All 25 shared-timestamp entries + 5 older = 30 entries reachable
    expect(allFoundIds).toHaveLength(PAGE_SIZE + 5 + 5);
    // Every seeded id is reachable exactly once
    const allSeededIds = [...sharedIds, ...Array.from({ length: 5 }, (_, i) => `older-${i}`)];
    const foundSet = new Set(allFoundIds);
    for (const seededId of allSeededIds) {
      expect(foundSet.has(seededId)).toBe(true);
    }
    // No duplicates
    expect(new Set(allFoundIds).size).toBe(allFoundIds.length);
  });

  test('concurrent load-more calls do not duplicate entries (in-flight guard)', async () => {
    // Seed contributions
    const base = new Date('2026-09-16T00:00:00.000Z').getTime();
    for (let i = 0; i < 40; i++) {
      const ts = new Date(base + i * 3600000).toISOString();
      contribRepo.seed([makeContribution(`c-${i}`, ts)]);
    }

    // Simulate two concurrent load-more calls with same cursor state
    let allContribs: ContributionEntry[] = [];
    let cursor: string | null = null;
    let exhausted = false;

    // Fetch first page
    const firstPage = await contribRepo.getByHouseholdPaginated(HH, {
      limit: PAGE_SIZE,
    });
    allContribs = [...firstPage.items];
    cursor = firstPage.cursor;
    exhausted = firstPage.cursor === null && !firstPage.hasMore;

    // Simulate two concurrent "load more" calls with the same cursor
    const fetch1 = exhausted
      ? { items: [], cursor: null, hasMore: false }
      : await contribRepo.getByHouseholdPaginated(HH, { limit: PAGE_SIZE, cursor: cursor! });
    const fetch2 = exhausted
      ? { items: [], cursor: null, hasMore: false }
      : await contribRepo.getByHouseholdPaginated(HH, { limit: PAGE_SIZE, cursor: cursor! });

    // Both return the same page (simulating concurrent calls with same cursor)
    expect(fetch1.items).toHaveLength(fetch2.items.length);

    // Merge with dedup (simulating the in-flight guard in add.tsx)
    const existingIds = new Set(allContribs.map((e) => e.id));
    for (const item of fetch1.items) {
      if (!existingIds.has(item.id)) {
        allContribs.push(item);
        existingIds.add(item.id);
      }
    }
    // Second concurrent call should be blocked by guard, but if merged: no duplicates
    for (const item of fetch2.items) {
      if (!existingIds.has(item.id)) {
        allContribs.push(item);
        existingIds.add(item.id);
      }
    }

    // No duplicates in final list
    const ids = allContribs.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Should have PAGE_SIZE entries from page 1 + PAGE_SIZE from page 2 (not duplicated)
    expect(ids.length).toBe(PAGE_SIZE + PAGE_SIZE);
  });

  test('cost gate: creating a contribution is O(1), not proportional to history', async () => {
    // Seed 10,000 historical entries
    const base = new Date('2020-01-01T00:00:00.000Z').getTime();
    for (let i = 0; i < 10_000; i++) {
      const ts = new Date(base + i * 60000).toISOString();
      contribRepo.seed([makeContribution(`old-${i}`, ts)]);
    }

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
    expect(elapsed).toBeLessThan(50);
  });

  test('cost gate: paginated history reads bounded items, not full history', async () => {
    const base = new Date('2020-01-01T00:00:00.000Z').getTime();
    for (let i = 0; i < 5_000; i++) {
      const ts = new Date(base + i * 60000).toISOString();
      contribRepo.seed([makeContribution(`c-${i}`, ts)]);
    }
    for (let i = 0; i < 5_000; i++) {
      const ts = new Date(base + i * 60000).toISOString();
      expenseRepo.seed([makeExpense(`e-${i}`, ts)]);
    }

    // First page: should return exactly PAGE_SIZE items per repo, not 5000
    const contribResult = await contribRepo.getByHouseholdPaginated(HH, { limit: PAGE_SIZE });
    const expenseResult = await expenseRepo.getByHouseholdPaginated(HH, { limit: PAGE_SIZE });

    expect(contribResult.items).toHaveLength(PAGE_SIZE);
    expect(expenseResult.items).toHaveLength(PAGE_SIZE);
    expect(contribResult.hasMore).toBe(true);
    expect(expenseResult.hasMore).toBe(true);
  });
});
