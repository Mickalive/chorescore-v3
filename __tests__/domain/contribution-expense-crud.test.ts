/**
 * ChoreScore V3 — Contribution and Expense CRUD Tests
 *
 * Tests the full lifecycle: create, read, update, delete for both
 * contribution and expense entries. Validates that edit/delete
 * operations correctly replay ledger calculations, ensuring
 * zero-sum invariants hold before and after mutations.
 */

import {
  ContributionEntry,
  ExpenseEntry,
  CrossLedgerSettlement,
} from '../../src/domain/entities';
import { InMemoryContributionEntryRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import { InMemoryExpenseEntryRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import { InMemoryMemberRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import { calculateContributionBalances, contributionLedgerIsZeroSum } from '../../src/domain/calculations/contributionLedger';
import { calculateFinancialBalances, financialLedgerIsZeroSum } from '../../src/domain/calculations/expenseLedger';

const HH = 'h-1';
const members = ['a', 'b', 'c'];

function member(id: string) {
  return { id, householdId: HH, name: `Member ${id}`, userId: `user-${id}`, joinedAt: '2026-01-01T00:00:00.000Z' };
}

// ── Contribution CRUD ────────────────────────────────────────

describe('ContributionEntry CRUD lifecycle', () => {
  let repo: InMemoryContributionEntryRepository;
  let memberRepo: InMemoryMemberRepository;

  beforeEach(() => {
    repo = new InMemoryContributionEntryRepository();
    memberRepo = new InMemoryMemberRepository();
    memberRepo.seed(members.map(member));
  });

  test('create and read back', async () => {
    const created = await repo.create({
      householdId: HH,
      label: 'Vaisselle',
      performedByMemberId: 'a',
      beneficiaryMemberIds: ['a', 'b'],
      value: 15,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });

    expect(created.id).toBeDefined();
    const fetched = await repo.getById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.label).toBe('Vaisselle');
    expect(fetched!.value).toBe(15);
  });

  test('update preserves id and updates fields', async () => {
    const created = await repo.create({
      householdId: HH,
      label: 'Vaisselle',
      performedByMemberId: 'a',
      beneficiaryMemberIds: ['a', 'b'],
      value: 15,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });

    const updated = await repo.update(created.id, {
      label: 'Vaisselle du soir',
      value: 20,
      modifiedBy: 'user-a',
    });

    expect(updated.id).toBe(created.id);
    expect(updated.label).toBe('Vaisselle du soir');
    expect(updated.value).toBe(20);
    expect(updated.modifiedBy).toBe('user-a');

    const fetched = await repo.getById(created.id);
    expect(fetched!.label).toBe('Vaisselle du soir');
    expect(fetched!.value).toBe(20);
  });

  test('delete removes entry', async () => {
    const created = await repo.create({
      householdId: HH,
      label: 'Test',
      performedByMemberId: 'a',
      beneficiaryMemberIds: ['a'],
      value: 10,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });

    await repo.delete(created.id);
    const fetched = await repo.getById(created.id);
    expect(fetched).toBeNull();
  });

  test('edit and delete replay: ledger remains zero-sum after each mutation', async () => {
    // Create three contributions
    const c1 = await repo.create({
      householdId: HH,
      label: 'Task 1',
      performedByMemberId: 'a',
      beneficiaryMemberIds: ['a', 'b', 'c'],
      value: 60,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });
    const c2 = await repo.create({
      householdId: HH,
      label: 'Task 2',
      performedByMemberId: 'b',
      beneficiaryMemberIds: ['a', 'b'],
      value: 30,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T11:00:00.000Z',
      createdBy: 'user-b',
    });
    const c3 = await repo.create({
      householdId: HH,
      label: 'Task 3',
      performedByMemberId: 'c',
      beneficiaryMemberIds: ['c'],
      value: 45,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T12:00:00.000Z',
      createdBy: 'user-c',
    });

    // Verify initial zero-sum
    let entries = await repo.getByHousehold(HH);
    let balances = calculateContributionBalances(entries, 'minutes', [], members);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);

    // Edit c1: change value from 60 to 90
    await repo.update(c1.id, { value: 90 });
    entries = await repo.getByHousehold(HH);
    balances = calculateContributionBalances(entries, 'minutes', [], members);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);

    // Edit c2: change performer
    await repo.update(c2.id, { performedByMemberId: 'c' });
    entries = await repo.getByHousehold(HH);
    balances = calculateContributionBalances(entries, 'minutes', [], members);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);

    // Delete c3
    await repo.delete(c3.id);
    entries = await repo.getByHousehold(HH);
    balances = calculateContributionBalances(entries, 'minutes', [], members);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
  });
});

// ── Expense CRUD ─────────────────────────────────────────────

describe('ExpenseEntry CRUD lifecycle', () => {
  let repo: InMemoryExpenseEntryRepository;

  beforeEach(() => {
    repo = new InMemoryExpenseEntryRepository();
  });

  test('create and read back', async () => {
    const created = await repo.create({
      householdId: HH,
      title: 'Courses Migros',
      amountMinor: 4250,
      currency: 'CHF',
      paidByMemberId: 'a',
      participantMemberIds: ['a', 'b'],
      splitMode: 'equal',
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });

    expect(created.id).toBeDefined();
    const fetched = await repo.getById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.title).toBe('Courses Migros');
    expect(fetched!.amountMinor).toBe(4250);
  });

  test('update preserves id and updates fields', async () => {
    const created = await repo.create({
      householdId: HH,
      title: 'Courses',
      amountMinor: 4250,
      currency: 'CHF',
      paidByMemberId: 'a',
      participantMemberIds: ['a', 'b'],
      splitMode: 'equal',
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });

    const updated = await repo.update(created.id, {
      title: 'Courses Migros',
      amountMinor: 5000,
      note: 'Recu',
      modifiedBy: 'user-a',
    });

    expect(updated.id).toBe(created.id);
    expect(updated.title).toBe('Courses Migros');
    expect(updated.amountMinor).toBe(5000);
    expect(updated.note).toBe('Recu');
  });

  test('delete removes entry', async () => {
    const created = await repo.create({
      householdId: HH,
      title: 'Test',
      amountMinor: 1000,
      currency: 'CHF',
      paidByMemberId: 'a',
      participantMemberIds: ['a', 'b'],
      splitMode: 'equal',
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });

    await repo.delete(created.id);
    const fetched = await repo.getById(created.id);
    expect(fetched).toBeNull();
  });

  test('edit and delete replay: financial ledger remains zero-sum after each mutation', async () => {
    // Create expenses
    const e1 = await repo.create({
      householdId: HH,
      title: 'Courses',
      amountMinor: 3000,
      currency: 'CHF',
      paidByMemberId: 'a',
      participantMemberIds: ['a', 'b', 'c'],
      splitMode: 'equal',
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });
    const e2 = await repo.create({
      householdId: HH,
      title: 'Restaurant',
      amountMinor: 6000,
      currency: 'CHF',
      paidByMemberId: 'b',
      participantMemberIds: ['a', 'b'],
      splitMode: 'equal',
      occurredAt: '2026-09-16T11:00:00.000Z',
      createdBy: 'user-b',
    });

    // Verify initial zero-sum
    let entries = await repo.getByHousehold(HH);
    let balances = calculateFinancialBalances(entries, 'CHF', [], members);
    expect(financialLedgerIsZeroSum(balances)).toBe(true);

    // Edit e1: change amount from 3000 to 4500
    await repo.update(e1.id, { amountMinor: 4500 });
    entries = await repo.getByHousehold(HH);
    balances = calculateFinancialBalances(entries, 'CHF', [], members);
    expect(financialLedgerIsZeroSum(balances)).toBe(true);

    // Edit e2: change paidBy
    await repo.update(e2.id, { paidByMemberId: 'c' });
    entries = await repo.getByHousehold(HH);
    balances = calculateFinancialBalances(entries, 'CHF', [], members);
    expect(financialLedgerIsZeroSum(balances)).toBe(true);

    // Delete e1
    await repo.delete(e1.id);
    entries = await repo.getByHousehold(HH);
    balances = calculateFinancialBalances(entries, 'CHF', [], members);
    expect(financialLedgerIsZeroSum(balances)).toBe(true);
  });

  test('custom split with correct totals remains zero-sum', async () => {
    const created = await repo.create({
      householdId: HH,
      title: 'Hotel',
      amountMinor: 10000,
      currency: 'CHF',
      paidByMemberId: 'a',
      participantMemberIds: ['a', 'b', 'c'],
      splitMode: 'custom',
      customShares: [
        { memberId: 'a', amountMinor: 5000 },
        { memberId: 'b', amountMinor: 3000 },
        { memberId: 'c', amountMinor: 2000 },
      ],
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });

    const entries = await repo.getByHousehold(HH);
    const balances = calculateFinancialBalances(entries, 'CHF', [], members);
    expect(financialLedgerIsZeroSum(balances)).toBe(true);
    // a paid 10000, owes 5000 => net +5000
    expect(balances.get('a')).toBe(5000);
    // b owes 3000
    expect(balances.get('b')).toBe(-3000);
    // c owes 2000
    expect(balances.get('c')).toBe(-2000);
  });

  test('delete entry and verify balances update correctly', async () => {
    const e1 = await repo.create({
      householdId: HH,
      title: 'Courses',
      amountMinor: 3000,
      currency: 'CHF',
      paidByMemberId: 'a',
      participantMemberIds: ['a', 'b'],
      splitMode: 'equal',
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });

    // After create: a paid 3000, each owes 1500 => a +1500, b -1500
    let entries = await repo.getByHousehold(HH);
    let balances = calculateFinancialBalances(entries, 'CHF', [], ['a', 'b']);
    expect(balances.get('a')).toBe(1500);
    expect(balances.get('b')).toBe(-1500);

    // Delete e1 => all zero
    await repo.delete(e1.id);
    entries = await repo.getByHousehold(HH);
    balances = calculateFinancialBalances(entries, 'CHF', [], ['a', 'b']);
    expect(balances.get('a')).toBe(0);
    expect(balances.get('b')).toBe(0);
  });
});
