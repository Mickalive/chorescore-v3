/**
 * ChoreScore V3 — tests for shared validation, settlement preconditions,
 * and period/view helpers.
 */

import {
  ContributionEntry,
  CrossLedgerSettlement,
  ExpenseEntry,
} from '../../src/domain/entities';
import {
  calculateContributionBalances,
  contributionLedgerIsZeroSum,
} from '../../src/domain/calculations/contributionLedger';
import {
  calculateFinancialBalances,
  financialLedgerIsZeroSum,
} from '../../src/domain/calculations/expenseLedger';
import {
  validateCrossLedgerSettlement,
  quoteCrossLedgerMoneyAmount,
} from '../../src/domain/calculations/crossLedgerSettlement';
import {
  validateSettlementPreconditions,
  validateSettlementSequence,
  checkContributionSufficient,
  checkMoneyDebtSufficient,
} from '../../src/domain/calculations/settlementPreconditions';
import {
  periodBoundary,
  isInPeriod,
  filterByPeriod,
  Period,
} from '../../src/domain/calculations/periods';
import {
  normalizeCurrency,
  requireFinitePositive,
  requirePositiveInteger,
  requireNoDuplicates,
  requireDifferentMembers,
} from '../../src/domain/calculations/validation';

// ── Helper factories ──────────────────────────────────────────

const members = ['a', 'b', 'c'];

function contribution(
  overrides: Partial<ContributionEntry> = {}
): ContributionEntry {
  return {
    id: 'contribution-1',
    householdId: 'group-1',
    label: 'Vaisselle',
    performedByMemberId: 'a',
    beneficiaryMemberIds: ['a', 'b'],
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
    id: 'expense-1',
    householdId: 'group-1',
    title: 'Courses',
    amountMinor: 100,
    currency: 'CHF',
    paidByMemberId: 'a',
    participantMemberIds: ['a', 'b', 'c'],
    splitMode: 'equal',
    occurredAt: '2026-09-16T12:00:00.000Z',
    createdBy: 'user-a',
    ...overrides,
  };
}

function settlement(
  overrides: Partial<CrossLedgerSettlement> = {}
): CrossLedgerSettlement {
  return {
    id: 'settlement-1',
    householdId: 'group-1',
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

// ── Shared validation tests ───────────────────────────────────

describe('Shared validation', () => {
  test('normalizeCurrency handles various inputs', () => {
    expect(normalizeCurrency('chf')).toBe('CHF');
    expect(normalizeCurrency(' EUR ')).toBe('EUR');
    expect(normalizeCurrency('usd')).toBe('USD');
    expect(() => normalizeCurrency('')).toThrow(/Invalid currency/);
    expect(() => normalizeCurrency('EU')).toThrow(/3-letter/);
    expect(() => normalizeCurrency('EURO')).toThrow(/3-letter/);
    expect(() => normalizeCurrency('123')).toThrow(/3-letter/);
  });

  test('requireFinitePositive rejects invalid values', () => {
    expect(() => requireFinitePositive(NaN, 'test')).toThrow(/finite/);
    expect(() => requireFinitePositive(Infinity, 'test')).toThrow(/finite/);
    expect(() => requireFinitePositive(0, 'test')).toThrow(/> 0/);
    expect(() => requireFinitePositive(-5, 'test')).toThrow(/> 0/);
    expect(() => requireFinitePositive(1, 'test')).not.toThrow();
  });

  test('requirePositiveInteger rejects invalid values', () => {
    expect(() => requirePositiveInteger(0.5, 'test')).toThrow(/integer/);
    expect(() => requirePositiveInteger(0, 'test')).toThrow(/positive/);
    expect(() => requirePositiveInteger(-1, 'test')).toThrow(/positive/);
    expect(() => requirePositiveInteger(1, 'test')).not.toThrow();
  });

  test('requireNoDuplicates detects duplicates', () => {
    expect(() => requireNoDuplicates(['a', 'b', 'a'], 'test')).toThrow(/duplicate/);
    expect(() => requireNoDuplicates(['a', 'b', 'c'], 'test')).not.toThrow();
  });

  test('requireDifferentMembers detects same member', () => {
    expect(() => requireDifferentMembers('a', 'a', 'test')).toThrow(/different/);
    expect(() => requireDifferentMembers('a', 'b', 'test')).not.toThrow();
  });
});

// ── Settlement precondition tests ─────────────────────────────

describe('Settlement preconditions', () => {
  test('valid settlement passes all preconditions', () => {
    const contributions = [
      contribution({ value: 60 }), // a +30 / b -30
    ];
    const expenses = [
      expense({
        amountMinor: 3000,
        paidByMemberId: 'a',
        participantMemberIds: ['a', 'b'],
      }), // a +3000 -1500 = +1500, b -1500
    ];

    const result = validateSettlementPreconditions(
      settlement(),
      contributions,
      expenses,
      members
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('settlement with insufficient contribution balance fails', () => {
    const contributions = [
      contribution({ value: 10 }), // a +5 / b -5
    ];

    const result = validateSettlementPreconditions(
      settlement({ contributionValue: 20 }), // Needs 20, but only has 5
      contributions,
      [],
      members
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Contribution creditor'))).toBe(true);
  });

  test('settlement with insufficient money debt fails', () => {
    const contributions = [
      contribution({ value: 100 }), // a +50 / b -50
    ];
    // No expenses, so nobody owes money

    const result = validateSettlementPreconditions(
      settlement(), // Needs money debt, but nobody owes
      contributions,
      [],
      members
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('owes'))).toBe(true);
  });

  test('settlement sequence catches over-settlement across multiple settlements', () => {
    const contributions = [
      contribution({ value: 30 }), // a +15 / b -15
    ];
    const expenses = [
      expense({
        amountMinor: 3000,
        paidByMemberId: 'b',
        participantMemberIds: ['a', 'b'],
      }), // a -1500 / b +1500
    ];

    const s1 = settlement({ contributionValue: 10, moneyAmountMinor: 333 });
    const s2 = settlement({
      id: 'settlement-2',
      contributionValue: 10,
      moneyAmountMinor: 333,
    });
    const s3 = settlement({
      id: 'settlement-3',
      contributionValue: 10,
      moneyAmountMinor: 334,
    });

    // Total: 30 minutes consumed, a only has 15
    const result = validateSettlementSequence(
      [s1, s2, s3],
      contributions,
      expenses,
      members
    );

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('checkContributionSufficient handles edge cases', () => {
    expect(checkContributionSufficient(10, 10, 'a').sufficient).toBe(true);
    expect(checkContributionSufficient(10, 10.0000000001, 'a').sufficient).toBe(true); // Within epsilon
    expect(checkContributionSufficient(10, 10.1, 'a').sufficient).toBe(false);
    expect(checkContributionSufficient(0, 1, 'a').sufficient).toBe(false);
  });

  test('checkMoneyDebtSufficient handles edge cases', () => {
    expect(checkMoneyDebtSufficient(-100, 100, 'a').sufficient).toBe(true);
    expect(checkMoneyDebtSufficient(-100, 100.0000000001, 'a').sufficient).toBe(true); // Within epsilon
    expect(checkMoneyDebtSufficient(-100, 101, 'a').sufficient).toBe(false);
    expect(checkMoneyDebtSufficient(0, 1, 'a').sufficient).toBe(false);
  });
});

// ── Period/view helper tests ──────────────────────────────────

describe('Period/view helpers', () => {
  test('periodBoundary returns correct boundaries', () => {
    const reference = new Date(2026, 8, 16, 14, 30); // Sep 16, 2026 14:30

    const weekBoundary = periodBoundary('week', reference);
    const weekDate = new Date(weekBoundary);
    expect(weekDate.getDay()).toBe(1); // Monday
    expect(weekDate.getHours()).toBe(0);

    const monthBoundary = periodBoundary('month', reference);
    const monthDate = new Date(monthBoundary);
    expect(monthDate.getDate()).toBe(1);
    expect(monthDate.getMonth()).toBe(8); // September

    const yearBoundary = periodBoundary('year', reference);
    const yearDate = new Date(yearBoundary);
    expect(yearDate.getMonth()).toBe(0); // January
    expect(yearDate.getDate()).toBe(1);

    const allTimeBoundary = periodBoundary('all-time', reference);
    expect(allTimeBoundary).toBe('0000-01-01T00:00:00.000Z');
  });

  test('isInPeriod correctly filters entries', () => {
    const reference = new Date(2026, 8, 16); // Sep 16, 2026

    // Entry from this week
    const thisWeek = new Date(2026, 8, 15).toISOString(); // Sep 15
    expect(isInPeriod(thisWeek, 'week', reference)).toBe(true);
    expect(isInPeriod(thisWeek, 'month', reference)).toBe(true);
    expect(isInPeriod(thisWeek, 'year', reference)).toBe(true);
    expect(isInPeriod(thisWeek, 'all-time', reference)).toBe(true);

    // Entry from last month
    const lastMonth = new Date(2026, 7, 15).toISOString(); // Aug 15
    expect(isInPeriod(lastMonth, 'week', reference)).toBe(false);
    expect(isInPeriod(lastMonth, 'month', reference)).toBe(false);
    expect(isInPeriod(lastMonth, 'year', reference)).toBe(true);
    expect(isInPeriod(lastMonth, 'all-time', reference)).toBe(true);

    // Entry from last year
    const lastYear = new Date(2025, 0, 1).toISOString(); // Jan 1, 2025
    expect(isInPeriod(lastYear, 'week', reference)).toBe(false);
    expect(isInPeriod(lastYear, 'month', reference)).toBe(false);
    expect(isInPeriod(lastYear, 'year', reference)).toBe(false);
    expect(isInPeriod(lastYear, 'all-time', reference)).toBe(true);
  });

  test('filterByPeriod returns correct subsets', () => {
    const reference = new Date(2026, 8, 16); // Sep 16, 2026 (Wednesday)

    const entries = [
      { occurredAt: new Date(2026, 8, 15).toISOString(), id: '1' }, // Sep 15 - this week and month
      { occurredAt: new Date(2026, 8, 14).toISOString(), id: '2' }, // Sep 14 - this week and month
      { occurredAt: new Date(2026, 8, 1).toISOString(), id: '3' },  // Sep 1 - this month only
      { occurredAt: new Date(2026, 0, 1).toISOString(), id: '4' },  // Jan 1, 2026 - this year only
    ];

    expect(filterByPeriod(entries, 'week', reference).length).toBe(2); // 1 and 2 (Sep 14-15)
    expect(filterByPeriod(entries, 'month', reference).length).toBe(3); // 1, 2, and 3 (September)
    expect(filterByPeriod(entries, 'year', reference).length).toBe(4); // All (2026)
    expect(filterByPeriod(entries, 'all-time', reference).length).toBe(4); // All
  });

  test('period filters are views only — all-time balance is source-of-truth compatible', () => {
    const entries = [
      contribution({ id: 'c1', value: 60, unit: 'minutes', occurredAt: '2026-09-01T00:00:00.000Z' }),
      contribution({ id: 'c2', value: 30, unit: 'minutes', occurredAt: '2026-09-15T00:00:00.000Z' }),
    ];

    const allTimeBalances = calculateContributionBalances(entries, 'minutes', [], members);
    const weekBalances = calculateContributionBalances(
      filterByPeriod(entries, 'week', new Date(2026, 8, 16)),
      'minutes',
      [],
      members
    );

    // All-time should include both entries
    expect(allTimeBalances.get('a')).toBe(45); // (60+30)/2 = 45

    // Week should only include the second entry
    expect(weekBalances.get('a')).toBe(15); // 30/2 = 15

    // Both should be zero-sum
    expect(contributionLedgerIsZeroSum(allTimeBalances)).toBe(true);
    expect(contributionLedgerIsZeroSum(weekBalances)).toBe(true);
  });
});

// ── Replay equivalence tests ──────────────────────────────────

describe('Replay equivalence', () => {
  test('delete is equivalent to replay without the entry', () => {
    const entries = [
      expense({ id: 'e1', amountMinor: 1000, paidByMemberId: 'a', participantMemberIds: ['a', 'b'] }),
      expense({ id: 'e2', amountMinor: 500, paidByMemberId: 'b', participantMemberIds: ['a', 'b'] }),
    ];

    const withBoth = calculateFinancialBalances(entries, 'CHF', [], members);
    const withoutE1 = calculateFinancialBalances([entries[1]], 'CHF', [], members);
    const withoutE2 = calculateFinancialBalances([entries[0]], 'CHF', [], members);

    // Both should be zero-sum
    expect(financialLedgerIsZeroSum(withBoth)).toBe(true);
    expect(financialLedgerIsZeroSum(withoutE1)).toBe(true);
    expect(financialLedgerIsZeroSum(withoutE2)).toBe(true);

    // Removing one entry should produce a valid state
    expect(withoutE1.get('a')).toBe(-250); // Only e2: b paid 500, split 250 each
    expect(withoutE2.get('a')).toBe(500); // Only e1: a paid 1000, split 500 each
  });

  test('edit is equivalent to delete old + add new', () => {
    const original = expense({ id: 'e1', amountMinor: 1000 });
    const edited = expense({ id: 'e1-v2', amountMinor: 2000 });

    // Original state
    const beforeEdit = calculateFinancialBalances([original], 'CHF', [], members);

    // After edit: delete original, add edited
    const afterEdit = calculateFinancialBalances([edited], 'CHF', [], members);

    // Both should be zero-sum
    expect(financialLedgerIsZeroSum(beforeEdit)).toBe(true);
    expect(financialLedgerIsZeroSum(afterEdit)).toBe(true);

    // Different amounts should produce different balances
    expect(beforeEdit.get('a')).not.toBe(afterEdit.get('a'));
  });
});
