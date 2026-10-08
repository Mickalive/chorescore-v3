/**
 * V4-01 — Todo supports Task or Expense, completed atomically
 *
 * Evidence for the acceptance bullet "À faire supporte Tâche ou Dépense,
 * complétion atomique":
 *
 *   - kind 'task'    → todos.update + contributions.create in ONE transaction
 *   - kind 'expense' → todos.update + expenses.create in ONE transaction
 *   - a kind/input mismatch is an error, never a silent conversion
 *   - a failed write rolls back completely; a retry cannot duplicate
 *   - task completion snapshots the category default ratio, note and
 *     attachments on the created entry
 *   - both ledgers stay zero-sum (contribution per unit, money per currency)
 *   - a V3 todo without `kind` still behaves exactly as a task
 */

import { Household, TodoItem } from '../../src/domain/entities';
import {
  AllRepositories,
  createInMemoryRepositories,
} from '../../src/infrastructure/repositories/RepositoryFactory';
import {
  ExpenseCompletionInput,
  planTodoCompletion,
} from '../../src/domain/services/todoCompletionService';
import { completeTodoAtomic } from '../../src/application/use-cases/completeTodoAtomic';
import {
  calculateContributionBalances,
  contributionLedgerIsZeroSum,
} from '../../src/domain/calculations/contributionLedger';
import {
  calculateFinancialBalancesByCurrency,
  financialLedgerIsZeroSum,
} from '../../src/domain/calculations/expenseLedger';
import { createAttachment } from '../../src/domain/services/attachmentService';

const HH = 'h-todo-v4-01';

function household(overrides: Partial<Household> = {}): Household {
  return {
    id: HH,
    name: 'Groupe V4-01',
    ownerId: 'user-a',
    contributionUnit: 'minutes',
    crossLedgerCompensationEnabled: false,
    contributionToMoneyRate: null,
    createdAt: '2026-09-16T08:00:00.000Z',
    ...overrides,
  };
}

function taskTodo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo-task-1',
    householdId: HH,
    title: 'Sortir les poubelles',
    assigneeMemberId: 'a',
    beneficiaryMemberIds: ['a', 'b'],
    dueAt: null,
    reminderAt: null,
    notes: '',
    persistentTaskId: null,
    status: 'todo',
    createdAt: '2026-09-16T08:00:00.000Z',
    kind: 'task',
    categoryId: null,
    ...overrides,
  };
}

function expenseTodo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo-exp-1',
    householdId: HH,
    title: 'Courses du samedi',
    assigneeMemberId: 'a',
    beneficiaryMemberIds: ['a', 'b', 'c'],
    dueAt: null,
    reminderAt: null,
    notes: 'Aldi, 14 septembre',
    persistentTaskId: null,
    status: 'todo',
    createdAt: '2026-09-16T08:00:00.000Z',
    kind: 'expense',
    categoryId: null,
    expenseAmountMinor: 4500,
    expenseCurrency: 'CHF',
    ...overrides,
  };
}

async function setupTodo(repos: AllRepositories, todo: TodoItem): Promise<TodoItem> {
  const { id, ...data } = todo;
  return repos.todos.create(data as Omit<TodoItem, 'id'>);
}

describe('V4-01 Todo kind — planning', () => {
  test('a task todo plans exactly one ContributionEntry with the household unit', () => {
    const result = planTodoCompletion({
      todo: taskTodo(),
      household: household(),
      performerMemberId: 'a',
      value: 15,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
    });

    expect(result.kind).toBe('task');
    expect(result.contributionEntry.label).toBe('Sortir les poubelles');
    expect(result.contributionEntry.value).toBe(15);
    expect(result.contributionEntry.unit).toBe('minutes');
    expect(result.expenseEntry).toBeUndefined();
    expect(result.updatedTodo.status).toBe('completed');
    expect(result.updatedTodo.kind).toBe('task');
  });

  test('an expense todo plans exactly one ExpenseEntry in integer minor units', () => {
    const result = planTodoCompletion({
      todo: expenseTodo(),
      household: household(),
      paidByMemberId: 'a',
      amountMinor: 4500,
      currency: 'chf',
      participantMemberIds: ['a', 'b', 'c'],
      completedByUserId: 'user-a',
    });

    expect(result.kind).toBe('expense');
    expect(result.expenseEntry.amountMinor).toBe(4500);
    expect(result.expenseEntry.currency).toBe('CHF'); // normalized
    expect(result.expenseEntry.paidByMemberId).toBe('a');
    expect(result.expenseEntry.participantMemberIds).toEqual(['a', 'b', 'c']);
    expect(result.expenseEntry.splitMode).toBe('equal');
    expect(result.expenseEntry.title).toBe('Courses du samedi');
    // The todo note is carried onto the entry (already stored data, verbatim).
    expect(result.expenseEntry.note).toBe('Aldi, 14 septembre');
    expect(result.contributionEntry).toBeUndefined();
    expect(result.updatedTodo.kind).toBe('expense');
    expect(result.updatedTodo.status).toBe('completed');
  });

  test('a V3 todo without kind still behaves as a task', () => {
    const legacy = taskTodo();
    delete legacy.kind;

    const result = planTodoCompletion({
      todo: legacy,
      household: household(),
      performerMemberId: 'b',
      value: 10,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-b',
    });

    expect(result.kind).toBe('task');
    expect(result.contributionEntry.unit).toBe('minutes');
    expect(result.updatedTodo.kind).toBe('task');
  });

  test('cross-kind input mismatches are errors, never silent conversions', () => {
    // Expense input against a task todo.
    expect(() =>
      planTodoCompletion({
        todo: taskTodo(),
        household: household(),
        paidByMemberId: 'a',
        amountMinor: 4500,
        currency: 'CHF',
        participantMemberIds: ['a', 'b'],
        completedByUserId: 'user-a',
      } as ExpenseCompletionInput)
    ).toThrow('Expense completion input requires a todo of kind expense');

    // Task input against an expense todo.
    expect(() =>
      planTodoCompletion({
        todo: expenseTodo(),
        household: household(),
        performerMemberId: 'a',
        value: 15,
        beneficiaryMemberIds: ['a', 'b'],
        completedByUserId: 'user-a',
      })
    ).toThrow('Task completion input requires a todo of kind task');
  });

  test('an expense amount must be a positive integer in minor units', () => {
    const base = {
      todo: expenseTodo(),
      household: household(),
      paidByMemberId: 'a',
      currency: 'CHF',
      participantMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
    };

    expect(() => planTodoCompletion({ ...base, amountMinor: 0 })).toThrow('positive integer');
    expect(() => planTodoCompletion({ ...base, amountMinor: -100 })).toThrow('positive integer');
    expect(() => planTodoCompletion({ ...base, amountMinor: 45.5 })).toThrow('positive integer');
  });

  test('expense participants must be unique', () => {
    expect(() =>
      planTodoCompletion({
        todo: expenseTodo(),
        household: household(),
        paidByMemberId: 'a',
        amountMinor: 4500,
        currency: 'CHF',
        participantMemberIds: ['a', 'b', 'a'],
        completedByUserId: 'user-a',
      })
    ).toThrow('unique');
  });

  test('a custom expense split must sum exactly to the amount', () => {
    const valid: ExpenseCompletionInput = {
      todo: expenseTodo(),
      household: household(),
      paidByMemberId: 'a',
      amountMinor: 4500,
      currency: 'CHF',
      participantMemberIds: ['a', 'b', 'c'],
      completedByUserId: 'user-a',
      customShares: [
        { memberId: 'a', amountMinor: 2500 },
        { memberId: 'b', amountMinor: 1000 },
        { memberId: 'c', amountMinor: 1000 },
      ],
    };

    const ok = planTodoCompletion(valid);
    expect(ok.kind).toBe('expense');
    expect(ok.expenseEntry.splitMode).toBe('custom');
    expect(ok.expenseEntry.customShares).toEqual([
      { memberId: 'a', amountMinor: 2500 },
      { memberId: 'b', amountMinor: 1000 },
      { memberId: 'c', amountMinor: 1000 },
    ]);

    // A split that does not cover the amount fails during planning,
    // before any transaction is opened.
    expect(() =>
      planTodoCompletion({
        ...valid,
        customShares: [
          { memberId: 'a', amountMinor: 2500 },
          { memberId: 'b', amountMinor: 1000 },
          { memberId: 'c', amountMinor: 900 },
        ],
      })
    ).toThrow();
  });
});

describe('V4-01 Todo completion — task path with V4-01 entry fields', () => {
  test('snapshots the category default ratio, note and attachments onto the entry', async () => {
    const repos = createInMemoryRepositories();
    const todo = await setupTodo(repos, taskTodo());

    const categoryRatio = [
      { memberId: 'a', weight: 1 },
      { memberId: 'b', weight: 3 },
    ];
    const attachment = createAttachment({
      id: 'att-1',
      kind: 'photo',
      ref: 'file:///cache/photo-1.jpg',
      mimeType: 'image/jpeg',
      byteSize: 1234,
      createdAt: '2026-09-16T10:00:00.000Z',
    });

    const result = await completeTodoAtomic(repos, {
      todo,
      household: household(),
      performerMemberId: 'a',
      value: 40,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
      categoryId: 'cat-maison',
      categoryLabelSnapshot: 'Maison',
      note: '  après le dîner  ',
      attachments: [attachment],
      category: { defaultTaskRatio: categoryRatio },
    });

    expect(result.kind).toBe('task');
    const entry = result.contributionEntry;

    // Snapshoted category ratio on the entry.
    expect(entry.splitMode).toBe('custom');
    expect(entry.splitSource).toBe('category-default');
    expect(entry.splitWeights).toEqual(categoryRatio);
    expect(entry.categoryId).toBe('cat-maison');
    expect(entry.categoryLabelSnapshot).toBe('Maison');
    expect(entry.note).toBe('après le dîner'); // normalized
    expect(entry.attachments).toHaveLength(1);
    expect(entry.attachments![0].ref).toBe('file:///cache/photo-1.jpg');

    // The stored entry matches the plan and the ledger stays zero-sum.
    const entries = await repos.contributions.getByHousehold(HH);
    expect(entries).toHaveLength(1);
    expect(entries[0].splitWeights).toEqual(categoryRatio);
    expect(entries[0].attachments![0].ref).toBe('file:///cache/photo-1.jpg');

    const balances = calculateContributionBalances(entries, 'minutes', [], ['a', 'b']);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
    // 40 done by a (weight 1/4) → a: +40 − 10 = +30, b: −30.
    expect(balances.get('a')).toBeCloseTo(30, 9);
    expect(balances.get('b')).toBeCloseTo(-30, 9);

    // Editing the category afterwards cannot rewrite the stored snapshot.
    categoryRatio[0].weight = 99;
    const after = await repos.contributions.getByHousehold(HH);
    expect(after[0].splitWeights).toEqual([
      { memberId: 'a', weight: 1 },
      { memberId: 'b', weight: 3 },
    ]);
  });

  test('a plain V3-shaped completion keeps the exact baseline entry shape', async () => {
    const repos = createInMemoryRepositories();
    const todo = await setupTodo(repos, taskTodo());

    const result = await completeTodoAtomic(repos, {
      todo,
      household: household(),
      performerMemberId: 'a',
      value: 15,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
    });

    const entry = result.contributionEntry;
    // Equal split → no custom split fields at all.
    expect(entry.splitMode).toBeUndefined();
    expect(entry.splitWeights).toBeUndefined();
    expect(entry.splitSource).toBeUndefined();
    expect(entry.note).toBeUndefined();
    expect(entry.attachments).toBeUndefined();
    expect(entry.categoryLabelSnapshot).toBeUndefined();

    const balances = calculateContributionBalances(
      [entry as { id: string }],
      'minutes',
      [],
      ['a', 'b']
    );
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
  });

  test('a note or attachment bound violation fails before the transaction', async () => {
    const repos = createInMemoryRepositories();
    const todo = await setupTodo(repos, taskTodo());

    await expect(
      completeTodoAtomic(repos, {
        todo,
        household: household(),
        performerMemberId: 'a',
        value: 15,
        beneficiaryMemberIds: ['a', 'b'],
        completedByUserId: 'user-a',
        note: 'x'.repeat(5000),
      })
    ).rejects.toThrow('2000');

    // Nothing was written: the todo is still open, the ledger is empty.
    expect((await repos.todos.getById(todo.id))?.status).toBe('todo');
    expect(await repos.contributions.getByHousehold(HH)).toHaveLength(0);

    await expect(
      completeTodoAtomic(repos, {
        todo,
        household: household(),
        performerMemberId: 'a',
        value: 15,
        beneficiaryMemberIds: ['a', 'b'],
        completedByUserId: 'user-a',
        attachments: [
          { id: 'bad', kind: 'photo' as 'photo', ref: '', createdAt: '2026-09-16T10:00:00.000Z' },
        ],
      })
    ).rejects.toThrow('non-empty');
    expect((await repos.todos.getById(todo.id))?.status).toBe('todo');
    expect(await repos.contributions.getByHousehold(HH)).toHaveLength(0);
  });
});

describe('V4-01 Todo completion — expense path', () => {
  test('writes exactly one ExpenseEntry and keeps money zero-sum per currency', async () => {
    const repos = createInMemoryRepositories();
    const todo = await setupTodo(repos, expenseTodo());

    const result = await completeTodoAtomic(repos, {
      todo,
      household: household(),
      paidByMemberId: 'a',
      amountMinor: 4500,
      currency: 'CHF',
      participantMemberIds: ['a', 'b', 'c'],
      completedByUserId: 'user-a',
      categoryId: 'cat-courses',
      categoryLabelSnapshot: 'Courses',
    });

    expect(result.kind).toBe('expense');

    // Exactly one expense entry, no contribution entry at all.
    const expenses = await repos.expenses.getByHousehold(HH);
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amountMinor).toBe(4500);
    expect(expenses[0].currency).toBe('CHF');
    expect(expenses[0].categoryId).toBe('cat-courses');
    expect(expenses[0].categoryLabelSnapshot).toBe('Courses');
    expect(await repos.contributions.getByHousehold(HH)).toHaveLength(0);

    // The todo is completed with its kind preserved.
    const stored = await repos.todos.getById(todo.id);
    expect(stored?.status).toBe('completed');
    expect(stored?.kind).toBe('expense');

    // Money zero-sum for every currency in play.
    const balances = calculateFinancialBalancesByCurrency(expenses, [], ['a', 'b', 'c']);
    expect(financialLedgerIsZeroSum(balances.get('CHF')!)).toBe(true);
    expect(balances.get('CHF')!.get('a')).toBe(4500 - 1500);
    expect(balances.get('CHF')!.get('b')).toBe(-1500);
    expect(balances.get('CHF')!.get('c')).toBe(-1500);

    // The contribution ledger is untouched by an expense completion.
    const contributionBalances = calculateContributionBalances(
      await repos.contributions.getByHousehold(HH),
      'minutes',
      [],
      ['a', 'b', 'c']
    );
    expect(contributionLedgerIsZeroSum(contributionBalances)).toBe(true);
  });

  test('a custom expense split is persisted exactly and stays zero-sum', async () => {
    const repos = createInMemoryRepositories();
    const todo = await setupTodo(repos, expenseTodo());

    const result = await completeTodoAtomic(repos, {
      todo,
      household: household(),
      paidByMemberId: 'a',
      amountMinor: 4500,
      currency: 'CHF',
      participantMemberIds: ['a', 'b', 'c'],
      completedByUserId: 'user-a',
      customShares: [
        { memberId: 'a', amountMinor: 2500 },
        { memberId: 'b', amountMinor: 1000 },
        { memberId: 'c', amountMinor: 1000 },
      ],
    });

    expect(result.expenseEntry.splitMode).toBe('custom');
    const expenses = await repos.expenses.getByHousehold(HH);
    expect(expenses).toHaveLength(1);
    expect(expenses[0].customShares).toEqual([
      { memberId: 'a', amountMinor: 2500 },
      { memberId: 'b', amountMinor: 1000 },
      { memberId: 'c', amountMinor: 1000 },
    ]);
    expect(expenses[0].customShares!.reduce((sum, s) => sum + s.amountMinor, 0)).toBe(4500);

    const balances = calculateFinancialBalancesByCurrency(expenses, [], ['a', 'b', 'c']);
    expect(financialLedgerIsZeroSum(balances.get('CHF')!)).toBe(true);
    expect(balances.get('CHF')!.get('a')).toBe(4500 - 2500);
  });
});

describe('V4-01 Todo completion — atomicity across both kinds', () => {
  test('(a) when expenses.create fails, the todo update rolls back', async () => {
    const repos = createInMemoryRepositories();
    const todo = await setupTodo(repos, expenseTodo());

    const spy = jest
      .spyOn(repos.expenses, 'create')
      .mockRejectedValueOnce(new Error('expense create failed'));

    await expect(
      completeTodoAtomic(repos, {
        todo,
        household: household(),
        paidByMemberId: 'a',
        amountMinor: 4500,
        currency: 'CHF',
        participantMemberIds: ['a', 'b', 'c'],
        completedByUserId: 'user-a',
      })
    ).rejects.toThrow('expense create failed');
    spy.mockRestore();

    expect(await repos.expenses.getByHousehold(HH)).toHaveLength(0);
    const stored = await repos.todos.getById(todo.id);
    expect(stored?.status).toBe('todo');
    expect(stored?.completedAt).toBeUndefined();
  });

  test('(b) retry after a failed expense write produces exactly one entry', async () => {
    const repos = createInMemoryRepositories();
    const todo = await setupTodo(repos, expenseTodo());
    const input = {
      todo,
      household: household(),
      paidByMemberId: 'a',
      amountMinor: 4500,
      currency: 'CHF',
      participantMemberIds: ['a', 'b', 'c'],
      completedByUserId: 'user-a',
    };

    const spy = jest
      .spyOn(repos.expenses, 'create')
      .mockRejectedValueOnce(new Error('transient failure'));
    await expect(completeTodoAtomic(repos, input)).rejects.toThrow('transient failure');
    spy.mockRestore();

    expect(await repos.expenses.getByHousehold(HH)).toHaveLength(0);
    expect((await repos.todos.getById(todo.id))?.status).toBe('todo');

    await completeTodoAtomic(repos, input);

    const expenses = await repos.expenses.getByHousehold(HH);
    expect(expenses).toHaveLength(1);
    expect((await repos.todos.getById(todo.id))?.status).toBe('completed');

    const balances = calculateFinancialBalancesByCurrency(expenses, [], ['a', 'b', 'c']);
    expect(financialLedgerIsZeroSum(balances.get('CHF')!)).toBe(true);
  });

  test('(c) a failed contribution write rolls back the task todo, then retries to one entry', async () => {
    const repos = createInMemoryRepositories();
    const todo = await setupTodo(repos, taskTodo());
    const input = {
      todo,
      household: household(),
      performerMemberId: 'a',
      value: 15,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
    };

    const spy = jest
      .spyOn(repos.contributions, 'create')
      .mockRejectedValueOnce(new Error('contribution create failed'));
    await expect(completeTodoAtomic(repos, input)).rejects.toThrow('contribution create failed');
    spy.mockRestore();

    expect(await repos.contributions.getByHousehold(HH)).toHaveLength(0);
    expect((await repos.todos.getById(todo.id))?.status).toBe('todo');

    await completeTodoAtomic(repos, input);

    const entries = await repos.contributions.getByHousehold(HH);
    expect(entries).toHaveLength(1);
    expect((await repos.todos.getById(todo.id))?.status).toBe('completed');
    expect(contributionLedgerIsZeroSum(calculateContributionBalances(entries, 'minutes', [], ['a', 'b']))).toBe(
      true
    );
  });

  test('(d) a failed todo update never writes an orphan ledger entry for either kind', async () => {
    const repos = createInMemoryRepositories();
    const task = await setupTodo(repos, taskTodo());
    const expense = await setupTodo(repos, expenseTodo({ id: 'todo-exp-2' }));

    const updateSpy = jest
      .spyOn(repos.todos, 'update')
      .mockRejectedValueOnce(new Error('todo update failed'))
      .mockRejectedValueOnce(new Error('todo update failed'));

    await expect(
      completeTodoAtomic(repos, {
        todo: task,
        household: household(),
        performerMemberId: 'a',
        value: 15,
        beneficiaryMemberIds: ['a', 'b'],
        completedByUserId: 'user-a',
      })
    ).rejects.toThrow('todo update failed');

    await expect(
      completeTodoAtomic(repos, {
        todo: expense,
        household: household(),
        paidByMemberId: 'a',
        amountMinor: 4500,
        currency: 'CHF',
        participantMemberIds: ['a', 'b', 'c'],
        completedByUserId: 'user-a',
      })
    ).rejects.toThrow('todo update failed');
    updateSpy.mockRestore();

    expect(await repos.contributions.getByHousehold(HH)).toHaveLength(0);
    expect(await repos.expenses.getByHousehold(HH)).toHaveLength(0);
    expect((await repos.todos.getById(task.id))?.status).toBe('todo');
    expect((await repos.todos.getById(expense.id))?.status).toBe('todo');
  });

  test('(e) completing both kinds in the same group keeps the two ledgers independent', async () => {
    const repos = createInMemoryRepositories();
    const task = await setupTodo(repos, taskTodo());
    const expense = await setupTodo(repos, expenseTodo({ id: 'todo-exp-3' }));

    await completeTodoAtomic(repos, {
      todo: task,
      household: household(),
      performerMemberId: 'a',
      value: 30,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
    });
    await completeTodoAtomic(repos, {
      todo: expense,
      household: household(),
      paidByMemberId: 'b',
      amountMinor: 3000,
      currency: 'CHF',
      participantMemberIds: ['a', 'b', 'c'],
      completedByUserId: 'user-a',
    });

    const entries = await repos.contributions.getByHousehold(HH);
    const expenses = await repos.expenses.getByHousehold(HH);
    expect(entries).toHaveLength(1);
    expect(expenses).toHaveLength(1);

    // Both ledgers zero-sum, and neither leaked into the other.
    expect(
      contributionLedgerIsZeroSum(calculateContributionBalances(entries, 'minutes', [], ['a', 'b', 'c']))
    ).toBe(true);
    expect(
      financialLedgerIsZeroSum(
        calculateFinancialBalancesByCurrency(expenses, [], ['a', 'b', 'c']).get('CHF')!
      )
    ).toBe(true);
    // The contribution entry carries no money fields and vice versa.
    expect((entries[0] as unknown as Record<string, unknown>).amountMinor).toBeUndefined();
    expect((expenses[0] as unknown as Record<string, unknown>).value).toBeUndefined();
    expect(await repos.todos.getByHousehold(HH).then((all) => all.filter((t) => t.status === 'todo'))).toHaveLength(0);
  });
});
