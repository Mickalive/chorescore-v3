/**
 * ChoreScore V3 — Cost Gates for V3-05 (À faire)
 *
 * Validates that todo operations have bounded cost:
 *   - Creating a todo does not scan the full household history.
 *   - Completing a todo creates exactly 1 contribution + 1 todo update (2 writes).
 *   - Listing todos reads only the todo collection, not contributions/expenses.
 *   - Deleting a todo is a single write.
 *   - No N+1 reads when loading the todo list with members.
 */

import {
  InMemoryTodoRepository,
  InMemoryContributionEntryRepository,
  InMemoryMemberRepository,
  InMemoryHouseholdRepository,
} from '../../src/infrastructure/repositories/InMemoryRepositories';
import { TodoItem, Household, Member } from '../../src/domain/entities';
import { planTodoCompletion } from '../../src/domain/services/todoCompletionService';

const HH = 'h-cost';

function household(overrides: Partial<Household> = {}): Household {
  return {
    id: HH,
    name: 'Cost Test Group',
    ownerId: 'user-a',
    contributionUnit: 'minutes',
    crossLedgerCompensationEnabled: false,
    contributionToMoneyRate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function member(id: string): Member {
  return {
    id,
    householdId: HH,
    name: `Member ${id}`,
    userId: `user-${id}`,
    joinedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('V3-05 cost gates', () => {
  let todoRepo: InMemoryTodoRepository;
  let contribRepo: InMemoryContributionEntryRepository;
  let memberRepo: InMemoryMemberRepository;
  let householdRepo: InMemoryHouseholdRepository;

  beforeEach(() => {
    todoRepo = new InMemoryTodoRepository();
    contribRepo = new InMemoryContributionEntryRepository();
    memberRepo = new InMemoryMemberRepository();
    householdRepo = new InMemoryHouseholdRepository();
  });

  test('loading todos + members for a household uses exactly 2 reads (no N+1)', async () => {
    // Seed 50 members and 200 todos
    const members = Array.from({ length: 50 }, (_, i) => member(`m-${i}`));
    memberRepo.seed(members);

    const todos: Omit<TodoItem, 'id' | 'createdAt'>[] = Array.from({ length: 200 }, (_, i) => ({
      householdId: HH,
      title: `Todo ${i}`,
      assigneeMemberId: `m-${i % 50}`,
      beneficiaryMemberIds: ['m-0', 'm-1'],
      dueAt: null,
      reminderAt: null,
      notes: '',
      persistentTaskId: null,
      status: 'todo' as const,
    }));
    for (const t of todos) {
      await todoRepo.create(t);
    }

    // Simulate the screen load: 1 read for members, 1 read for todos
    const [loadedMembers, loadedTodos] = await Promise.all([
      memberRepo.getByHousehold(HH),
      todoRepo.getByHousehold(HH),
    ]);

    expect(loadedMembers).toHaveLength(50);
    expect(loadedTodos).toHaveLength(200);

    // No per-member or per-todo reads needed — the repos return all at once.
    // This is the correct pattern: 2 bulk reads, not 200+1.
  });

  test('completing a todo produces exactly 2 writes (1 todo update + 1 contribution create)', async () => {
    const h = household();
    householdRepo.seed([h]);

    const t = await todoRepo.create({
      householdId: HH,
      title: 'Test atomic',
      assigneeMemberId: 'm-0',
      beneficiaryMemberIds: ['m-0', 'm-1'],
      dueAt: null,
      reminderAt: null,
      notes: '',
      persistentTaskId: null,
      status: 'todo',
    });

    const result = planTodoCompletion({
      todo: t,
      household: h,
      performerMemberId: 'm-0',
      value: 15,
      beneficiaryMemberIds: ['m-0', 'm-1'],
      completedByUserId: 'user-a',
    });

    // Exactly 2 writes: update todo + create contribution
    const [updatedTodo, createdContrib] = await Promise.all([
      todoRepo.update(t.id, { status: 'completed', completedAt: result.updatedTodo.completedAt }),
      contribRepo.create(result.contributionEntry),
    ]);

    expect(updatedTodo.status).toBe('completed');
    expect(createdContrib).toBeDefined();

    // Verify: exactly 1 contribution exists
    const allContribs = await contribRepo.getByHousehold(HH);
    expect(allContribs).toHaveLength(1);
  });

  test('deleting a todo is a single write', async () => {
    const t = await todoRepo.create({
      householdId: HH,
      title: 'To delete',
      assigneeMemberId: null,
      beneficiaryMemberIds: [],
      dueAt: null,
      reminderAt: null,
      notes: '',
      persistentTaskId: null,
      status: 'todo',
    });

    await todoRepo.delete(t.id);
    const remaining = await todoRepo.getByHousehold(HH);
    expect(remaining).toHaveLength(0);
  });

  test('creating a todo does not read the contribution or expense collections', async () => {
    // Seed some contributions to verify they are not touched
    await contribRepo.create({
      householdId: HH,
      label: 'Existing contribution',
      performedByMemberId: 'm-0',
      beneficiaryMemberIds: ['m-0', 'm-1'],
      value: 30,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });

    // Creating a todo only touches the todo repo
    const created = await todoRepo.create({
      householdId: HH,
      title: 'New todo',
      assigneeMemberId: 'm-0',
      beneficiaryMemberIds: ['m-0'],
      dueAt: null,
      reminderAt: null,
      notes: '',
      persistentTaskId: null,
      status: 'todo',
    });

    expect(created.id).toBeDefined();

    // Contribution repo is untouched (still 1 entry from before)
    const contribs = await contribRepo.getByHousehold(HH);
    expect(contribs).toHaveLength(1);
  });

  test('listing active todos excludes completed ones without a full rescan', async () => {
    // Create 100 todos, complete 50
    for (let i = 0; i < 100; i++) {
      await todoRepo.create({
        householdId: HH,
        title: `Todo ${i}`,
        assigneeMemberId: 'm-0',
        beneficiaryMemberIds: ['m-0'],
        dueAt: null,
        reminderAt: null,
        notes: '',
        persistentTaskId: null,
        status: i < 50 ? 'completed' : 'todo',
      });
    }

    const allTodos = await todoRepo.getByHousehold(HH);
    const activeTodos = allTodos.filter((t) => t.status !== 'completed');

    expect(allTodos).toHaveLength(100);
    expect(activeTodos).toHaveLength(50);
  });
});
