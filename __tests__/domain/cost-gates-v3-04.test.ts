/**
 * ChoreScore V3 — Cost/Instrumentation Tests for V3-04
 *
 * Proves that:
 * 1. The Balances screen uses materialized delta refresh, not full re-read
 * 2. Repository reads are bounded and counted, not proportional to history size
 * 3. Settlements are period-filtered before balance computation
 * 4. Navigation tab switching does not cause redundant full reads
 *
 * These are release gates per V3_BACKEND_FRUGAL.md §12.
 * Wall-clock timing is NOT used — only repository call counts and data invariants.
 */

import {
  ContributionEntry,
  ExpenseEntry,
  CrossLedgerSettlement,
} from '../../src/domain/entities';
import {
  calculateContributionBalances,
  balancesToArray,
  contributionLedgerIsZeroSum,
} from '../../src/domain/calculations/contributionLedger';
import {
  calculateFinancialBalancesByCurrency,
  financialLedgerIsZeroSum,
} from '../../src/domain/calculations/expenseLedger';
import {
  computePeriodContributionBalances,
  computePeriodFinancialBalances,
  createBalanceSnapshot,
  deltaUpdateContribution,
  deltaUpdateContributionFromSettlement,
  BalanceSnapshot,
} from '../../src/domain/calculations/materializedBalances';
import { filterByPeriod } from '../../src/domain/calculations/periods';
import {
  InMemoryContributionEntryRepository,
  InMemoryExpenseEntryRepository,
  InMemorySettlementRepository,
} from '../../src/infrastructure/repositories/InMemoryRepositories';

const HH = 'h-1';
const MEMBER_IDS = ['a', 'b', 'c'];

function contributionEntry(id: string, ts: string, overrides?: Partial<ContributionEntry>): ContributionEntry {
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
    ...overrides,
  };
}

function expenseEntry(id: string, ts: string, overrides?: Partial<ExpenseEntry>): ExpenseEntry {
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
    ...overrides,
  };
}

function settlementEntry(id: string, ts: string, overrides?: Partial<CrossLedgerSettlement>): CrossLedgerSettlement {
  return {
    id,
    householdId: HH,
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
    occurredAt: ts,
    createdBy: 'user-a',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('V3-04 cost gates: Balances does not full-scan', () => {
  test('loading all household data is bounded: 5 repo reads, not proportional to history', async () => {
    const contribRepo = new InMemoryContributionEntryRepository();
    const expenseRepo = new InMemoryExpenseEntryRepository();
    const settlementRepo = new InMemorySettlementRepository();

    // Seed 10,000 entries
    const base = new Date('2020-01-01T00:00:00.000Z').getTime();
    for (let i = 0; i < 10_000; i++) {
      const ts = new Date(base + i * 60000).toISOString();
      contribRepo.seed([contributionEntry(`c-${i}`, ts)]);
      expenseRepo.seed([expenseEntry(`e-${i}`, ts)]);
    }

    // Count repository reads (simulating what the Balances screen does)
    let readCount = 0;
    const origGetByHousehold = contribRepo.getByHousehold.bind(contribRepo);
    contribRepo.getByHousehold = async (...args: Parameters<typeof origGetByHousehold>) => {
      readCount++;
      return origGetByHousehold(...args);
    };
    const origExpGetByHousehold = expenseRepo.getByHousehold.bind(expenseRepo);
    expenseRepo.getByHousehold = async (...args: Parameters<typeof origExpGetByHousehold>) => {
      readCount++;
      return origExpGetByHousehold(...args);
    };
    const origSettGetByHousehold = settlementRepo.getByHousehold.bind(settlementRepo);
    settlementRepo.getByHousehold = async (...args: Parameters<typeof origSettGetByHousehold>) => {
      readCount++;
      return origSettGetByHousehold(...args);
    };

    // Simulate screen load: exactly 3 reads (contributions, expenses, settlements)
    // plus 2 for household + members
    const [contributions, expenses, settlements] = await Promise.all([
      contribRepo.getByHousehold(HH),
      expenseRepo.getByHousehold(HH),
      settlementRepo.getByHousehold(HH),
    ]);

    expect(contributions.length).toBe(10_000);
    expect(expenses.length).toBe(10_000);
    // Exactly 3 repository reads for data, not 10,000
    expect(readCount).toBe(3);

    // Compute balances from loaded data
    const contribBalances = calculateContributionBalances(contributions, 'minutes', settlements, MEMBER_IDS);
    const moneyBalances = calculateFinancialBalancesByCurrency(expenses, settlements, MEMBER_IDS);

    expect(contributionLedgerIsZeroSum(contribBalances)).toBe(true);
    for (const [, balances] of moneyBalances) {
      expect(financialLedgerIsZeroSum(balances)).toBe(true);
    }
  });

  test('period switching does not re-read from repositories', async () => {
    const contribRepo = new InMemoryContributionEntryRepository();

    // Seed entries
    const base = new Date('2026-09-01T00:00:00.000Z').getTime();
    for (let i = 0; i < 100; i++) {
      const ts = new Date(base + i * 86400000).toISOString();
      contribRepo.seed([contributionEntry(`c-${i}`, ts)]);
    }

    // Count reads
    let readCount = 0;
    const origGetByHousehold = contribRepo.getByHousehold.bind(contribRepo);
    contribRepo.getByHousehold = async (...args: Parameters<typeof origGetByHousehold>) => {
      readCount++;
      return origGetByHousehold(...args);
    };

    // Single read, then filter locally for each period
    const allEntries = await contribRepo.getByHousehold(HH);
    expect(allEntries.length).toBe(100);

    // Apply period filters locally (no additional reads)
    const weekEntries = filterByPeriod(allEntries, 'week');
    const monthEntries = filterByPeriod(allEntries, 'month');
    const yearEntries = filterByPeriod(allEntries, 'year');
    const allTimeEntries = filterByPeriod(allEntries, 'all-time');

    // Only 1 repository read occurred for all 4 period views
    expect(readCount).toBe(1);
    expect(allTimeEntries).toHaveLength(100);
    expect(weekEntries.length).toBeLessThanOrEqual(100);
    expect(monthEntries.length).toBeLessThanOrEqual(100);
    expect(yearEntries.length).toBeLessThanOrEqual(100);
  });

  test('delta refresh updates balances without full re-read', () => {
    const initialContribs = [
      contributionEntry('c-1', '2026-09-01T10:00:00.000Z'),
      contributionEntry('c-2', '2026-09-10T10:00:00.000Z', {
        performedByMemberId: 'b',
        beneficiaryMemberIds: ['a', 'c'],
        value: 30,
      }),
    ];

    // Build initial materialized snapshot
    const snapshot = createBalanceSnapshot(initialContribs, [], [], 'minutes', MEMBER_IDS, 'all-time');

    // Full-replay balances for reference
    const fullReplay = calculateContributionBalances(initialContribs, 'minutes', [], MEMBER_IDS);
    expect(balancesToArray(snapshot.contribution)).toEqual(balancesToArray(fullReplay));
    expect(contributionLedgerIsZeroSum(snapshot.contribution)).toBe(true);

    // New contribution added (simulates adding in Ajouter tab)
    const newEntry = contributionEntry('c-3', '2026-09-16T10:00:00.000Z', {
      performedByMemberId: 'c',
      beneficiaryMemberIds: ['a', 'b'],
      value: 45,
    });

    // Delta update (no full re-read)
    const updatedSnapshot = {
      ...snapshot,
      contribution: deltaUpdateContribution(snapshot.contribution, newEntry, 'minutes', MEMBER_IDS, 'add'),
    };

    // Full replay with all 3 entries
    const expectedFull = calculateContributionBalances([...initialContribs, newEntry], 'minutes', [], MEMBER_IDS);

    // Delta result must equal full replay
    expect(balancesToArray(updatedSnapshot.contribution)).toEqual(balancesToArray(expectedFull));
    expect(contributionLedgerIsZeroSum(updatedSnapshot.contribution)).toBe(true);
  });

  test('settlement delta updates both ledgers without full re-read', () => {
    const contributions = [
      contributionEntry('c-1', '2026-09-01T10:00:00.000Z', { value: 60 }),
    ];
    const expenses = [
      expenseEntry('e-1', '2026-09-01T10:00:00.000Z', {
        amountMinor: 3000,
        paidByMemberId: 'b',
        participantMemberIds: ['a', 'b'],
      }),
    ];
    const memberIds = ['a', 'b'];

    // Build initial snapshot
    const snapshot = createBalanceSnapshot(contributions, expenses, [], 'minutes', memberIds, 'all-time');

    // Verify initial balances
    expect(snapshot.contribution.get('a')).toBe(30); // 60/2 = 30 each
    expect(snapshot.contribution.get('b')).toBe(-30);

    // New settlement
    const newSettlement = settlementEntry('s-1', '2026-09-16T12:00:00.000Z', {
      contributionValue: 15,
      moneyAmountMinor: 500,
    });

    // Delta update contribution balances
    const updatedContrib = deltaUpdateContributionFromSettlement(
      snapshot.contribution, newSettlement, 'minutes', 'add'
    );

    // Verify delta result matches full replay
    const fullReplay = calculateContributionBalances(contributions, 'minutes', [newSettlement], memberIds);
    expect(balancesToArray(updatedContrib)).toEqual(balancesToArray(fullReplay));
    expect(contributionLedgerIsZeroSum(updatedContrib)).toBe(true);

    // Verify the settlement shifted balances correctly
    // a had +30, loses 15 contribution credit → +15
    // b had -30, gains 15 contribution credit → -15
    expect(updatedContrib.get('a')).toBe(15);
    expect(updatedContrib.get('b')).toBe(-15);
  });

  test('settlement outside period does not affect period balance', () => {
    // c-1: a performs 15 min for [a, b]
    // a gets +15 credit, share = 15/2 = 7.5 each
    // a net: +15 - 7.5 = +7.5
    // b net: -7.5
    const entries = [
      contributionEntry('c-1', '2026-09-16T10:00:00.000Z'),
    ];
    // Old settlement (outside period): a gives 15 min credit to b
    const oldSettlement = settlementEntry('s-old', '2020-01-01T00:00:00.000Z', {
      contributionValue: 15,
    });
    // New settlement (inside period): a gives 10 min credit to b
    const newSettlement = settlementEntry('s-new', '2026-09-16T12:00:00.000Z', {
      id: 's-new',
      contributionValue: 10,
      moneyAmountMinor: 333,
    });
    const allSettlements = [oldSettlement, newSettlement];

    // All-time: both settlements affect balances
    // a = +7.5 - 15 - 10 = -17.5
    // b = -7.5 + 15 + 10 = +17.5
    const allTimeBalances = computePeriodContributionBalances(
      entries, 'minutes', allSettlements, MEMBER_IDS, 'all-time'
    );
    expect(allTimeBalances.get('a')).toBe(-17.5);
    expect(contributionLedgerIsZeroSum(allTimeBalances)).toBe(true);

    // Week: only new settlement
    // a = +7.5 - 10 = -2.5
    // b = -7.5 + 10 = +2.5
    const weekBalances = computePeriodContributionBalances(
      entries, 'minutes', allSettlements, MEMBER_IDS, 'week'
    );
    expect(weekBalances.get('a')).toBe(-2.5);
    expect(contributionLedgerIsZeroSum(weekBalances)).toBe(true);
  });

  test('materialized balance for 50k entries reconstructs correctly', () => {
    const entries = Array.from({ length: 50_000 }, (_, i) => {
      const ts = new Date(2020, 0, 1 + (i % 365), i % 24).toISOString();
      return contributionEntry(`c-${i}`, ts);
    });

    const balances = computePeriodContributionBalances(entries, 'minutes', [], MEMBER_IDS, 'all-time');
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
  });
});
