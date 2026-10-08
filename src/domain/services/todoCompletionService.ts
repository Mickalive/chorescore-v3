/**
 * ChoreScore V4 — Todo Completion Service
 *
 * Handles the atomic transition: TodoItem → exactly one ledger entry.
 *
 * Two todo kinds, one invariant each:
 *   - kind 'task'    → exactly ONE ContributionEntry (V3 behaviour, unchanged);
 *   - kind 'expense' → exactly ONE ExpenseEntry (integer minor units).
 *
 * Shared invariants:
 *   - The todo status is set to 'completed' with a completedAt timestamp.
 *   - Both writes happen in a single logical transaction (see the use-case).
 *   - A kind/input mismatch is an error, never a silent conversion.
 *   - No chrono, no premium gating, no data destruction.
 *
 * Overloads keep the V3 task contract exact: task callers keep receiving a
 * `contributionEntry`, expense callers receive an `expenseEntry`.
 */

import {
  TodoItem,
  TodoKind,
  Attachment,
  Category,
  ContributionEntry,
  ContributionUnit,
  ExpenseEntry,
  ExpenseParticipantShare,
  Household,
  TaskSplitWeight,
} from '../entities';
import { normalizeCurrency } from '../calculations/validation';
import { allocateExpense } from '../calculations/expenseLedger';
import { createAttachment, normalizeNote } from './attachmentService';
import { resolveTaskSplitForNewEntry } from './categoryService';

// ── Shared helpers ─────────────────────────────────────────────

function todoKindOf(todo: TodoItem): TodoKind {
  return todo.kind ?? 'task';
}

function requireActiveTodo(todo: TodoItem, household: Household): void {
  if (todo.status === 'completed') {
    throw new Error('Todo is already completed');
  }
  if (!todo.householdId || todo.householdId !== household.id) {
    throw new Error('Todo does not belong to this household');
  }
}

function completedTodoPatch(
  todo: TodoItem,
  nowIso: string
): Omit<TodoItem, 'id' | 'createdAt'> {
  return {
    householdId: todo.householdId,
    title: todo.title,
    assigneeMemberId: todo.assigneeMemberId,
    beneficiaryMemberIds: [...todo.beneficiaryMemberIds],
    dueAt: todo.dueAt,
    reminderAt: todo.reminderAt,
    notes: todo.notes,
    persistentTaskId: todo.persistentTaskId,
    status: 'completed',
    completedAt: nowIso,
    kind: todoKindOf(todo),
    categoryId: todo.categoryId ?? null,
    ...(todo.kind === 'expense'
      ? {
          expenseAmountMinor: todo.expenseAmountMinor,
          expenseCurrency: todo.expenseCurrency,
        }
      : {}),
  };
}

/**
 * Validate and copy optional photo attachments for a ledger entry.
 * Empty input stays `undefined` so a V3-shaped entry keeps its original
 * shape; every reference goes through `createAttachment` (provider-agnostic
 * validation) before it can reach a ledger write.
 */
function normalizeAttachments(attachments?: Attachment[]): Attachment[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  return attachments.map((attachment) => createAttachment(attachment));
}

// ── Task completion (V3 contract preserved) ────────────────────
export interface CompletionInput {
  todo: TodoItem;
  household: Household;
  performerMemberId: string;
  value: number;
  beneficiaryMemberIds: string[];
  completedByUserId: string;
  categoryId?: string | null;
  categoryLabelSnapshot?: string;
  note?: string;
  /** Optional photo attachments (opaque, provider-agnostic references). */
  attachments?: Attachment[];
  /**
   * V4-01: the category's current default ratio (looked up by the caller).
   * Used only when the input carries no explicit override; the resolved ratio
   * is snapshotted onto the entry, so later category edits never rewrite it.
   */
  category?: Pick<Category, 'defaultTaskRatio'> | null;
  /** Explicit group/user override; wins over the category default ratio. */
  overrideSplitWeights?: TaskSplitWeight[] | null;
}

export interface TaskCompletionOutput {
  kind: 'task';
  updatedTodo: Omit<TodoItem, 'id' | 'createdAt'>;
  contributionEntry: Omit<ContributionEntry, 'id'>;
}

/** Back-compat aliases (V3 names for the task path). */
export type CompletionOutput = TaskCompletionOutput;

function planTaskCompletion(input: CompletionInput): TaskCompletionOutput {
  const {
    todo,
    household,
    performerMemberId,
    value,
    beneficiaryMemberIds,
    completedByUserId,
  } = input;

  requireActiveTodo(todo, household);

  if (todoKindOf(todo) !== 'task') {
    throw new Error('Task completion input requires a todo of kind task');
  }
  if (value <= 0 || !Number.isFinite(value)) {
    throw new Error('Completion value must be a positive finite number');
  }
  if (beneficiaryMemberIds.length === 0) {
    throw new Error('At least one beneficiary is required');
  }
  if (!performerMemberId) {
    throw new Error('Performer is required');
  }

  // V4-01: resolve the split (explicit override > category default > equal)
  // and snapshot it onto the entry. A ratio that does not cover every
  // beneficiary fails here, before anything is written.
  const split = resolveTaskSplitForNewEntry({
    category: input.category ?? null,
    overrideWeights: input.overrideSplitWeights ?? null,
    beneficiaryMemberIds,
  });

  const nowIso = new Date().toISOString();

  const contributionEntry: Omit<ContributionEntry, 'id'> = {
    householdId: todo.householdId,
    label: todo.title,
    performedByMemberId: performerMemberId,
    beneficiaryMemberIds,
    value,
    unit: household.contributionUnit,
    persistentTaskId: todo.persistentTaskId,
    occurredAt: nowIso,
    createdBy: completedByUserId,
    categoryId: input.categoryId ?? todo.categoryId ?? null,
  };
  if (input.categoryLabelSnapshot !== undefined) {
    contributionEntry.categoryLabelSnapshot = input.categoryLabelSnapshot;
  }
  // Optional note/photo: validated and bounded here, absent stays absent so
  // a plain V3-shaped completion keeps the exact baseline entry shape.
  const note = normalizeNote(input.note);
  if (note !== undefined) contributionEntry.note = note;
  const attachments = normalizeAttachments(input.attachments);
  if (attachments !== undefined) contributionEntry.attachments = attachments;
  if (split.splitMode === 'custom' && split.splitWeights) {
    contributionEntry.splitMode = 'custom';
    contributionEntry.splitWeights = split.splitWeights;
    contributionEntry.splitSource = split.splitSource;
  }

  return {
    kind: 'task',
    updatedTodo: completedTodoPatch(todo, nowIso),
    contributionEntry,
  };
}

// ── Expense completion ─────────────────────────────────────────

export interface ExpenseCompletionInput {
  todo: TodoItem;
  household: Household;
  paidByMemberId: string;
  amountMinor: number;
  currency: string;
  participantMemberIds: string[];
  completedByUserId: string;
  categoryId?: string | null;
  categoryLabelSnapshot?: string;
  note?: string;
  /** Optional photo attachments (opaque, provider-agnostic references). */
  attachments?: Attachment[];
  /**
   * V4-01: optional exact custom split (integer minor units, one share per
   * participant, total equal to `amountMinor`). Validated here so a bad split
   * fails before the transaction instead of at the first balance replay.
   */
  customShares?: ExpenseParticipantShare[];
}

export interface ExpenseCompletionOutput {
  kind: 'expense';
  updatedTodo: Omit<TodoItem, 'id' | 'createdAt'>;
  expenseEntry: Omit<ExpenseEntry, 'id'>;
}

function planExpenseCompletion(input: ExpenseCompletionInput): ExpenseCompletionOutput {
  const {
    todo,
    household,
    paidByMemberId,
    amountMinor,
    currency,
    participantMemberIds,
    completedByUserId,
  } = input;

  requireActiveTodo(todo, household);

  if (todoKindOf(todo) !== 'expense') {
    throw new Error('Expense completion input requires a todo of kind expense');
  }
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new Error(`Expense amount must be a positive integer in minor units, got ${amountMinor}`);
  }
  if (!paidByMemberId) {
    throw new Error('Payer is required');
  }
  if (participantMemberIds.length === 0) {
    throw new Error('At least one participant is required');
  }
  if (new Set(participantMemberIds).size !== participantMemberIds.length) {
    throw new Error('Expense participants must be unique');
  }
  const normalizedCurrency = normalizeCurrency(currency);

  const nowIso = new Date().toISOString();
  // Explicit completion note wins, otherwise carry the todo's note along
  // (already stored data is carried verbatim, only new input is validated).
  const note = normalizeNote(input.note) ?? (todo.notes.trim().length > 0 ? todo.notes.trim() : undefined);

  const expenseEntry: Omit<ExpenseEntry, 'id'> = {
    householdId: todo.householdId,
    title: todo.title,
    amountMinor,
    currency: normalizedCurrency,
    paidByMemberId,
    participantMemberIds,
    splitMode: 'equal',
    occurredAt: nowIso,
    createdBy: completedByUserId,
    categoryId: input.categoryId ?? todo.categoryId ?? null,
  };
  if (note !== undefined) expenseEntry.note = note;
  const attachments = normalizeAttachments(input.attachments);
  if (attachments !== undefined) expenseEntry.attachments = attachments;
  if (input.categoryLabelSnapshot !== undefined) {
    expenseEntry.categoryLabelSnapshot = input.categoryLabelSnapshot;
  }
  if (input.customShares && input.customShares.length > 0) {
    expenseEntry.splitMode = 'custom';
    expenseEntry.customShares = input.customShares.map((share) => ({ ...share }));
    // Validate the exact split against the real allocation rules before the
    // transaction: one integer share per participant, total == amountMinor.
    allocateExpense({ ...expenseEntry, id: todo.id });
  }

  return {
    kind: 'expense',
    updatedTodo: completedTodoPatch(todo, nowIso),
    expenseEntry,
  };
}

// ── Public API (overloaded: the kind decides the output shape) ─

export function planTodoCompletion(input: CompletionInput): TaskCompletionOutput;
export function planTodoCompletion(input: ExpenseCompletionInput): ExpenseCompletionOutput;
export function planTodoCompletion(
  input: CompletionInput | ExpenseCompletionInput
): TaskCompletionOutput | ExpenseCompletionOutput;
export function planTodoCompletion(
  input: CompletionInput | ExpenseCompletionInput
): TaskCompletionOutput | ExpenseCompletionOutput {
  const kind = todoKindOf(input.todo);

  // V4-01: detect a kind/input mismatch BEFORE any field validation. Routing
  // alone follows the todo kind, so without this check an expense payload sent
  // for a task todo would fail on `value` with a misleading message (and the
  // reverse would fail on `paidByMemberId`), instead of naming the mismatch.
  const expenseShaped =
    ('amountMinor' in input && input.amountMinor !== undefined) ||
    ('paidByMemberId' in input && input.paidByMemberId !== undefined);
  const taskShaped =
    ('value' in input && input.value !== undefined) ||
    ('performerMemberId' in input && input.performerMemberId !== undefined);

  if (expenseShaped && !taskShaped && kind !== 'expense') {
    throw new Error('Expense completion input requires a todo of kind expense');
  }
  if (taskShaped && !expenseShaped && kind === 'expense') {
    throw new Error('Task completion input requires a todo of kind task');
  }

  if (kind === 'expense') {
    return planExpenseCompletion(input as ExpenseCompletionInput);
  }
  return planTaskCompletion(input as CompletionInput);
}
