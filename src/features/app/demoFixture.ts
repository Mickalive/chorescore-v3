/**
 * ChoreScore V3 — Demo fixture
 *
 * Seeds the canonical demo household and demo users under stable ids so the
 * demo sign-in always converges to the same state, in both the in-memory and
 * SQLite repository implementations. Idempotent: repeated sign-ins never
 * duplicate the demo user, the household or its memberships.
 *
 * The fixture is a pure function of the repositories so it can be tested
 * directly without React rendering infrastructure.
 */

import { AllRepositories } from '../../infrastructure/repositories/RepositoryFactory';
import { AuthUser } from '../../application/ports';
import { Household } from '../../domain/entities';

export const DEMO_HOUSEHOLD_ID = 'h-core';
export const DEMO_ALEX_MEMBER_ID = 'm-alex';
export const DEMO_SAM_MEMBER_ID = 'm-sam';
export const DEMO_SAM_USER_ID = 'demo-user-sam';

export async function ensureDemoFixture(repos: AllRepositories, demoUser: AuthUser): Promise<void> {
  const nowIso = new Date().toISOString();

  // Canonical demo users — idempotent upsert (no duplicates on repeated sign-in).
  await repos.users.seed([
    { id: demoUser.userId, email: demoUser.email, displayName: 'Alex', createdAt: nowIso },
    { id: DEMO_SAM_USER_ID, email: 'sam.demo@chorescore.app', displayName: 'Sam', createdAt: nowIso },
  ]);

  // Canonical demo household under DEMO_HOUSEHOLD_ID.
  await repos.households.seed([
    {
      id: DEMO_HOUSEHOLD_ID,
      name: 'Appartement',
      ownerId: demoUser.userId,
      contributionUnit: 'minutes',
      crossLedgerCompensationEnabled: false,
      contributionToMoneyRate: null,
      createdAt: nowIso,
    },
  ]);

  // Memberships referencing the canonical household id.
  await repos.memberships.seed([
    {
      id: 'membership-demo-alex',
      userId: demoUser.userId,
      householdId: DEMO_HOUSEHOLD_ID,
      role: 'OWNER',
      joinedAt: nowIso,
    },
    {
      id: 'membership-demo-sam',
      userId: DEMO_SAM_USER_ID,
      householdId: DEMO_HOUSEHOLD_ID,
      role: 'MEMBER',
      joinedAt: nowIso,
    },
  ]);

  // Members.
  await repos.members.seed([
    {
      id: DEMO_ALEX_MEMBER_ID,
      householdId: DEMO_HOUSEHOLD_ID,
      name: 'Alex',
      userId: demoUser.userId,
      joinedAt: nowIso,
    },
    {
      id: DEMO_SAM_MEMBER_ID,
      householdId: DEMO_HOUSEHOLD_ID,
      name: 'Sam',
      userId: DEMO_SAM_USER_ID,
      joinedAt: nowIso,
    },
  ]);

  // Persistent task (create-if-missing).
  const tasks = await repos.tasks.getByHousehold(DEMO_HOUSEHOLD_ID);
  let dishesTask = tasks.find((t) => t.name === 'Vaisselle');
  if (!dishesTask) {
    dishesTask = await repos.tasks.create({
      householdId: DEMO_HOUSEHOLD_ID,
      name: 'Vaisselle',
      defaultValue: 15,
      defaultUnit: 'minutes',
    });
  }

  // Contribution entries (create-if-missing).
  const entries = await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID);
  if (!entries.some((e) => e.label === 'Vaisselle du soir')) {
    await repos.contributions.create({
      householdId: DEMO_HOUSEHOLD_ID,
      label: 'Vaisselle du soir',
      performedByMemberId: DEMO_ALEX_MEMBER_ID,
      beneficiaryMemberIds: [DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID],
      value: 15,
      unit: 'minutes',
      persistentTaskId: dishesTask.id,
      occurredAt: new Date(Date.now() - 2 * 86400000).toISOString(),
      createdBy: demoUser.userId,
    });
  }
  if (!entries.some((e) => e.label === 'Courses Migros')) {
    await repos.contributions.create({
      householdId: DEMO_HOUSEHOLD_ID,
      label: 'Courses Migros',
      performedByMemberId: DEMO_SAM_MEMBER_ID,
      beneficiaryMemberIds: [DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID],
      value: 45,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: new Date(Date.now() - 1 * 86400000).toISOString(),
      createdBy: DEMO_SAM_USER_ID,
    });
  }

  // Todo (create-if-missing).
  const todos = await repos.todos.getByHousehold(DEMO_HOUSEHOLD_ID);
  if (!todos.some((t) => t.title === 'Sortir les poubelles')) {
    await repos.todos.create({
      householdId: DEMO_HOUSEHOLD_ID,
      title: 'Sortir les poubelles',
      assigneeMemberId: DEMO_SAM_MEMBER_ID,
      beneficiaryMemberIds: [DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID],
      dueAt: null,
      reminderAt: null,
      notes: '',
      persistentTaskId: null,
      status: 'todo',
    });
  }
}

/**
 * Resolve the households a user belongs to from their memberships.
 * Local-only: reads the indexed local store, never a remote fetch.
 */
export async function loadHouseholdsForUser(repos: AllRepositories, userId: string): Promise<Household[]> {
  const memberships = await repos.memberships.getByUser(userId);
  const loaded: Household[] = [];
  for (const m of memberships) {
    const h = await repos.households.getById(m.householdId);
    if (h) loaded.push(h);
  }
  return loaded;
}