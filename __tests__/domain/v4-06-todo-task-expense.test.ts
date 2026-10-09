/**
 * V4-06 — À faire — Tâche ou Dépense
 *
 * Evidence for the active criterion:
 *   - À faire creates items typed `task` or `expense`;
 *   - completing a task produces exactly one task ledger entry;
 *   - completing an expense produces exactly one expense ledger entry, with
 *     the confirmed amount and currency;
 *   - the split / beneficiaries are confirmed before completion;
 *   - optional note and photo are carried onto the created entry;
 *   - completion stays offline-safe and atomic (a failed write rolls back and
 *     a retry can never duplicate an entry).
 *
 * The domain foundation was delivered in V4-01; this suite proves the V4-06
 * screen wiring plus the UI-shaped completion payloads end to end.
 */

import * as fs from 'fs';
import * as path from 'path';

import { CATALOG } from '../../src/i18n/catalog';
import { Household, TodoItem } from '../../src/domain/entities';
import {
  AllRepositories,
  createInMemoryRepositories,
} from '../../src/infrastructure/repositories/RepositoryFactory';
import { completeTodoAtomic } from '../../src/application/use-cases/completeTodoAtomic';
import {
  expenseSharesFromRaw,
  taskWeightsFromRaw,
} from '../../src/domain/services/addEntryService';
import {
  calculateContributionBalances,
  contributionLedgerIsZeroSum,
} from '../../src/domain/calculations/contributionLedger';
import {
  calculateFinancialBalancesByCurrency,
  financialLedgerIsZeroSum,
} from '../../src/domain/calculations/expenseLedger';
import { createAttachment } from '../../src/domain/services/attachmentService';

const ROOT = path.resolve(__dirname, '../..');
const TODOS_SCREEN = fs.readFileSync(path.join(ROOT, 'app', '(tabs)', 'todos.tsx'), 'utf8');

const HH = 'h-todo-v4-06';
const MEMBERS = ['a', 'b', 'c'];

function household(overrides: Partial<Household> = {}): Household {
  return {
    id: HH,
    name: 'Groupe V4-06',
    ownerId: 'user-a',
    contributionUnit: 'minutes',
    crossLedgerCompensationEnabled: false,
    contributionToMoneyRate: null,
    createdAt: '2026-09-20T08:00:00.000Z',
    ...overrides,
  };
}

function taskTodo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo-task-v4-06',
    householdId: HH,
    title: 'Sortir les poubelles',
    assigneeMemberId: 'a',
    beneficiaryMemberIds: ['a', 'b'],
    dueAt: null,
    reminderAt: null,
    notes: '',
    persistentTaskId: null,
    status: 'todo',
    createdAt: '2026-09-20T08:00:00.000Z',
    kind: 'task',
    categoryId: null,
    ...overrides,
  };
}

function expenseTodo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: 'todo-expense-v4-06',
    householdId: HH,
    title: 'Courses du samedi',
    assigneeMemberId: null,
    beneficiaryMemberIds: MEMBERS,
    dueAt: null,
    reminderAt: null,
    notes: '',
    persistentTaskId: null,
    status: 'todo',
    createdAt: '2026-09-20T08:00:00.000Z',
    kind: 'expense',
    categoryId: null,
    expenseAmountMinor: 4500,
    expenseCurrency: 'CHF',
    ...overrides,
  };
}

async function seedTodo(repos: AllRepositories, todo: TodoItem): Promise<TodoItem> {
  const { id, ...data } = todo;
  return repos.todos.create(data as Omit<TodoItem, 'id'>);
}

// ── Screen wiring (source-level) ───────────────────────────────

describe('V4-06 À faire — screen wiring', () => {
  test('the create form offers a Tâche | Dépense kind selector', () => {
    expect(TODOS_SCREEN).toContain("kind: TodoKind");
    expect(TODOS_SCREEN).toContain("kind: 'task'");
    expect(TODOS_SCREEN).toContain("kind: 'expense'");
    expect(TODOS_SCREEN).toContain("t('todos.kindTask')");
    expect(TODOS_SCREEN).toContain("t('todos.kindExpense')");
  });

  test('expense creation collects a planned amount and a currency', () => {
    expect(TODOS_SCREEN).toContain('expenseAmountRaw');
    expect(TODOS_SCREEN).toContain('expenseCurrency');
    expect(TODOS_SCREEN).toContain("t('todos.plannedAmount')");
    expect(TODOS_SCREEN).toContain('expenseAmountMinor');
  });

  test('expense completion confirms payer, amount, currency and participants', () => {
    expect(TODOS_SCREEN).toContain('paidByMemberId: completeForm.paidByMemberId');
    expect(TODOS_SCREEN).toContain('amountMinor: completeParsedAmountMinor');
    expect(TODOS_SCREEN).toContain('currency: completeForm.currency');
    expect(TODOS_SCREEN).toContain('participantMemberIds: completeForm.beneficiaryMemberIds');
    expect(TODOS_SCREEN).toContain("t('add.paidBy')");
    expect(TODOS_SCREEN).toContain("t('add.participants')");
  });

  test('both kinds support an equal or custom split', () => {
    expect(TODOS_SCREEN).toContain("t('add.splitEqual')");
    expect(TODOS_SCREEN).toContain("t('add.splitCustom')");
    expect(TODOS_SCREEN).toContain('expenseSplitMode');
    expect(TODOS_SCREEN).toContain('taskSplitChoice');
    expect(TODOS_SCREEN).toContain('customShares');
    expect(TODOS_SCREEN).toContain('taskWeightsRaw');
  });

  test('completion supports optional note and photo and routes through the atomic use-case', () => {
    expect(TODOS_SCREEN).toContain("t('add.noteOptional')");
    expect(TODOS_SCREEN).toContain("t('add.photoOptional')");
    expect(TODOS_SCREEN).toContain('attachments: completeForm.attachments');
    // Exactly one entry per kind, through the single atomic use-case.
    expect(TODOS_SCREEN).toContain('completeTodoAtomic');
    expect(TODOS_SCREEN).toContain("emitDataChange('expense'");
    expect(TODOS_SCREEN).toContain("emitDataChange('contribution'");
  });

  test('a V3 todo without kind still defaults to a task', () => {
    expect(TODOS_SCREEN).toContain("selectedTodo?.kind ?? 'task'");
  });

  test('a synchronous guard prevents a rapid double-submit', () => {
    expect(TODOS_SCREEN).toContain('submittingRef');
    expect(TODOS_SCREEN).toContain('if (submittingRef.current) return;');
  });

  test('the screen builds splits through the shared pure helpers', () => {
    expect(TODOS_SCREEN).toContain('expenseSharesFromRaw');
    expect(TODOS_SCREEN).toContain('taskWeightsFromRaw');
  });

  test('the screen never names the task ledger as a Contribution', () => {
    expect(TODOS_SCREEN).not.toMatch(/\bContribution\b/);
  });
});

// ── i18n keys ──────────────────────────────────────────────────

describe('V4-06 À faire — i18n', () => {
  test('FR and EN expose the same new keys', () => {
    const keys = [
      'todos.newItem',
      'todos.kind',
      'todos.kindTask',
      'todos.kindExpense',
      'todos.plannedAmount',
      'todos.completeTaskTitle',
      'todos.completeExpenseTitle',
    ];
    for (const key of keys) {
      expect(CATALOG.fr[key]).toBeDefined();
      expect(CATALOG.en[key]).toBeDefined();
    }
  });

  test('French task/expense labels use correct accents', () => {
    expect(CATALOG.fr['todos.kindTask']).toBe('Tâche');
    expect(CATALOG.fr['todos.kindExpense']).toBe('Dépense');
    expect(CATALOG.fr['todos.plannedAmount']).toBe('Montant prévu');
    expect(CATALOG.fr['todos.completeTaskTitle']).toBe('Terminer la tâche');
    expect(CATALOG.fr['todos.completeExpenseTitle']).toBe('Terminer la dépense');
    expect(CATALOG.en['todos.kindExpense']).toBe('Expense');
  });
});

// ── UI-shaped completion payloads ──────────────────────────────

describe('V4-06 À faire — typed creation', () => {
  test('creates a task todo and an expense todo with their kind and expense defaults', async () => {
    const repos = createInMemoryRepositories();
    const task = await seedTodo(repos, taskTodo({ id: 'todo-create-task' }));
    const expense = await seedTodo(repos, expenseTodo({ id: 'todo-create-expense' }));

    const storedTask = await repos.todos.getById(task.id);
    const storedExpense = await repos.todos.getById(expense.id);
    expect(storedTask?.kind).toBe('task');
    expect(storedExpense?.kind).toBe('expense');
    expect(storedExpense?.expenseAmountMinor).toBe(4500);
    expect(storedExpense?.expenseCurrency).toBe('CHF');
    expect(await repos.todos.getByHousehold(HH)).toHaveLength(2);
  });
});

describe('V4-06 À faire — completion produces exactly one matching entry', () => {
  test('a task completed from À faire writes exactly one contribution entry', async () => {
    const repos = createInMemoryRepositories();
    const todo = await seedTodo(repos, taskTodo());

    const result = await completeTodoAtomic(repos, {
      todo,
      household: household(),
      performerMemberId: 'a',
      value: 15,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
    });

    expect(result.kind).toBe('task');
    expect(await repos.contributions.getByHousehold(HH)).toHaveLength(1);
    expect(await repos.expenses.getByHousehold(HH)).toHaveLength(0);
    expect((await repos.todos.getById(todo.id))?.status).toBe('completed');

    const balances = calculateContributionBalances(
      await repos.contributions.getByHousehold(HH),
      'minutes',
      [],
      ['a', 'b'],
    );
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
  });

  test('an expense completed from À faire writes exactly one expense entry with the confirmed amount/currency', async () => {
    const repos = createInMemoryRepositories();
    const todo = await seedTodo(repos, expenseTodo());

    // The UI parses the confirmed amount field into integer minor units and
    // builds equal/custom participant shares through these pure helpers.
    const result = await completeTodoAtomic(repos, {
      todo,
      household: household(),
      paidByMemberId: 'a',
      amountMinor: 4500,
      currency: 'chf',
      participantMemberIds: ['a', 'b', 'c'],
      completedByUserId: 'user-a',
    });

    expect(result.kind).toBe('expense');
    const expenses = await repos.expenses.getByHousehold(HH);
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amountMinor).toBe(4500);
    expect(expenses[0].currency).toBe('CHF');
    expect(await repos.contributions.getByHousehold(HH)).toHaveLength(0);
    expect((await repos.todos.getById(todo.id))?.status).toBe('completed');

    const balances = calculateFinancialBalancesByCurrency(expenses, [], MEMBERS);
    expect(financialLedgerIsZeroSum(balances.get('CHF')!)).toBe(true);
  });

  test('a custom expense split built from the form shares is persisted exactly', async () => {
    const repos = createInMemoryRepositories();
    const todo = await seedTodo(repos, expenseTodo());

    const customShares = expenseSharesFromRaw(MEMBERS, {
      a: '25.00',
      b: '10.00',
      c: '10.00',
    });
    expect(customShares).not.toBeNull();
    expect(customShares!.reduce((sum, share) => sum + share.amountMinor, 0)).toBe(4500);

    await completeTodoAtomic(repos, {
      todo,
      household: household(),
      paidByMemberId: 'a',
      amountMinor: 4500,
      currency: 'CHF',
      participantMemberIds: MEMBERS,
      completedByUserId: 'user-a',
      customShares: customShares!,
    });

    const expenses = await repos.expenses.getByHousehold(HH);
    expect(expenses).toHaveLength(1);
    expect(expenses[0].splitMode).toBe('custom');
    expect(expenses[0].customShares).toEqual(customShares);
  });

  test('a custom task split built from the form weights is snapshotted exactly', async () => {
    const repos = createInMemoryRepositories();
    const todo = await seedTodo(repos, taskTodo());

    const weights = taskWeightsFromRaw(['a', 'b'], { a: '1', b: '3' });
    expect(weights).not.toBeNull();

    await completeTodoAtomic(repos, {
      todo,
      household: household(),
      performerMemberId: 'a',
      value: 40,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
      overrideSplitWeights: weights!,
    });

    const entries = await repos.contributions.getByHousehold(HH);
    expect(entries).toHaveLength(1);
    expect(entries[0].splitMode).toBe('custom');
    expect(entries[0].splitWeights).toEqual(weights);
  });

  test('an optional note and photo are carried onto the created entry', async () => {
    const repos = createInMemoryRepositories();
    const todo = await seedTodo(repos, taskTodo());
    const attachment = createAttachment({
      id: 'att-v4-06',
      kind: 'photo',
      ref: 'file:///cache/photo-v4-06.jpg',
      mimeType: 'image/jpeg',
      byteSize: 2048,
      createdAt: '2026-09-20T10:00:00.000Z',
    });

    await completeTodoAtomic(repos, {
      todo,
      household: household(),
      performerMemberId: 'a',
      value: 15,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
      note: '  fait après le dîner  ',
      attachments: [attachment],
    });

    const entries = await repos.contributions.getByHousehold(HH);
    expect(entries).toHaveLength(1);
    expect(entries[0].note).toBe('fait après le dîner');
    expect(entries[0].attachments).toHaveLength(1);
    expect(entries[0].attachments![0].ref).toBe('file:///cache/photo-v4-06.jpg');
  });
});

// ── Offline atomicity ──────────────────────────────────────────

describe('V4-06 À faire — offline atomicity', () => {
  test('a failed expense write rolls back the todo and a retry yields one entry', async () => {
    const repos = createInMemoryRepositories();
    const todo = await seedTodo(repos, expenseTodo());
    const input = {
      todo,
      household: household(),
      paidByMemberId: 'a',
      amountMinor: 4500,
      currency: 'CHF',
      participantMemberIds: MEMBERS,
      completedByUserId: 'user-a',
    };

    const spy = jest
      .spyOn(repos.expenses, 'create')
      .mockRejectedValueOnce(new Error('offline'));
    await expect(completeTodoAtomic(repos, input)).rejects.toThrow('offline');
    spy.mockRestore();

    // Nothing leaked: no entry, todo still open (retryable).
    expect(await repos.expenses.getByHousehold(HH)).toHaveLength(0);
    expect((await repos.todos.getById(todo.id))?.status).toBe('todo');

    await completeTodoAtomic(repos, input);

    expect(await repos.expenses.getByHousehold(HH)).toHaveLength(1);
    expect((await repos.todos.getById(todo.id))?.status).toBe('completed');
  });

  test('after a successful completion the persisted todo is completed and re-completing throws', async () => {
    const repos = createInMemoryRepositories();
    const todo = await seedTodo(repos, taskTodo());
    const input = {
      todo,
      household: household(),
      performerMemberId: 'a',
      value: 15,
      beneficiaryMemberIds: ['a', 'b'],
      completedByUserId: 'user-a',
    };

    await completeTodoAtomic(repos, input);

    // The UI reloads the todo before any further action; passing the refreshed
    // completed snapshot is rejected instead of silently writing a second entry.
    const fresh = await repos.todos.getById(todo.id);
    expect(fresh?.status).toBe('completed');
    await expect(completeTodoAtomic(repos, { ...input, todo: fresh! })).rejects.toThrow(
      'already completed',
    );

    expect(await repos.contributions.getByHousehold(HH)).toHaveLength(1);
  });
});
