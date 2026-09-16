import {
  ContributionEntry,
  CrossLedgerSettlement,
  ExpenseEntry,
} from '../../src/domain/entities';
import {
  calculateContributionBalances,
  contributionLedgerIsZeroSum,
  suggestContributionTransfers,
} from '../../src/domain/calculations/contributionLedger';
import {
  allocateExpense,
  calculateFinancialBalances,
  calculateFinancialBalancesByCurrency,
  financialLedgerIsZeroSum,
  suggestMoneyTransfers,
} from '../../src/domain/calculations/expenseLedger';
import {
  quoteCrossLedgerMoneyAmount,
  validateCrossLedgerSettlement,
} from '../../src/domain/calculations/crossLedgerSettlement';

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

describe('V3 contribution ledger', () => {
  test('minutes are zero-sum and performer self-share cancels naturally', () => {
    const balances = calculateContributionBalances(
      [contribution()],
      'minutes',
      [],
      members
    );

    expect(balances.get('a')).toBe(30);
    expect(balances.get('b')).toBe(-30);
    expect(balances.get('c')).toBe(0);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
  });

  test('points use the same zero-sum math without mixing with minutes', () => {
    const entries = [
      contribution(),
      contribution({
        id: 'points-1',
        value: 9,
        unit: 'points',
        performedByMemberId: 'b',
        beneficiaryMemberIds: ['a', 'b', 'c'],
      }),
    ];

    const minuteBalances = calculateContributionBalances(entries, 'minutes', [], members);
    const pointBalances = calculateContributionBalances(entries, 'points', [], members);

    expect(minuteBalances.get('a')).toBe(30);
    expect(minuteBalances.get('b')).toBe(-30);

    expect(pointBalances.get('a')).toBe(-3);
    expect(pointBalances.get('b')).toBe(6);
    expect(pointBalances.get('c')).toBe(-3);
    expect(contributionLedgerIsZeroSum(pointBalances)).toBe(true);
  });

  test('historical unit changes cannot reinterpret prior entries', () => {
    const entries = [
      contribution({ id: 'old-minutes', value: 40, unit: 'minutes' }),
      contribution({ id: 'new-points', value: 8, unit: 'points' }),
    ];

    const minutes = calculateContributionBalances(entries, 'minutes', [], members);
    const points = calculateContributionBalances(entries, 'points', [], members);

    expect(minutes.get('a')).toBe(20);
    expect(minutes.get('b')).toBe(-20);
    expect(points.get('a')).toBe(4);
    expect(points.get('b')).toBe(-4);
  });

  test('suggested contribution transfers settle debtors toward creditors', () => {
    const balances = new Map([
      ['a', 50],
      ['b', -20],
      ['c', -30],
    ]);

    expect(suggestContributionTransfers(balances, 'minutes')).toEqual([
      { fromMemberId: 'c', toMemberId: 'a', value: 30, unit: 'minutes' },
      { fromMemberId: 'b', toMemberId: 'a', value: 20, unit: 'minutes' },
    ]);
  });
});

describe('V3 financial ledger', () => {
  test('equal split allocates integer rounding deterministically and remains zero-sum', () => {
    const entry = expense();
    expect(allocateExpense(entry)).toEqual([
      { memberId: 'a', amountMinor: 34 },
      { memberId: 'b', amountMinor: 33 },
      { memberId: 'c', amountMinor: 33 },
    ]);

    const balances = calculateFinancialBalances([entry], 'CHF', [], members);
    expect(balances.get('a')).toBe(66);
    expect(balances.get('b')).toBe(-33);
    expect(balances.get('c')).toBe(-33);
    expect(financialLedgerIsZeroSum(balances)).toBe(true);
  });

  test('custom split must allocate exactly the full amount', () => {
    const valid = expense({
      amountMinor: 1000,
      participantMemberIds: ['a', 'b'],
      splitMode: 'custom',
      customShares: [
        { memberId: 'a', amountMinor: 250 },
        { memberId: 'b', amountMinor: 750 },
      ],
    });

    expect(allocateExpense(valid)).toEqual(valid.customShares);

    const invalid = {
      ...valid,
      id: 'expense-invalid',
      customShares: [
        { memberId: 'a', amountMinor: 250 },
        { memberId: 'b', amountMinor: 700 },
      ],
    };
    expect(() => allocateExpense(invalid)).toThrow(/totals 950, expected 1000/);
  });

  test('currencies remain separate and are never silently netted', () => {
    const ledgers = calculateFinancialBalancesByCurrency(
      [
        expense({ id: 'chf', currency: 'CHF', amountMinor: 1000 }),
        expense({ id: 'eur', currency: 'EUR', amountMinor: 600 }),
      ],
      [],
      members
    );

    expect(ledgers.has('CHF')).toBe(true);
    expect(ledgers.has('EUR')).toBe(true);
    expect(financialLedgerIsZeroSum(ledgers.get('CHF')!)).toBe(true);
    expect(financialLedgerIsZeroSum(ledgers.get('EUR')!)).toBe(true);
  });

  test('suggested money transfers are integer-minor-unit settlements', () => {
    const balances = new Map([
      ['a', 1000],
      ['b', -250],
      ['c', -750],
    ]);

    expect(suggestMoneyTransfers(balances, 'CHF')).toEqual([
      { fromMemberId: 'c', toMemberId: 'a', amountMinor: 750, currency: 'CHF' },
      { fromMemberId: 'b', toMemberId: 'a', amountMinor: 250, currency: 'CHF' },
    ]);
  });

  test('editing or deleting is equivalent to replaying the remaining ledger', () => {
    const first = expense({ id: 'first', amountMinor: 900 });
    const second = expense({
      id: 'second',
      amountMinor: 600,
      paidByMemberId: 'b',
      participantMemberIds: ['a', 'b'],
    });

    const before = calculateFinancialBalances([first, second], 'CHF', [], members);
    const afterDelete = calculateFinancialBalances([second], 'CHF', [], members);
    const replay = calculateFinancialBalances([second], 'CHF', [], members);

    expect(financialLedgerIsZeroSum(before)).toBe(true);
    expect(afterDelete).toEqual(replay);
  });
});

describe('V3 cross-ledger settlement', () => {
  test('rate conversion is explicit, deterministic and snapshotted', () => {
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

    expect(quoteCrossLedgerMoneyAmount(15, 'minutes', oldRate)).toBe(500);
    expect(quoteCrossLedgerMoneyAmount(15, 'minutes', newRate)).toBe(750);

    const immutable = settlement({ rateSnapshot: oldRate, moneyAmountMinor: 500 });
    expect(() => validateCrossLedgerSettlement(immutable)).not.toThrow();
  });

  test('a settlement updates both ledgers without breaking either zero-sum invariant', () => {
    const contributions = [
      contribution({ value: 60 }), // a +30 / b -30
    ];
    const expenses = [
      expense({
        amountMinor: 3000,
        paidByMemberId: 'b',
        participantMemberIds: ['a', 'b'],
      }), // a -1500 / b +1500
    ];
    const settlements = [settlement()]; // consume 15 min for CHF 5

    const contributionBalances = calculateContributionBalances(
      contributions,
      'minutes',
      settlements,
      ['a', 'b']
    );
    const moneyBalances = calculateFinancialBalances(
      expenses,
      'CHF',
      settlements,
      ['a', 'b']
    );

    expect(contributionBalances.get('a')).toBe(15);
    expect(contributionBalances.get('b')).toBe(-15);
    expect(contributionLedgerIsZeroSum(contributionBalances)).toBe(true);

    expect(moneyBalances.get('a')).toBe(-1000);
    expect(moneyBalances.get('b')).toBe(1000);
    expect(financialLedgerIsZeroSum(moneyBalances)).toBe(true);
  });

  test('a settlement with an amount inconsistent with its rate is rejected', () => {
    expect(() =>
      validateCrossLedgerSettlement(settlement({ moneyAmountMinor: 499 }))
    ).toThrow(/does not match snapshotted rate/);
  });
});
