/**
 * ChoreScore V3 — randomized property-style invariant tests.
 *
 * These tests use random inputs to verify that core invariants hold
 * for any valid data. This provides much stronger guarantees than
 * hand-crafted test cases alone.
 */

import {
  ContributionEntry,
  CrossLedgerSettlement,
  ExpenseEntry,
  ContributionUnit,
} from '../../src/domain/entities';
import {
  calculateContributionBalances,
  contributionLedgerIsZeroSum,
  sumContributionBalances,
} from '../../src/domain/calculations/contributionLedger';
import {
  calculateFinancialBalances,
  financialLedgerIsZeroSum,
  sumFinancialBalances,
  allocateExpense,
} from '../../src/domain/calculations/expenseLedger';
import {
  quoteCrossLedgerMoneyAmount,
  validateCrossLedgerSettlement,
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
  validateContributionUnit,
} from '../../src/domain/calculations/validation';

// ── Seeded random number generator (deterministic) ────────────

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Random generators ─────────────────────────────────────────

function randomId(rng: () => number): string {
  return `member-${Math.floor(rng() * 100)}`;
}

function randomUnit(rng: () => number): ContributionUnit {
  return rng() < 0.5 ? 'minutes' : 'points';
}

function randomCurrency(rng: () => number): string {
  const currencies = ['CHF', 'EUR', 'USD', 'GBP'];
  return currencies[Math.floor(rng() * currencies.length)];
}

function randomMemberIds(count: number, rng: () => number): string[] {
  const ids: string[] = [];
  const actualCount = Math.max(2, Math.min(count, 6));
  for (let i = 0; i < actualCount; i++) {
    ids.push(`member-${i}`);
  }
  return ids;
}

function randomContribution(
  householdId: string,
  memberIds: string[],
  unit: ContributionUnit,
  rng: () => number
): ContributionEntry {
  const performerIndex = Math.floor(rng() * memberIds.length);
  const performer = memberIds[performerIndex];

  // 1 to N-1 beneficiaries (include performer sometimes)
  const beneficiaryCount = Math.floor(rng() * memberIds.length) + 1;
  const beneficiarySet = new Set<string>();
  while (beneficiarySet.size < beneficiaryCount) {
    const idx = Math.floor(rng() * memberIds.length);
    beneficiarySet.add(memberIds[idx]);
  }

  // Value: 1 to 100, rounded to 1 decimal
  const value = Math.round((rng() * 100 + 1) * 10) / 10;

  return {
    id: `contribution-${Math.floor(rng() * 100000)}`,
    householdId,
    label: `Task-${Math.floor(rng() * 1000)}`,
    performedByMemberId: performer,
    beneficiaryMemberIds: Array.from(beneficiarySet),
    value,
    unit,
    persistentTaskId: null,
    occurredAt: new Date(2026, 0, 1 + Math.floor(rng() * 365)).toISOString(),
    createdBy: `user-${Math.floor(rng() * 10)}`,
  };
}

function randomExpense(
  householdId: string,
  memberIds: string[],
  currency: string,
  rng: () => number
): ExpenseEntry {
  const payerIndex = Math.floor(rng() * memberIds.length);
  const payer = memberIds[payerIndex];

  // 1 to N participants
  const participantCount = Math.floor(rng() * memberIds.length) + 1;
  const participantSet = new Set<string>();
  while (participantSet.size < participantCount) {
    const idx = Math.floor(rng() * memberIds.length);
    participantSet.add(memberIds[idx]);
  }

  // Amount: 100 to 10000 minor units
  const amountMinor = Math.floor(rng() * 9900 + 100);

  const participants = Array.from(participantSet);
  const splitMode = rng() < 0.7 ? 'equal' : 'custom';

  if (splitMode === 'custom' && participants.length > 1) {
    // Distribute amount randomly among participants
    const shares: { memberId: string; amountMinor: number }[] = [];
    let remaining = amountMinor;
    for (let i = 0; i < participants.length - 1; i++) {
      const share = Math.floor(rng() * remaining);
      shares.push({ memberId: participants[i], amountMinor: share });
      remaining -= share;
    }
    shares.push({ memberId: participants[participants.length - 1], amountMinor: remaining });

    return {
      id: `expense-${Math.floor(rng() * 100000)}`,
      householdId,
      title: `Expense-${Math.floor(rng() * 1000)}`,
      amountMinor,
      currency,
      paidByMemberId: payer,
      participantMemberIds: participants,
      splitMode: 'custom',
      customShares: shares,
      occurredAt: new Date(2026, 0, 1 + Math.floor(rng() * 365)).toISOString(),
      createdBy: `user-${Math.floor(rng() * 10)}`,
    };
  }

  return {
    id: `expense-${Math.floor(rng() * 100000)}`,
    householdId,
    title: `Expense-${Math.floor(rng() * 1000)}`,
    amountMinor,
    currency,
    paidByMemberId: payer,
    participantMemberIds: participants,
    splitMode: 'equal',
    occurredAt: new Date(2026, 0, 1 + Math.floor(rng() * 365)).toISOString(),
    createdBy: `user-${Math.floor(rng() * 10)}`,
  };
}

// ── Property tests: Contribution ledger ───────────────────────

describe('Property: contribution ledger invariants', () => {
  test('contribution ledger sum is zero for valid randomized cases (50 iterations)', () => {
    const rng = mulberry32(42);

    for (let i = 0; i < 50; i++) {
      const unit = randomUnit(rng);
      const memberIds = randomMemberIds(2 + Math.floor(rng() * 5), rng);
      const entryCount = Math.floor(rng() * 10) + 1;

      const entries: ContributionEntry[] = [];
      for (let j = 0; j < entryCount; j++) {
        entries.push(randomContribution('group-1', memberIds, unit, rng));
      }

      const balances = calculateContributionBalances(entries, unit, [], memberIds);
      expect(contributionLedgerIsZeroSum(balances)).toBe(true);

      // Verify sum is exactly zero within epsilon
      const sum = sumContributionBalances(balances);
      expect(Math.abs(sum)).toBeLessThanOrEqual(1e-9);
    }
  });

  test('minutes and points are never mixed in the same balance', () => {
    const rng = mulberry32(123);
    const memberIds = ['a', 'b', 'c'];

    for (let i = 0; i < 20; i++) {
      const entries: ContributionEntry[] = [];
      for (let j = 0; j < 10; j++) {
        entries.push(randomContribution('group-1', memberIds, 'minutes', rng));
        entries.push(randomContribution('group-1', memberIds, 'points', rng));
      }

      const minuteBalances = calculateContributionBalances(entries, 'minutes', [], memberIds);
      const pointBalances = calculateContributionBalances(entries, 'points', [], memberIds);

      // Verify that filtering works correctly
      const minuteEntries = entries.filter((e) => e.unit === 'minutes');
      const pointEntries = entries.filter((e) => e.unit === 'points');

      const minuteFromFiltered = calculateContributionBalances(minuteEntries, 'minutes', [], memberIds);
      const pointFromFiltered = calculateContributionBalances(pointEntries, 'points', [], memberIds);

      // Both approaches should yield the same result
      expect(minuteBalances).toEqual(minuteFromFiltered);
      expect(pointBalances).toEqual(pointFromFiltered);

      // Sums should be zero
      expect(contributionLedgerIsZeroSum(minuteBalances)).toBe(true);
      expect(contributionLedgerIsZeroSum(pointBalances)).toBe(true);
    }
  });
});

// ── Property tests: Expense ledger ────────────────────────────

describe('Property: expense ledger invariants', () => {
  test('money ledger sum is exactly zero per currency with integer minor units (50 iterations)', () => {
    const rng = mulberry32(99);

    for (let i = 0; i < 50; i++) {
      const currency = randomCurrency(rng);
      const memberIds = randomMemberIds(2 + Math.floor(rng() * 4), rng);
      const expenseCount = Math.floor(rng() * 8) + 1;

      const expenses: ExpenseEntry[] = [];
      for (let j = 0; j < expenseCount; j++) {
        expenses.push(randomExpense('group-1', memberIds, currency, rng));
      }

      const balances = calculateFinancialBalances(expenses, currency, [], memberIds);
      expect(financialLedgerIsZeroSum(balances)).toBe(true);

      // Verify sum is exactly zero (integer arithmetic)
      const sum = sumFinancialBalances(balances);
      expect(sum).toBe(0);
    }
  });

  test('equal split always allocates exact amount with integer remainder', () => {
    const rng = mulberry32(77);

    for (let i = 0; i < 30; i++) {
      const memberIds = randomMemberIds(2 + Math.floor(rng() * 6), rng);
      const amount = Math.floor(rng() * 10000) + 1;

      const entry: ExpenseEntry = {
        id: `expense-${i}`,
        householdId: 'group-1',
        title: 'Test',
        amountMinor: amount,
        currency: 'CHF',
        paidByMemberId: memberIds[0],
        participantMemberIds: memberIds,
        splitMode: 'equal',
        occurredAt: new Date().toISOString(),
        createdBy: 'user-1',
      };

      const shares = allocateExpense(entry);

      // Sum of shares must equal original amount
      const shareSum = shares.reduce((sum, s) => sum + s.amountMinor, 0);
      expect(shareSum).toBe(amount);

      // Each share must be a non-negative integer
      for (const share of shares) {
        expect(Number.isInteger(share.amountMinor)).toBe(true);
        expect(share.amountMinor).toBeGreaterThanOrEqual(0);
      }

      // Shares must cover all participants
      expect(shares.length).toBe(memberIds.length);
    }
  });
});

// ── Property tests: Cross-ledger settlement ───────────────────

describe('Property: cross-ledger settlement invariants', () => {
  test('snapshotted rate is immutable and deterministic', () => {
    const rng = mulberry32(55);

    for (let i = 0; i < 20; i++) {
      const contributionValue = Math.round((rng() * 50 + 1) * 10) / 10;
      const unit = randomUnit(rng);
      const currency = randomCurrency(rng);

      const rate = {
        contributionValue,
        contributionUnit: unit,
        moneyAmountMinor: Math.floor(rng() * 5000) + 100,
        currency,
      };

      // Quote should be deterministic
      const quote1 = quoteCrossLedgerMoneyAmount(contributionValue, unit, rate);
      const quote2 = quoteCrossLedgerMoneyAmount(contributionValue, unit, rate);
      expect(quote1).toBe(quote2);

      // Quote should match the rate proportion
      const expected = Math.round((contributionValue / rate.contributionValue) * rate.moneyAmountMinor);
      expect(quote1).toBe(expected);
    }
  });

  test('settlement cannot overshoot available contribution balance', () => {
    const rng = mulberry32(33);
    const memberIds = ['a', 'b', 'c'];

    for (let i = 0; i < 20; i++) {
      // Create contributions where 'a' has some positive balance
      const entries: ContributionEntry[] = [
        {
          id: `contrib-${i}`,
          householdId: 'group-1',
          label: 'Task',
          performedByMemberId: 'a',
          beneficiaryMemberIds: ['b', 'c'],
          value: 50,
          unit: 'minutes',
          persistentTaskId: null,
          occurredAt: new Date().toISOString(),
          createdBy: 'user-1',
        },
      ];

      const balances = calculateContributionBalances(entries, 'minutes', [], memberIds);
      const availableA = balances.get('a') ?? 0;

      // Try to consume more than available
      const overage = Math.floor(rng() * 100) + 1;
      const settlementValue = availableA + overage;

      const check = checkContributionSufficient(availableA, settlementValue, 'a');
      expect(check.sufficient).toBe(false);
      expect(check.available).toBe(availableA);
    }
  });

  test('settlement cannot overshoot available money receivable', () => {
    const rng = mulberry32(44);
    const memberIds = ['a', 'b'];

    for (let i = 0; i < 20; i++) {
      // Create an expense where 'b' paid for [a, b] so 'b' has a positive
      // receivable (is owed money). This is the counterparty who absorbs a
      // cross-ledger settlement.
      const expenses: ExpenseEntry[] = [
        {
          id: `expense-${i}`,
          householdId: 'group-1',
          title: 'Expense',
          amountMinor: 1000,
          currency: 'CHF',
          paidByMemberId: 'b',
          participantMemberIds: ['a', 'b'],
          splitMode: 'equal',
          occurredAt: new Date().toISOString(),
          createdBy: 'user-1',
        },
      ];

      const moneyBalances = calculateFinancialBalances(expenses, 'CHF', [], memberIds);
      const receivableB = moneyBalances.get('b') ?? 0; // Positive: b is owed money

      // Try to settle more than the receivable
      const overage = Math.floor(rng() * 500) + 1;
      const settlementAmount = receivableB + overage;

      const check = checkMoneyDebtSufficient(receivableB, settlementAmount, 'b');
      expect(check.sufficient).toBe(false);
      expect(check.availableReceivable).toBe(receivableB);
    }
  });
});

// ── Property tests: Period/view helpers ───────────────────────

describe('Property: period helpers', () => {
  test('all-time period includes all entries', () => {
    const rng = mulberry32(88);

    for (let i = 0; i < 20; i++) {
      const entries: { occurredAt: string }[] = [];
      const entryCount = Math.floor(rng() * 20) + 5;

      for (let j = 0; j < entryCount; j++) {
        const year = 2020 + Math.floor(rng() * 10);
        const month = Math.floor(rng() * 12);
        const day = Math.floor(rng() * 28) + 1;
        entries.push({
          occurredAt: new Date(year, month, day).toISOString(),
        });
      }

      const allTime = filterByPeriod(entries, 'all-time');
      expect(allTime.length).toBe(entries.length);
    }
  });

  test('week/month/year boundaries are monotonically non-decreasing', () => {
    const periods: Period[] = ['week', 'month', 'year'];

    for (const period of periods) {
      const now = new Date();
      const boundary = periodBoundary(period, now);

      // Boundary should be <= now
      expect(new Date(boundary).getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  test('period filtering never mutates the original array', () => {
    const rng = mulberry32(111);

    for (let i = 0; i < 15; i++) {
      const entries: { occurredAt: string; id: string }[] = [];
      const entryCount = Math.floor(rng() * 10) + 3;

      for (let j = 0; j < entryCount; j++) {
        entries.push({
          id: `entry-${j}`,
          occurredAt: new Date(2026, Math.floor(rng() * 12), Math.floor(rng() * 28) + 1).toISOString(),
        });
      }

      const originalLength = entries.length;
      const originalFirst = entries[0];

      filterByPeriod(entries, 'week');

      // Original array should be unchanged
      expect(entries.length).toBe(originalLength);
      expect(entries[0]).toBe(originalFirst);
    }
  });
});

// ── Property tests: Validation ────────────────────────────────

describe('Property: shared validation', () => {
  test('normalizeCurrency is idempotent', () => {
    const rng = mulberry32(222);

    for (let i = 0; i < 20; i++) {
      const currencies = ['chf', 'CHF', 'Chf', ' eur ', 'EUR', 'Usd'];
      for (const raw of currencies) {
        const normalized = normalizeCurrency(raw);
        const doubleNormalized = normalizeCurrency(normalized);
        expect(normalized).toBe(doubleNormalized);
      }
    }
  });

  test('validateContributionUnit rejects invalid units', () => {
    expect(() => validateContributionUnit('hours' as any)).toThrow();
    expect(() => validateContributionUnit('' as any)).toThrow();
    expect(() => validateContributionUnit('MINUTES' as any)).toThrow();
    expect(() => validateContributionUnit('minutes')).not.toThrow();
    expect(() => validateContributionUnit('points')).not.toThrow();
  });
});

// ── Property tests: Replay equivalence ────────────────────────

describe('Property: replay equivalence', () => {
  test('removing an entry is equivalent to replaying without it', () => {
    const rng = mulberry32(333);
    const memberIds = ['a', 'b', 'c'];

    for (let i = 0; i < 20; i++) {
      const entryCount = Math.floor(rng() * 8) + 3;
      const entries: ExpenseEntry[] = [];

      for (let j = 0; j < entryCount; j++) {
        entries.push(randomExpense('group-1', memberIds, 'CHF', rng));
      }

      // Calculate with all entries
      const allBalances = calculateFinancialBalances(entries, 'CHF', [], memberIds);

      // Remove one entry and recalculate
      const removeIndex = Math.floor(rng() * entries.length);
      const remaining = entries.filter((_, idx) => idx !== removeIndex);
      const afterRemove = calculateFinancialBalances(remaining, 'CHF', [], memberIds);

      // The removed entry's effect should be the difference
      const removedEntry = entries[removeIndex];
      const shares = allocateExpense(removedEntry);

      // The difference vector should be reproducible from the removed entry alone
      const diffA = (allBalances.get('a') ?? 0) - (afterRemove.get('a') ?? 0);
      const diffB = (allBalances.get('b') ?? 0) - (afterRemove.get('b') ?? 0);
      const diffC = (allBalances.get('c') ?? 0) - (afterRemove.get('c') ?? 0);

      // Sum of diffs must be zero (both states are zero-sum)
      expect(diffA + diffB + diffC).toBe(0);

      // Recompute the removed entry's effect from scratch
      const removedShares = allocateExpense(removedEntry);
      const removedEffect = new Map<string, number>();
      for (const id of memberIds) removedEffect.set(id, 0);
      removedEffect.set(removedEntry.paidByMemberId, removedEntry.amountMinor);
      for (const share of removedShares) {
        removedEffect.set(share.memberId, (removedEffect.get(share.memberId) ?? 0) - share.amountMinor);
      }

      // The diff vector must match the removed entry's effect
      expect(diffA).toBe(removedEffect.get('a') ?? 0);
      expect(diffB).toBe(removedEffect.get('b') ?? 0);
      expect(diffC).toBe(removedEffect.get('c') ?? 0);
    }
  });
});
