/**
 * ChoreScore V3 — Atomic Todo Completion Use-Case
 *
 * Executes the completion of a todo as ONE atomic operation:
 * the todo status update and the ContributionEntry creation are written
 * inside a single storage-level transaction. If either write fails, the
 * whole operation rolls back: no orphan ContributionEntry, no silently
 * completed todo without a ledger entry, and a retry can never produce a
 * second ContributionEntry.
 *
 * Backend frugal §7: "Les changements couplés doivent employer
 * batch/transaction/opération métier atomique."
 */

import { AllRepositories } from '../../infrastructure/repositories/RepositoryFactory';
import {
  CompletionInput,
  CompletionOutput,
  planTodoCompletion,
} from '../../domain/services/todoCompletionService';

/**
 * Complete a todo atomically.
 *
 * The domain planning (`planTodoCompletion`) validates the input and
 * computes the pair (updated todo + contribution entry). The persistence
 * then runs inside `repos.withTransaction` so both writes commit together
 * or neither does.
 *
 * @throws if the todo is already completed, validation fails, or either
 *         write fails (in which case the transaction rolls back).
 */
export async function completeTodoAtomic(
  repos: AllRepositories,
  input: CompletionInput
): Promise<CompletionOutput> {
  const result = planTodoCompletion(input);

  await repos.withTransaction(async () => {
    await repos.todos.update(input.todo.id, {
      status: 'completed',
      completedAt: result.updatedTodo.completedAt,
    });
    await repos.contributions.create(result.contributionEntry);
  });

  return result;
}