/**
 * ChoreScore V3 — Todo Completion Service
 *
 * Handles the atomic transition: TodoItem → ContributionEntry.
 *
 * Invariants:
 *   - Exactly ONE ContributionEntry is created per completion.
 *   - The ContributionEntry uses the household's current unit.
 *   - The todo status is set to 'completed' with a completedAt timestamp.
 *   - Both writes happen in a single logical transaction.
 *   - No chrono, no premium gating, no data destruction.
 */

import { TodoItem, ContributionEntry, ContributionUnit, Household } from '../entities';

export interface CompletionInput {
  todo: TodoItem;
  household: Household;
  performerMemberId: string;
  value: number;
  beneficiaryMemberIds: string[];
  completedByUserId: string;
}

export interface CompletionOutput {
  updatedTodo: Omit<TodoItem, 'id' | 'createdAt'>;
  contributionEntry: Omit<ContributionEntry, 'id'>;
}

/**
 * Validate and compute the atomic pair (updated todo + new contribution)
 * without persisting. The caller is responsible for executing both writes
 * in a single transaction.
 */
export function planTodoCompletion(input: CompletionInput): CompletionOutput {
  const { todo, household, performerMemberId, value, beneficiaryMemberIds, completedByUserId } = input;

  if (todo.status === 'completed') {
    throw new Error('Todo is already completed');
  }

  if (!todo.householdId || todo.householdId !== household.id) {
    throw new Error('Todo does not belong to this household');
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

  const nowIso = new Date().toISOString();

  const updatedTodo: Omit<TodoItem, 'id' | 'createdAt'> = {
    householdId: todo.householdId,
    title: todo.title,
    assigneeMemberId: todo.assigneeMemberId,
    beneficiaryMemberIds: todo.beneficiaryMemberIds,
    dueAt: todo.dueAt,
    reminderAt: todo.reminderAt,
    notes: todo.notes,
    persistentTaskId: todo.persistentTaskId,
    status: 'completed',
    completedAt: nowIso,
  };

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
  };

  return { updatedTodo, contributionEntry };
}
