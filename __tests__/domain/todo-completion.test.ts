/**
 * ChoreScore V3 — Todo Completion Tests
 *
 * Validates the atomic invariant: completing a todo creates exactly ONE
 * ContributionEntry and updates the todo status, using the household's unit.
 * No chrono, no premium gating, no data destruction.
 *
 * The completion is executed through `completeTodoAtomic`, a single
 * application-layer operation that writes the todo status update and the
 * ContributionEntry inside one storage-level transaction. Failure-injection
 * tests verify that a partial write can never survive:
 *   (a) todo update fails  → no ContributionEntry is created;
 *   (b) contribution fails → the todo is not marked completed;
 *   (c) retry after a failure → exactly one ContributionEntry exists.
 */

import { TodoItem, Household } from '../../src/domain/entities';
import { createInMemoryRepositories, AllRepositories } from '../../src/infrastructure/repositories/RepositoryFactory';
import { planTodoCompletion } from '../../src/domain/services/todoCompletionService';
import { completeTodoAtomic } from '../../src/application/use-cases/completeTodoAtomic';
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
  test('completeTodoAtomic writes the todo status and exactly one ContributionEntry', async () => {
    const repos = createInMemoryRepositories();

    const t = await repos.todos.create({
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
    const result = await completeTodoAtomic(repos, {
      todo: t,
      household: h,
      performerMemberId: 'a',
      value: 15,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
    });

    expect(result.updatedTodo.status).toBe('completed');
    expect(result.contributionEntry.value).toBe(15);
    expect(result.contributionEntry.unit).toBe('minutes');

    // The todo is completed in the store
    const storedTodo = await repos.todos.getById(t.id);
    expect(storedTodo?.status).toBe('completed');
    expect(storedTodo?.completedAt).toBeDefined();

    // Verify exactly one contribution entry exists
    const entries = await repos.contributions.getByHousehold(HH);
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('Vaisselle');
    expect(entries[0].value).toBe(15);
    expect(entries[0].unit).toBe('minutes');

    // Verify ledger remains zero-sum
    const balances = calculateContributionBalances(entries, 'minutes', [], ['a', 'b']);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
  });

  test('completing a todo with points unit creates a points contribution', async () => {
    const repos = createInMemoryRepositories();

    const t = await repos.todos.create({
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
    const result = await completeTodoAtomic(repos, {
      todo: t,
      household: h,
      performerMemberId: 'b',
      value: 8,
      beneficiaryMemberIds: ['a', 'b', 'c'],
      completedByUserId: 'user-b',
    });

    expect(result.contributionEntry.unit).toBe('points');
    expect(result.contributionEntry.value).toBe(8);

    // Balance: b gets +8, a and c each get -8/3, b gets -8/3
    const entries = await repos.contributions.getByHousehold(HH);
    const balances = calculateContributionBalances(entries, 'points', [], ['a', 'b', 'c']);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
  });

  test('multiple completions create multiple entries', async () => {
    const repos = createInMemoryRepositories();
    const h = household();

    const t1 = await repos.todos.create({
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

    const t2 = await repos.todos.create({
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
    await completeTodoAtomic(repos, {
      todo: t1,
      household: h,
      performerMemberId: 'a',
      value: 15,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
    });

    // Complete second todo
    await completeTodoAtomic(repos, {
      todo: t2,
      household: h,
      performerMemberId: 'b',
      value: 30,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-b',
    });

    // Exactly 2 contribution entries
    const entries = await repos.contributions.getByHousehold(HH);
    expect(entries).toHaveLength(2);

    // Ledger still zero-sum
    const balances = calculateContributionBalances(entries, 'minutes', [], ['a', 'b']);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
  });
});

describe('Atomic completion failure injection', () => {
  async function setupTodo(repos: AllRepositories) {
    return repos.todos.create({
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
  }

  function completionInput(t: TodoItem, h: Household) {
    return {
      todo: t,
      household: h,
      performerMemberId: 'a',
      value: 15,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
    };
  }

  test('(a) when the todo update fails, no ContributionEntry is created', async () => {
    const repos = createInMemoryRepositories();
    const t = await setupTodo(repos);
    const h = household();

    // Force the todo update to reject inside the transaction.
    const updateSpy = jest
      .spyOn(repos.todos, 'update')
      .mockRejectedValueOnce(new Error('todo update failed'));

    await expect(completeTodoAtomic(repos, completionInput(t, h))).rejects.toThrow(
      'todo update failed'
    );
    updateSpy.mockRestore();

    // No ContributionEntry was created — the transaction rolled back.
    const entries = await repos.contributions.getByHousehold(HH);
    expect(entries).toHaveLength(0);

    // The todo is still active.
    const storedTodo = await repos.todos.getById(t.id);
    expect(storedTodo?.status).toBe('todo');
    expect(storedTodo?.completedAt).toBeUndefined();
  });

  test('(b) when the contribution creation fails, the todo is not marked completed', async () => {
    const repos = createInMemoryRepositories();
    const t = await setupTodo(repos);
    const h = household();

    // Force the contribution create to reject after the todo update
    // already succeeded inside the transaction.
    const createSpy = jest
      .spyOn(repos.contributions, 'create')
      .mockRejectedValueOnce(new Error('contribution create failed'));

    await expect(completeTodoAtomic(repos, completionInput(t, h))).rejects.toThrow(
      'contribution create failed'
    );
    createSpy.mockRestore();

    // The todo was rolled back to 'todo' — not silently marked completed.
    const storedTodo = await repos.todos.getById(t.id);
    expect(storedTodo?.status).toBe('todo');
    expect(storedTodo?.completedAt).toBeUndefined();

    // No orphan ContributionEntry survived the rollback.
    const entries = await repos.contributions.getByHousehold(HH);
    expect(entries).toHaveLength(0);
  });

  test('(c) a retry after any failure cannot produce a second ContributionEntry', async () => {
    const repos = createInMemoryRepositories();
    const t = await setupTodo(repos);
    const h = household();

    // First attempt: contribution create fails once.
    const createSpy = jest
      .spyOn(repos.contributions, 'create')
      .mockRejectedValueOnce(new Error('transient failure'));

    await expect(completeTodoAtomic(repos, completionInput(t, h))).rejects.toThrow(
      'transient failure'
    );
    createSpy.mockRestore();

    // Nothing survived the failed attempt.
    expect(await repos.contributions.getByHousehold(HH)).toHaveLength(0);
    expect((await repos.todos.getById(t.id))?.status).toBe('todo');

    // Retry succeeds.
    await completeTodoAtomic(repos, completionInput(t, h));

    // Exactly ONE ContributionEntry exists — the retry did not duplicate.
    const entries = await repos.contributions.getByHousehold(HH);
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe('Vaisselle');
    expect(entries[0].value).toBe(15);

    // The todo is completed exactly once.
    const storedTodo = await repos.todos.getById(t.id);
    expect(storedTodo?.status).toBe('completed');
    expect(storedTodo?.completedAt).toBeDefined();

    // Ledger remains zero-sum.
    const balances = calculateContributionBalances(entries, 'minutes', [], ['a', 'b']);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
  });

  test('(c2) a retry after a todo-update failure also produces exactly one entry', async () => {
    const repos = createInMemoryRepositories();
    const t = await setupTodo(repos);
    const h = household();

    // First attempt: todo update fails once.
    const updateSpy = jest
      .spyOn(repos.todos, 'update')
      .mockRejectedValueOnce(new Error('transient todo failure'));

    await expect(completeTodoAtomic(repos, completionInput(t, h))).rejects.toThrow(
      'transient todo failure'
    );
    updateSpy.mockRestore();

    expect(await repos.contributions.getByHousehold(HH)).toHaveLength(0);
    expect((await repos.todos.getById(t.id))?.status).toBe('todo');

    // Retry succeeds.
    await completeTodoAtomic(repos, completionInput(t, h));

    const entries = await repos.contributions.getByHousehold(HH);
    expect(entries).toHaveLength(1);
    expect((await repos.todos.getById(t.id))?.status).toBe('completed');
  });
});