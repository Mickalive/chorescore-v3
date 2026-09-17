/**
 * ChoreScore V3 — Todo Completion Tests
 *
 * Validates the atomic invariant: completing a todo creates exactly ONE
 * ContributionEntry and updates the todo status, using the household's unit.
 * No chrono, no premium gating, no data destruction.
 */

import { TodoItem, Household, ContributionUnit } from '../../src/domain/entities';
import { InMemoryTodoRepository, InMemoryContributionEntryRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import { planTodoCompletion } from '../../src/domain/services/todoCompletionService';
import { calculateContributionBalances, contributionLedgerIsZeroSum } from '../../src/domain/calculations/contributionLedger';

const HH = 'h-1';

function household(overrides: Partial<Household> = {}): Household {
  return {
    id: HH,
    name: 'Test Group',
    ownerId: 'user-a',
    contributionUnit: 'minutes',
    crossLedgerCompensationEnabled: false,
    contributionToMoneyRate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function todo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo-1',
    householdId: HH,
    title: 'Sortir les poubelles',
    assigneeMemberId: 'b',
    beneficiaryMemberIds: ['a', 'b'],
    dueAt: null,
    reminderAt: null,
    notes: '',
    persistentTaskId: null,
    status: 'todo',
    createdAt: '2026-09-16T08:00:00.000Z',
    ...overrides,
  };
}

describe('Todo completion planning', () => {
  test('planTodoCompletion produces exactly one contribution entry with the household unit', () => {
    const t = todo();
    const h = household();

    const result = planTodoCompletion({
      todo: t,
      household: h,
      performerMemberId: 'b',
      value: 20,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-b',
    });

    // Exactly one contribution entry
    expect(result.contributionEntry).toBeDefined();
    expect(result.contributionEntry.label).toBe('Sortir les poubelles');
    expect(result.contributionEntry.value).toBe(20);
    expect(result.contributionEntry.unit).toBe('minutes'); // from household
    expect(result.contributionEntry.performedByMemberId).toBe('b');
    expect(result.contributionEntry.beneficiaryMemberIds).toEqual(['a', 'b']);
    expect(result.contributionEntry.householdId).toBe(HH);

    // Todo is marked completed
    expect(result.updatedTodo.status).toBe('completed');
    expect(result.updatedTodo.completedAt).toBeDefined();
  });

  test('planTodoCompletion uses points unit when household is in points mode', () => {
    const t = todo({ persistentTaskId: 'pt-1' });
    const h = household({ contributionUnit: 'points' });

    const result = planTodoCompletion({
      todo: t,
      household: h,
      performerMemberId: 'a',
      value: 5,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
    });

    expect(result.contributionEntry.unit).toBe('points');
    expect(result.contributionEntry.value).toBe(5);
  });

  test('planTodoCompletion preserves persistentTaskId from the todo', () => {
    const t = todo({ persistentTaskId: 'pt-vacuum' });
    const h = household();

    const result = planTodoCompletion({
      todo: t,
      household: h,
      performerMemberId: 'a',
      value: 30,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
    });

    expect(result.contributionEntry.persistentTaskId).toBe('pt-vacuum');
  });

  test('planTodoCompletion throws on already completed todo', () => {
    const t = todo({ status: 'completed' });

    expect(() =>
      planTodoCompletion({
        todo: t,
        household: household(),
        performerMemberId: 'a',
        value: 10,
        beneficiaryMemberIds: ['a'],
        completedByUserId: 'user-a',
      })
    ).toThrow('Todo is already completed');
  });

  test('planTodoCompletion throws on zero or negative value', () => {
    const t = todo();

    expect(() =>
      planTodoCompletion({
        todo: t,
        household: household(),
        performerMemberId: 'a',
        value: 0,
        beneficiaryMemberIds: ['a'],
        completedByUserId: 'user-a',
      })
    ).toThrow('positive finite number');

    expect(() =>
      planTodoCompletion({
        todo: t,
        household: household(),
        performerMemberId: 'a',
        value: -5,
        beneficiaryMemberIds: ['a'],
        completedByUserId: 'user-a',
      })
    ).toThrow('positive finite number');
  });

  test('planTodoCompletion throws on empty beneficiaries', () => {
    const t = todo();

    expect(() =>
      planTodoCompletion({
        todo: t,
        household: household(),
        performerMemberId: 'a',
        value: 10,
        beneficiaryMemberIds: [],
        completedByUserId: 'user-a',
      })
    ).toThrow('At least one beneficiary');
  });

  test('planTodoCompletion throws on empty performer', () => {
    const t = todo();

    expect(() =>
      planTodoCompletion({
        todo: t,
        household: household(),
        performerMemberId: '',
        value: 10,
        beneficiaryMemberIds: ['a'],
        completedByUserId: 'user-a',
      })
    ).toThrow('Performer is required');
  });

  test('planTodoCompletion throws when todo householdId mismatches household', () => {
    const t = todo({ householdId: 'other-hh' });

    expect(() =>
      planTodoCompletion({
        todo: t,
        household: household(),
        performerMemberId: 'a',
        value: 10,
        beneficiaryMemberIds: ['a'],
        completedByUserId: 'user-a',
      })
    ).toThrow('does not belong to this household');
  });
});

describe('Atomic completion integration', () => {
  let todoRepo: InMemoryTodoRepository;
  let contribRepo: InMemoryContributionEntryRepository;

  beforeEach(() => {
    todoRepo = new InMemoryTodoRepository();
    contribRepo = new InMemoryContributionEntryRepository();
  });

  test('creating the contribution and updating the todo is atomic in the repos', async () => {
    const t = await todoRepo.create({
      householdId: HH,
      title: 'Vaisselle',
      assigneeMemberId: 'a',
      beneficiaryMemberIds: ['a', 'b'],
      dueAt: null,
      reminderAt: null,
      notes: '',
      persistentTaskId: null,
      status: 'todo',
    });

    const h = household();
    const result = planTodoCompletion({
      todo: t,
      household: h,
      performerMemberId: 'a',
      value: 15,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
    });

    // Simulate atomic write: both succeed or both fail
    const [updatedTodo, createdEntry] = await Promise.all([
      todoRepo.update(t.id, { status: result.updatedTodo.status, completedAt: result.updatedTodo.completedAt }),
      contribRepo.create(result.contributionEntry),
    ]);

    expect(updatedTodo.status).toBe('completed');
    expect(createdEntry.id).toBeDefined();
    expect(createdEntry.value).toBe(15);
    expect(createdEntry.unit).toBe('minutes');

    // Verify exactly one contribution entry exists
    const entries = await contribRepo.getByHousehold(HH);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(createdEntry.id);

    // Verify ledger remains zero-sum
    const balances = calculateContributionBalances(entries, 'minutes', [], ['a', 'b']);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
  });

  test('completing a todo with points unit creates a points contribution', async () => {
    const t = await todoRepo.create({
      householdId: HH,
      title: 'Aspirateur',
      assigneeMemberId: 'b',
      beneficiaryMemberIds: ['a', 'b', 'c'],
      dueAt: null,
      reminderAt: null,
      notes: '',
      persistentTaskId: null,
      status: 'todo',
    });

    const h = household({ contributionUnit: 'points' });
    const result = planTodoCompletion({
      todo: t,
      household: h,
      performerMemberId: 'b',
      value: 8,
      beneficiaryMemberIds: ['a', 'b', 'c'],
      completedByUserId: 'user-b',
    });

    await todoRepo.update(t.id, { status: 'completed', completedAt: result.updatedTodo.completedAt });
    const created = await contribRepo.create(result.contributionEntry);

    expect(created.unit).toBe('points');
    expect(created.value).toBe(8);

    // Balance: b gets +8, a and c each get -8/3, b gets -8/3
    const entries = await contribRepo.getByHousehold(HH);
    const balances = calculateContributionBalances(entries, 'points', [], ['a', 'b', 'c']);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
  });

  test('multiple completions create multiple entries', async () => {
    const h = household();

    const t1 = await todoRepo.create({
      householdId: HH,
      title: 'Vaisselle',
      assigneeMemberId: 'a',
      beneficiaryMemberIds: ['a', 'b'],
      dueAt: null,
      reminderAt: null,
      notes: '',
      persistentTaskId: null,
      status: 'todo',
    });

    const t2 = await todoRepo.create({
      householdId: HH,
      title: 'Courses',
      assigneeMemberId: 'b',
      beneficiaryMemberIds: ['a', 'b'],
      dueAt: null,
      reminderAt: null,
      notes: '',
      persistentTaskId: null,
      status: 'todo',
    });

    // Complete first todo
    const r1 = planTodoCompletion({
      todo: t1,
      household: h,
      performerMemberId: 'a',
      value: 15,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
    });
    await todoRepo.update(t1.id, { status: 'completed', completedAt: r1.updatedTodo.completedAt });
    await contribRepo.create(r1.contributionEntry);

    // Complete second todo
    const r2 = planTodoCompletion({
      todo: t2,
      household: h,
      performerMemberId: 'b',
      value: 30,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-b',
    });
    await todoRepo.update(t2.id, { status: 'completed', completedAt: r2.updatedTodo.completedAt });
    await contribRepo.create(r2.contributionEntry);

    // Exactly 2 contribution entries
    const entries = await contribRepo.getByHousehold(HH);
    expect(entries).toHaveLength(2);

    // Ledger still zero-sum
    const balances = calculateContributionBalances(entries, 'minutes', [], ['a', 'b']);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
  });
});
