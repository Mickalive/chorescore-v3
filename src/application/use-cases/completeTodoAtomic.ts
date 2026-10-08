/**
 * ChoreScore V4 — Atomic Todo Completion Use-Case
 *
 * Executes the completion of a todo as ONE atomic operation:
 * the todo status update and exactly ONE ledger entry are written inside a
 * single storage-level transaction. If any write fails, the whole operation
 * rolls back: no orphan ledger entry, no silently completed todo without an
 * entry, and a retry can never produce a second entry.
 *
 *   kind 'task'    → todos.update + contributions.create  (V3, unchanged)
 *   kind 'expense' → todos.update + expenses.create
 *
 * Backend frugal §7: "Les changements couplés doivent employer
 * batch/transaction/opération métier atomique."
 */

import { AllRepositories } from '../../infrastructure/repositories/RepositoryFactory';
import {
  CompletionInput,
  CompletionOutput,
  ExpenseCompletionInput,
  ExpenseCompletionOutput,
  planTodoCompletion,
} from '../../domain/services/todoCompletionService';

async function persistTaskCompletion(
  repos: AllRepositories,
  input: CompletionInput,
  result: CompletionOutput
): Promise<void> {
  await repos.withTransaction(async () => {
    await repos.todos.update(input.todo.id, {
      status: 'completed',
      completedAt: result.updatedTodo.completedAt,
    });
    await repos.contributions.create(result.contributionEntry);
  });
}

async function persistExpenseCompletion(
  repos: AllRepositories,
  input: ExpenseCompletionInput,
  result: ExpenseCompletionOutput
): Promise<void> {
  await repos.withTransaction(async () => {
    await repos.todos.update(input.todo.id, {
      status: 'completed',
      completedAt: result.updatedTodo.completedAt,
    });
    await repos.expenses.create(result.expenseEntry);
  });
}

/**
 * Complete a todo atomically.
 *
 * The domain planning (`planTodoCompletion`) validates the input and
 * computes the pair (updated todo + ledger entry). The persistence then
 * runs inside `repos.withTransaction` so both writes commit together
 * or neither does.
 *
 * @throws if the todo is already completed, validation fails, or a write
 *         fails (in which case the transaction rolls back).
 */
export async function completeTodoAtomic(
  repos: AllRepositories,
  input: CompletionInput
): Promise<CompletionOutput>;
export async function completeTodoAtomic(
  repos: AllRepositories,
  input: ExpenseCompletionInput
): Promise<ExpenseCompletionOutput>;
export async function completeTodoAtomic(
  repos: AllRepositories,
  input: CompletionInput | ExpenseCompletionInput
): Promise<CompletionOutput | ExpenseCompletionOutput>;
export async function completeTodoAtomic(
  repos: AllRepositories,
  input: CompletionInput | ExpenseCompletionInput
): Promise<CompletionOutput | ExpenseCompletionOutput> {
  const result = planTodoCompletion(input);

  if (result.kind === 'expense') {
    await persistExpenseCompletion(repos, input as ExpenseCompletionInput, result);
    return result;
  }

  await persistTaskCompletion(repos, input as CompletionInput, result);
  return result;
}
