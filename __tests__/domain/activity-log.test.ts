/**
 * ChoreScore V3 — Activity Log Tests
 *
 * Tests the unified activity log service: merge, pagination, filtering.
 * Validates cursor-based pagination correctness, filter isolation,
 * and deterministic ordering.
 */

import {
  ContributionEntry,
  ExpenseEntry,
  CrossLedgerSettlement,
} from '../../src/domain/entities';
import {
  paginateActivityLog,
  countActivityEntries,
} from '../../src/domain/calculations/activityLog';

// ── Fixtures ──────────────────────────────────────────────────

function contribution(overrides: Partial<ContributionEntry> = {}): ContributionEntry {
  return {
    id: 'c-1',
    householdId: 'h-1',
    label: 'Vaisselle',
    performedByMemberId: 'a',
    beneficiaryMemberIds: ['a', 'b'],
    value: 15,
    unit: 'minutes',
    persistentTaskId: null,
    occurredAt: '2026-09-16T10:00:00.000Z',
    createdBy: 'user-a',
    ...overrides,
  };
}

function expense(overrides: Partial<ExpenseEntry> = {}): ExpenseEntry {
  return {
    id: 'e-1',
    householdId: 'h-1',
    title: 'Courses',
    amountMinor: 4250,
    currency: 'CHF',
    paidByMemberId: 'a',
    participantMemberIds: ['a', 'b'],
    splitMode: 'equal',
    occurredAt: '2026-09-16T11:00:00.000Z',
    createdBy: 'user-a',
    ...overrides,
  };
}

function settlement(overrides: Partial<CrossLedgerSettlement> = {}): CrossLedgerSettlement {
  return {
    id: 's-1',
    householdId: 'h-1',
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
    occurredAt: '2026-09-16T12:00:00.000Z',
    createdBy: 'user-a',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('paginateActivityLog', () => {
  test('merges contributions and expenses in DESC chronological order', () => {
    const contributions = [
      contribution({ id: 'c-old', occurredAt: '2026-09-15T10:00:00.000Z' }),
      contribution({ id: 'c-new', occurredAt: '2026-09-16T10:00:00.000Z' }),
    ];
    const expenses = [
      expense({ id: 'e-mid', occurredAt: '2026-09-16T09:00:00.000Z' }),
    ];

    const result = paginateActivityLog(contributions, expenses, []);

    expect(result.entries).toHaveLength(3);
    // Newest first
    expect(result.entries[0].entry.id).toBe('c-new');
    expect(result.entries[1].entry.id).toBe('e-mid');
    expect(result.entries[2].entry.id).toBe('c-old');
    expect(result.hasMore).toBe(false);
  });

  test('includes settlements in the merged stream', () => {
    const contributions = [
      contribution({ occurredAt: '2026-09-16T10:00:00.000Z' }),
    ];
    const settlements = [
      settlement({ occurredAt: '2026-09-16T12:00:00.000Z' }),
    ];

    const result = paginateActivityLog(contributions, [], settlements);

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].type).toBe('cross-ledger-settlement');
    expect(result.entries[1].type).toBe('contribution');
  });

  test('cursor-based pagination returns correct pages', () => {
    // Create 5 entries 1 hour apart
    const contributions = Array.from({ length: 5 }, (_, i) =>
      contribution({
        id: `c-${i}`,
        occurredAt: `2026-09-16T${String(10 + i).padStart(2, '0')}:00:00.000Z`,
      })
    );

    // Page 1: limit 2
    const page1 = paginateActivityLog(contributions, [], [], { limit: 2 });
    expect(page1.entries).toHaveLength(2);
    expect(page1.entries[0].entry.id).toBe('c-4'); // newest
    expect(page1.entries[1].entry.id).toBe('c-3');
    expect(page1.hasMore).toBe(true);
    // Cursor is composite: { o: occurredAt, i: id }
    const cursor1 = JSON.parse(page1.cursor!);
    expect(cursor1.o).toBe('2026-09-16T13:00:00.000Z');
    expect(cursor1.i).toBe('c-3');

    // Page 2: use cursor from page 1
    const page2 = paginateActivityLog(contributions, [], [], {
      limit: 2,
      cursor: page1.cursor,
    });
    expect(page2.entries).toHaveLength(2);
    expect(page2.entries[0].entry.id).toBe('c-2');
    expect(page2.entries[1].entry.id).toBe('c-1');
    expect(page2.hasMore).toBe(true);

    // Page 3
    const page3 = paginateActivityLog(contributions, [], [], {
      limit: 2,
      cursor: page2.cursor,
    });
    expect(page3.entries).toHaveLength(1);
    expect(page3.entries[0].entry.id).toBe('c-0');
    expect(page3.hasMore).toBe(false);
    expect(page3.cursor).toBeNull();
  });

  test('filter=contribution shows only contributions', () => {
    const contributions = [
      contribution({ id: 'c-1', occurredAt: '2026-09-16T10:00:00.000Z' }),
    ];
    const expenses = [
      expense({ id: 'e-1', occurredAt: '2026-09-16T11:00:00.000Z' }),
    ];

    const result = paginateActivityLog(contributions, expenses, [], { filter: 'contribution' });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe('contribution');
  });

  test('filter=expense shows only expenses', () => {
    const contributions = [
      contribution({ id: 'c-1', occurredAt: '2026-09-16T10:00:00.000Z' }),
    ];
    const expenses = [
      expense({ id: 'e-1', occurredAt: '2026-09-16T11:00:00.000Z' }),
    ];

    const result = paginateActivityLog(contributions, expenses, [], { filter: 'expense' });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe('expense');
  });

  test('filter=settlement shows only settlements', () => {
    const settlements = [
      settlement({ id: 's-1', occurredAt: '2026-09-16T12:00:00.000Z' }),
    ];

    const result = paginateActivityLog([], [], settlements, { filter: 'settlement' });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe('cross-ledger-settlement');
  });

  test('returns empty page when no entries match filter', () => {
    const contributions = [
      contribution({ occurredAt: '2026-09-16T10:00:00.000Z' }),
    ];

    const result = paginateActivityLog(contributions, [], [], { filter: 'expense' });
    expect(result.entries).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();
  });

  test('handles empty inputs gracefully', () => {
    const result = paginateActivityLog([], [], []);
    expect(result.entries).toHaveLength(0);
    expect(result.hasMore).toBe(false);
    expect(result.cursor).toBeNull();
  });

  test('entries at the exact same occurredAt are tie-broken by entry id', () => {
    const ts = '2026-09-16T10:00:00.000Z';
    const contributions = [contribution({ id: 'c-1', occurredAt: ts })];
    const expenses = [expense({ id: 'e-1', occurredAt: ts })];

    const result = paginateActivityLog(contributions, expenses, []);
    expect(result.entries).toHaveLength(2);
    // Tie broken by entry id DESC: 'e-1' > 'c-1' alphabetically
    expect(result.entries[0].entry.id).toBe('e-1');
    expect(result.entries[1].entry.id).toBe('c-1');
  });
});

describe('countActivityEntries', () => {
  test('counts all entries with filter=all', () => {
    const contributions = [contribution(), contribution({ id: 'c-2' })];
    const expenses = [expense()];
    const settlements = [settlement()];

    expect(countActivityEntries(contributions, expenses, settlements, 'all')).toBe(4);
  });

  test('counts contributions only', () => {
    expect(countActivityEntries([contribution()], [expense()], [], 'contribution')).toBe(1);
  });

  test('counts expenses only', () => {
    expect(countActivityEntries([contribution()], [expense()], [], 'expense')).toBe(1);
  });

  test('counts settlements only', () => {
    expect(countActivityEntries([], [], [settlement()], 'settlement')).toBe(1);
  });
});
