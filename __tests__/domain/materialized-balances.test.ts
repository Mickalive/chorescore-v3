/**
 * ChoreScore V3 — Materialized Balance Tests (V3-04)
 *
 * Verifies that:
 * 1. Materialized balances are identical to full ledger replay
 * 2. Delta updates produce the same result as full recomputation
 * 3. Period filtering is a view, not a reset
 * 4. Cross-ledger settlements are reflected in both ledgers
 * 5. Contribution zero-sum invariant holds after every operation
 * 6. Financial zero-sum invariant holds after every operation
 */

import {
  ContributionEntry,
  ExpenseEntry,
  CrossLedgerSettlement,
  Household,
} from '../../src/domain/entities';
import {
  calculateContributionBalances,
  balancesToArray,
  contributionLedgerIsZeroSum,
  suggestContributionTransfers,
} from '../../src/domain/calculations/contributionLedger';
import {
  calculateFinancialBalancesByCurrency,
  financialBalancesToArray,
  financialLedgerIsZeroSum,
  suggestMoneyTransfers,
} from '../../src/domain/calculations/expenseLedger';
import {
  computePeriodContributionBalances,
  computePeriodFinancialBalances,
  createBalanceSnapshot,
  deltaUpdateContribution,
  deltaUpdateContributionFromSettlement,
  BalanceSnapshot,
} from '../../src/domain/calculations/materializedBalances';
import { filterByPeriod, Period, periodBoundary, isInPeriod } from '../../src/domain/calculations/periods';
import {
  quoteCrossLedgerMoneyAmount,
} from '../../src/domain/calculations/crossLedgerSettlement';

// ── Test data ──────────────────────────────────────────────────

const MEMBER_IDS = ['a', 'b', 'c'];

function contribution(overrides: Partial<ContributionEntry> = {}): ContributionEntry {
  return {
    id: 'c-1',
    householdId: 'h-1',
    label: 'Vaisselle',
    performedByMemberId: 'a',
    beneficiaryMemberIds: ['a', 'b', 'c'],
    value: 60,
    unit: 'minutes',
    persistentTaskId: null,
    occurredAt: '2026-09-16T12:00:00.000Z',
    createdBy: 'user-a',
    ...overrides,
  };
}

function expense(overrides: Partial<ExpenseEntry> = {}): ExpenseEntry {
  return {
    id: 'e-1',
    householdId: 'h-1',
    title: 'Courses',
    amountMinor: 3000,
    currency: 'CHF',
    paidByMemberId: 'a',
    participantMemberIds: ['a', 'b'],
    splitMode: 'equal',
    occurredAt: '2026-09-16T12:00:00.000Z',
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
    createdBy: 'user-a',
    ...overrides,
  };
}

// ── Tests: Materialized == Full Replay ─────────────────────────

describe('V3-04 materialized balances: reconstruction invariant', () => {
  test('materialized contribution balances equal full replay for all-time', () => {
    const entries = [
      contribution({ id: 'c-1', value: 60, occurredAt: '2026-09-01T10:00:00.000Z' }),
      contribution({ id: 'c-2', value: 30, performedByMemberId: 'b', beneficiaryMemberIds: ['a', 'c'], occurredAt: '2026-09-10T10:00:00.000Z' }),
      contribution({ id: 'c-3', value: 45, performedByMemberId: 'c', beneficiaryMemberIds: ['a', 'b', 'c'], occurredAt: '2026-09-15T10:00:00.000Z' }),
    ];
    const settlements = [settlement()];

    // Full replay
    const fullReplay = calculateContributionBalances(entries, 'minutes', settlements, MEMBER_IDS);

    // Materialized (same as full for all-time)
    const materialized = computePeriodContributionBalances(entries, 'minutes', settlements, MEMBER_IDS, 'all-time');

    // Must be identical
    expect(balancesToArray(materialized)).toEqual(balancesToArray(fullReplay));
    expect(contributionLedgerIsZeroSum(materialized)).toBe(true);
  });

  test('materialized financial balances equal full replay for all-time', () => {
    const entries = [
      expense({ id: 'e-1', amountMinor: 3000, occurredAt: '2026-09-01T10:00:00.000Z' }),
      expense({ id: 'e-2', amountMinor: 1500, paidByMemberId: 'b', participantMemberIds: ['a', 'b'], occurredAt: '2026-09-10T10:00:00.000Z' }),
    ];
    const settlements = [settlement()];

    // Full replay
    const fullReplay = calculateFinancialBalancesByCurrency(entries, settlements, MEMBER_IDS);

    // Materialized
    const materialized = computePeriodFinancialBalances(entries, settlements, MEMBER_IDS, 'all-time');

    // Must be identical per currency
    for (const [currency, fullBalances] of fullReplay) {
      const matBalances = materialized.get(currency);
      expect(matBalances).toBeDefined();
      expect(balancesToArray(matBalances!)).toEqual(balancesToArray(fullBalances));
      expect(financialLedgerIsZeroSum(matBalances!)).toBe(true);
    }
  });

  test('createBalanceSnapshot produces identical result to independent computation', () => {
    const contribs = [
      contribution({ id: 'c-1', value: 60 }),
      contribution({ id: 'c-2', value: 30, performedByMemberId: 'b', beneficiaryMemberIds: ['a', 'c'] }),
    ];
    const exps = [
      expense({ id: 'e-1', amountMinor: 3000 }),
    ];
    const sett = [settlement()];

    const snapshot = createBalanceSnapshot(contribs, exps, sett, 'minutes', MEMBER_IDS, 'all-time');

    const independentContrib = calculateContributionBalances(contribs, 'minutes', sett, MEMBER_IDS);
    const independentMoney = calculateFinancialBalancesByCurrency(exps, sett, MEMBER_IDS);

    expect(balancesToArray(snapshot.contribution)).toEqual(balancesToArray(independentContrib));
    for (const [currency, money] of independentMoney) {
      const snapMoney = snapshot.moneyByCurrency.get(currency);
      expect(snapMoney).toBeDefined();
      expect(balancesToArray(snapMoney!)).toEqual(balancesToArray(money));
    }
  });
});

// ── Tests: Period filtering is a VIEW, not a reset ─────────────

describe('V3-04 period views: never reset', () => {
  test('week view includes only current week entries', () => {
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
    monday.setHours(0, 0, 0, 0);

    const entries = [
      // This week
      contribution({ id: 'this-week', value: 60, occurredAt: new Date(monday.getTime() + 86400000).toISOString() }),
      // Last week
      contribution({ id: 'last-week', value: 30, occurredAt: new Date(monday.getTime() - 86400000).toISOString() }),
    ];

    const weekEntries = filterByPeriod(entries, 'week');
    expect(weekEntries).toHaveLength(1);
    expect(weekEntries[0].id).toBe('this-week');

    // The underlying entries array is NOT mutated
    expect(entries).toHaveLength(2);
  });

  test('all-time includes all entries regardless of date', () => {
    const entries = [
      contribution({ id: 'old', value: 10, occurredAt: '2020-01-01T00:00:00.000Z' }),
      contribution({ id: 'new', value: 20, occurredAt: '2026-12-31T23:59:59.999Z' }),
    ];

    const allTime = filterByPeriod(entries, 'all-time');
    expect(allTime).toHaveLength(2);
  });

  test('period-filtered balances are zero-sum', () => {
    const entries = [
      contribution({ id: 'c-1', value: 60, occurredAt: '2026-09-16T10:00:00.000Z' }),
      contribution({ id: 'c-2', value: 30, performedByMemberId: 'b', beneficiaryMemberIds: ['a', 'c'], occurredAt: '2026-09-16T11:00:00.000Z' }),
    ];

    const weekBalances = computePeriodContributionBalances(entries, 'minutes', [], MEMBER_IDS, 'week');
    expect(contributionLedgerIsZeroSum(weekBalances)).toBe(true);

    const monthBalances = computePeriodContributionBalances(entries, 'minutes', [], MEMBER_IDS, 'month');
    expect(contributionLedgerIsZeroSum(monthBalances)).toBe(true);
  });

  test('changing period never modifies the underlying data', () => {
    const entries = [
      contribution({ id: 'c-1', value: 60, occurredAt: '2026-09-16T10:00:00.000Z' }),
    ];
    const originalLength = entries.length;
    const originalFirst = { ...entries[0] };

    computePeriodContributionBalances(entries, 'minutes', [], MEMBER_IDS, 'week');
    computePeriodContributionBalances(entries, 'minutes', [], MEMBER_IDS, 'month');
    computePeriodContributionBalances(entries, 'minutes', [], MEMBER_IDS, 'year');

    expect(entries).toHaveLength(originalLength);
    expect(entries[0].id).toBe(originalFirst.id);
    expect(entries[0].value).toBe(originalFirst.value);
  });
});

// ── Tests: Delta updates ──────────────────────────────────────

describe('V3-04 delta updates: incremental correctness', () => {
  test('adding a contribution via delta produces same result as full replay', () => {
    const existing = [
      contribution({ id: 'c-1', value: 60, occurredAt: '2026-09-01T10:00:00.000Z' }),
    ];
    const newEntry = contribution({ id: 'c-2', value: 30, performedByMemberId: 'b', beneficiaryMemberIds: ['a', 'c'], occurredAt: '2026-09-16T10:00:00.000Z' });

    // Full replay with both entries
    const fullBalances = calculateContributionBalances([...existing, newEntry], 'minutes', [], MEMBER_IDS);

    // Delta approach: start from existing, add new
    const currentBalances = calculateContributionBalances(existing, 'minutes', [], MEMBER_IDS);
    const deltaBalances = deltaUpdateContribution(currentBalances, newEntry, 'minutes', MEMBER_IDS, 'add');

    // Must be identical
    expect(balancesToArray(deltaBalances)).toEqual(balancesToArray(fullBalances));
    expect(contributionLedgerIsZeroSum(deltaBalances)).toBe(true);
  });

  test('removing a contribution via delta produces same result as full replay without it', () => {
    const allEntries = [
      contribution({ id: 'c-1', value: 60, occurredAt: '2026-09-01T10:00:00.000Z' }),
      contribution({ id: 'c-2', value: 30, performedByMemberId: 'b', beneficiaryMemberIds: ['a', 'c'], occurredAt: '2026-09-16T10:00:00.000Z' }),
    ];
    const entryToRemove = allEntries[1];

    // Full replay without the removed entry
    const remaining = allEntries.filter((e) => e.id !== entryToRemove.id);
    const fullBalances = calculateContributionBalances(remaining, 'minutes', [], MEMBER_IDS);

    // Delta approach: start from all, remove
    const currentBalances = calculateContributionBalances(allEntries, 'minutes', [], MEMBER_IDS);
    const deltaBalances = deltaUpdateContribution(currentBalances, entryToRemove, 'minutes', MEMBER_IDS, 'remove');

    expect(balancesToArray(deltaBalances)).toEqual(balancesToArray(fullBalances));
    expect(contributionLedgerIsZeroSum(deltaBalances)).toBe(true);
  });

  test('settlement delta is consistent with full replay', () => {
    const contributions = [
      contribution({ id: 'c-1', value: 60, occurredAt: '2026-09-01T10:00:00.000Z' }),
    ];
    const sett = settlement();

    // Full replay includes settlement
    const withSettlement = calculateContributionBalances(contributions, 'minutes', [sett], MEMBER_IDS);

    // Delta: start without settlement, add it
    const withoutSettlement = calculateContributionBalances(contributions, 'minutes', [], MEMBER_IDS);
    const delta = deltaUpdateContributionFromSettlement(withoutSettlement, sett, 'minutes', 'add');

    expect(balancesToArray(delta)).toEqual(balancesToArray(withSettlement));
    expect(contributionLedgerIsZeroSum(delta)).toBe(true);
  });
});

// ── Tests: Settlement suggestions ──────────────────────────────

describe('V3-04 settlement suggestions: coherent pairwise', () => {
  test('contribution suggestions are greedy pairwise transfers', () => {
    const balances = new Map([
      ['a', 50],
      ['b', -20],
      ['c', -30],
    ]);

    const transfers = suggestContributionTransfers(balances, 'minutes');

    // Total amount transferred should equal total positive balance
    const totalTransferred = transfers.reduce((sum, t) => sum + t.value, 0);
    expect(totalTransferred).toBe(50);

    // Each transfer is from debtor to creditor
    for (const t of transfers) {
      expect(t.fromMemberId).toBeDefined();
      expect(t.toMemberId).toBeDefined();
      expect(t.value).toBeGreaterThan(0);
    }
  });

  test('money suggestions are greedy pairwise transfers', () => {
    const balances = new Map([
      ['a', 1000],
      ['b', -250],
      ['c', -750],
    ]);

    const transfers = suggestMoneyTransfers(balances, 'CHF');

    const totalTransferred = transfers.reduce((sum, t) => sum + t.amountMinor, 0);
    expect(totalTransferred).toBe(1000);

    for (const t of transfers) {
      expect(t.fromMemberId).toBeDefined();
      expect(t.toMemberId).toBeDefined();
      expect(t.amountMinor).toBeGreaterThan(0);
      expect(t.currency).toBe('CHF');
    }
  });

  test('no suggestions when balances are zero', () => {
    const balances = new Map([
      ['a', 0],
      ['b', 0],
    ]);

    expect(suggestContributionTransfers(balances, 'minutes')).toEqual([]);
    expect(suggestMoneyTransfers(balances, 'CHF')).toEqual([]);
  });
});

// ── Tests: Cross-ledger settlement integrity ───────────────────

describe('V3-04 cross-ledger settlement: both ledgers update correctly', () => {
  test('settlement updates both contribution and money balances while preserving zero-sum', () => {
    const contributions = [
      contribution({ id: 'c-1', value: 60, performedByMemberId: 'a', beneficiaryMemberIds: ['a', 'b'] }),
    ];
    const expenses = [
      expense({ id: 'e-1', amountMinor: 3000, paidByMemberId: 'b', participantMemberIds: ['a', 'b'] }),
    ];
    const sett = [
      settlement({ contributionValue: 15, moneyAmountMinor: 500 }),
    ];

    const contribBalances = calculateContributionBalances(contributions, 'minutes', sett, ['a', 'b']);
    const moneyBalances = calculateFinancialBalancesByCurrency(expenses, sett, ['a', 'b']);

    // Both should be zero-sum
    expect(contributionLedgerIsZeroSum(contribBalances)).toBe(true);
    const chfBalances = moneyBalances.get('CHF')!;
    expect(financialLedgerIsZeroSum(chfBalances)).toBe(true);

    // Contribution: a had +30 (from 60 split), settlement consumes 15 → a has +15
    expect(contribBalances.get('a')).toBe(15);
    // b had -30, settlement gives 15 → b has -15
    expect(contribBalances.get('b')).toBe(-15);

    // Money: b paid 3000, split equally → b had +1500, a had -1500
    // Settlement: a pays 500 to reduce debt → a has -1000, b has +1000
    expect(chfBalances.get('a')).toBe(-1000);
    expect(chfBalances.get('b')).toBe(1000);
  });

  test('settlement is immutable: rate snapshot is preserved', () => {
    const oldRate = {
      contributionValue: 60,
      contributionUnit: 'minutes' as const,
      moneyAmountMinor: 2000,
      currency: 'CHF',
    };
    const newRate = {
      contributionValue: 60,
      contributionUnit: 'minutes' as const,
      moneyAmountMinor: 3000,
      currency: 'CHF',
    };

    // Settlement created with old rate
    const s = settlement({ rateSnapshot: oldRate, moneyAmountMinor: 500 });

    // Even if the group rate changes later, the settlement uses its snapshot
    const quoted = quoteCrossLedgerMoneyAmount(15, 'minutes', s.rateSnapshot);
    expect(quoted).toBe(500); // Based on old rate, not new rate
  });

  test('no implicit conversion: contribution unit and currency are never mixed', () => {
    const contributions = [
      contribution({ id: 'c-1', value: 60, unit: 'minutes' }),
      contribution({ id: 'c-2', value: 9, unit: 'points' }),
    ];

    // Minutes-only balances should NOT include points
    const minuteBalances = calculateContributionBalances(contributions, 'minutes', [], MEMBER_IDS);
    // c-1: a performs 60 min for [a,b,c] → a gets +60 - 20 = +40
    expect(minuteBalances.get('a')).toBe(40); // Only from c-1

    // Points-only balances should NOT include minutes
    const pointBalances = calculateContributionBalances(contributions, 'points', [], MEMBER_IDS);
    // c-2: a performs 9 pts for [a,b,c] → a gets +9 - 3 = +6
    expect(pointBalances.get('a')).toBe(6); // Only from c-2
  });
});
