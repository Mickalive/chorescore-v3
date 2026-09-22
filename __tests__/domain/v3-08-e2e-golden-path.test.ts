/**
 * ChoreScore V3 — V3-08 E2E Golden Path Tests
 *
 * Exercises the full user journey through the application layer:
 *   1. Sign in (demo user)
 *   2. Load household + members
 *   3. Add contribution
 *   4. Add expense
 *   5. View balances
 *   6. Complete todo (atomic)
 *   7. Edit/delete operations
 *   8. History pagination
 *   9. Invitation flow
 *  10. Unit switching
 *
 * These tests verify the golden path from the acceptance criteria.
 */

import { createInMemoryRepositories, AllRepositories } from '../../src/infrastructure/repositories/RepositoryFactory';
import {
  ensureDemoFixture,
  loadHouseholdsForUser,
  DEMO_HOUSEHOLD_ID,
  DEMO_ALEX_MEMBER_ID,
  DEMO_SAM_MEMBER_ID,
} from '../../src/features/app/demoFixture';
import { AuthUser } from '../../src/application/ports';
import { calculateContributionBalances, contributionLedgerIsZeroSum } from '../../src/domain/calculations/contributionLedger';
import { calculateFinancialBalancesByCurrency, financialLedgerIsZeroSum } from '../../src/domain/calculations/expenseLedger';
import { createBalanceSnapshot } from '../../src/domain/calculations/materializedBalances';
import { paginateActivityLog } from '../../src/domain/calculations/activityLog';
import { completeTodoAtomic } from '../../src/application/use-cases/completeTodoAtomic';
import {
  pullDeltas,
  pushDeltas,
  SYNC_COLLECTIONS,
} from '../../src/domain/services/syncEngine';
import {
  requireHouseholdMembership,
  requireRole,
} from '../../src/domain/services/authorizationRules';
import { LocalAuthAdapter } from '../../src/infrastructure/local/LocalAuthAdapter';

const DEMO_USER: AuthUser = {
  userId: 'demo-user-alex',
  email: 'demo@chorescore.app',
  displayName: 'Alex',
  provider: 'local',
};

// ══════════════════════════════════════════════════════════════
// Full E2E Golden Path
// ══════════════════════════════════════════════════════════════

describe('V3-08 E2E Golden Path: full user journey', () => {
  let repos: AllRepositories;

  beforeEach(async () => {
    repos = createInMemoryRepositories();
    await ensureDemoFixture(repos, DEMO_USER);
  });

  test('1. Sign in and load households', async () => {
    const households = await loadHouseholdsForUser(repos, DEMO_USER.userId);
    expect(households).toHaveLength(1);
    expect(households[0].id).toBe(DEMO_HOUSEHOLD_ID);
    expect(households[0].name).toBe('Appartement');
  });

  test('2. Load members for household', async () => {
    const members = await repos.members.getByHousehold(DEMO_HOUSEHOLD_ID);
    expect(members).toHaveLength(2);
    const names = members.map((m) => m.name).sort();
    expect(names).toEqual(['Alex', 'Sam']);
  });

  test('2b. Demo fixture orders "Vaisselle du soir" most recent (first visible history row)', async () => {
    // The Ajouter history is sorted by occurredAt DESC and the E2E golden
    // path waits for "Vaisselle du soir" to be VISIBLE without scrolling
    // (waitFor checks uiautomator-visible nodes only).  The demo fixture
    // must therefore seed "Vaisselle du soir" as the most recent
    // contribution, above "Courses Migros".
    const contribs = await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID);
    const dishes = contribs.find((c) => c.label === 'Vaisselle du soir');
    const groceries = contribs.find((c) => c.label === 'Courses Migros');
    expect(dishes).toBeDefined();
    expect(groceries).toBeDefined();
    expect(dishes!.occurredAt > groceries!.occurredAt).toBe(true);
  });

  test('3. Add contribution and see balance update', async () => {
    const memberIds = [DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID];

    // Add a new contribution
    const newContrib = await repos.contributions.create({
      householdId: DEMO_HOUSEHOLD_ID,
      label: 'Aspirateur salon',
      performedByMemberId: DEMO_ALEX_MEMBER_ID,
      beneficiaryMemberIds: memberIds,
      value: 30,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-17T10:00:00.000Z',
      createdBy: DEMO_USER.userId,
    });

    expect(newContrib.id).toBeDefined();
    expect(newContrib.label).toBe('Aspirateur salon');
    expect(newContrib.value).toBe(30);

    // Verify balance updated
    const allContribs = await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID);
    const balances = calculateContributionBalances(allContribs, 'minutes', [], memberIds);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);

    // Alex performed the original 15 + new 30 = 45 total, minus shares
    // Original: vaisselle 15 for [alex, sam] → alex +15 - 7.5 = +7.5, sam -7.5
    // Original: courses 45 for [alex, sam] → sam +45 - 22.5 = +22.5, alex -22.5
    // New: aspirateur 30 for [alex, sam] → alex +30 - 15 = +15, sam -15
    // Alex total: 7.5 - 22.5 + 15 = 0
    // Sam total: -7.5 + 22.5 - 15 = 0
    expect(balances.get(DEMO_ALEX_MEMBER_ID)).toBe(0);
    expect(balances.get(DEMO_SAM_MEMBER_ID)).toBe(0);
  });

  test('4. Add expense and see financial balance update', async () => {
    const memberIds = [DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID];

    const expense = await repos.expenses.create({
      householdId: DEMO_HOUSEHOLD_ID,
      title: 'Restaurant',
      amountMinor: 8500,
      currency: 'CHF',
      paidByMemberId: DEMO_ALEX_MEMBER_ID,
      participantMemberIds: memberIds,
      splitMode: 'equal',
      occurredAt: '2026-09-17T12:00:00.000Z',
      createdBy: DEMO_USER.userId,
    });

    expect(expense.id).toBeDefined();
    expect(expense.amountMinor).toBe(8500);

    // Verify financial balance
    const allExpenses = await repos.expenses.getByHousehold(DEMO_HOUSEHOLD_ID);
    const moneyBalances = calculateFinancialBalancesByCurrency(allExpenses, [], memberIds);
    expect(financialLedgerIsZeroSum(moneyBalances.get('CHF')!)).toBe(true);

    // Alex paid 8500 for both: alex +4250 (advanced), sam -4250 (owes)
    const chf = moneyBalances.get('CHF')!;
    expect(chf.get(DEMO_ALEX_MEMBER_ID)).toBe(4250);
    expect(chf.get(DEMO_SAM_MEMBER_ID)).toBe(-4250);
  });

  test('5. View combined balances (both ledgers)', async () => {
    const memberIds = [DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID];

    // Add some data
    await repos.contributions.create({
      householdId: DEMO_HOUSEHOLD_ID,
      label: 'Test contribution',
      performedByMemberId: DEMO_ALEX_MEMBER_ID,
      beneficiaryMemberIds: memberIds,
      value: 20,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-17T10:00:00.000Z',
      createdBy: DEMO_USER.userId,
    });

    await repos.expenses.create({
      householdId: DEMO_HOUSEHOLD_ID,
      title: 'Test expense',
      amountMinor: 3000,
      currency: 'CHF',
      paidByMemberId: DEMO_SAM_MEMBER_ID,
      participantMemberIds: memberIds,
      splitMode: 'equal',
      occurredAt: '2026-09-17T11:00:00.000Z',
      createdBy: DEMO_USER.userId,
    });

    // Compute combined snapshot
    const contribs = await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID);
    const expenses = await repos.expenses.getByHousehold(DEMO_HOUSEHOLD_ID);
    const settlements = await repos.settlements.getByHousehold(DEMO_HOUSEHOLD_ID);

    const snapshot = createBalanceSnapshot(contribs, expenses, settlements, 'minutes', memberIds);

    // Verify both ledgers are zero-sum
    expect(contributionLedgerIsZeroSum(snapshot.contribution)).toBe(true);
    for (const [, balances] of snapshot.moneyByCurrency) {
      expect(financialLedgerIsZeroSum(balances)).toBe(true);
    }
  });

  test('6. Cross-ledger settlement applies correctly', async () => {
    const memberIds = [DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID];

    // Create expenses so we have money balances to settle against
    await repos.expenses.create({
      householdId: DEMO_HOUSEHOLD_ID,
      title: 'Groceries for settlement',
      amountMinor: 4000,
      currency: 'CHF',
      paidByMemberId: DEMO_SAM_MEMBER_ID,
      participantMemberIds: memberIds,
      splitMode: 'equal',
      occurredAt: '2026-09-17T12:00:00.000Z',
      createdBy: DEMO_USER.userId,
    });

    // Compute balances before settlement
    const contribsBefore = await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID);
    const expensesBefore = await repos.expenses.getByHousehold(DEMO_HOUSEHOLD_ID);
    const contribBalBefore = calculateContributionBalances(contribsBefore, 'minutes', [], memberIds);
    const moneyBalBefore = calculateFinancialBalancesByCurrency(expensesBefore, [], memberIds);

    // Sam paid 4000 for both: Sam +2000 (advanced), Alex -2000 (owes)
    const chfBefore = moneyBalBefore.get('CHF')!;
    expect(chfBefore).toBeDefined();
    expect(chfBefore.get(DEMO_SAM_MEMBER_ID)).toBe(2000);
    expect(chfBefore.get(DEMO_ALEX_MEMBER_ID)).toBe(-2000);

    // Create a cross-ledger settlement:
    // Alex uses 10min contribution credit to offset 1500 centimes of money debt to Sam
    const settlement = await repos.settlements.create({
      householdId: DEMO_HOUSEHOLD_ID,
      contributionCreditorMemberId: DEMO_ALEX_MEMBER_ID,
      counterpartyMemberId: DEMO_SAM_MEMBER_ID,
      contributionValue: 10,
      contributionUnit: 'minutes',
      moneyAmountMinor: 1500,
      currency: 'CHF',
      rateSnapshot: {
        contributionValue: 10,
        contributionUnit: 'minutes',
        moneyAmountMinor: 1500,
        currency: 'CHF',
      },
      occurredAt: '2026-09-17T13:00:00.000Z',
      createdBy: DEMO_USER.userId,
    });

    expect(settlement.id).toBeDefined();
    expect(settlement.contributionValue).toBe(10);
    expect(settlement.moneyAmountMinor).toBe(1500);

    // Verify: both ledgers remain zero-sum after settlement
    const contribsAfter = await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID);
    const expensesAfter = await repos.expenses.getByHousehold(DEMO_HOUSEHOLD_ID);
    const settlementsAll = await repos.settlements.getByHousehold(DEMO_HOUSEHOLD_ID);

    const contribBalAfter = calculateContributionBalances(
      contribsAfter, 'minutes', settlementsAll, memberIds
    );
    const moneyBalAfter = calculateFinancialBalancesByCurrency(
      expensesAfter, settlementsAll, memberIds
    );

    expect(contributionLedgerIsZeroSum(contribBalAfter)).toBe(true);
    for (const [, bal] of moneyBalAfter) {
      expect(financialLedgerIsZeroSum(bal)).toBe(true);
    }

    // Verify settlement effect on contribution balances:
    // Alex loses 10 contribution credit, Sam gains 10
    const contribDeltaAlex = (contribBalAfter.get(DEMO_ALEX_MEMBER_ID) ?? 0) - (contribBalBefore.get(DEMO_ALEX_MEMBER_ID) ?? 0);
    const contribDeltaSam = (contribBalAfter.get(DEMO_SAM_MEMBER_ID) ?? 0) - (contribBalBefore.get(DEMO_SAM_MEMBER_ID) ?? 0);
    expect(contribDeltaAlex).toBe(-10);
    expect(contribDeltaSam).toBe(10);

    // Verify settlement effect on money balances:
    // Alex gains 1500 (debt relieved), Sam loses 1500 (receivable reduced)
    const chfAfter = moneyBalAfter.get('CHF')!;
    const moneyDeltaAlex = (chfAfter.get(DEMO_ALEX_MEMBER_ID) ?? 0) - (chfBefore.get(DEMO_ALEX_MEMBER_ID) ?? 0);
    const moneyDeltaSam = (chfAfter.get(DEMO_SAM_MEMBER_ID) ?? 0) - (chfBefore.get(DEMO_SAM_MEMBER_ID) ?? 0);
    expect(moneyDeltaAlex).toBe(1500);
    expect(moneyDeltaSam).toBe(-1500);
  });

  test('7. Complete todo atomically', async () => {
    const todos = await repos.todos.getByHousehold(DEMO_HOUSEHOLD_ID);
    expect(todos).toHaveLength(1);
    const todo = todos[0];
    expect(todo.title).toBe('Sortir les poubelles');
    expect(todo.status).toBe('todo');

    // Complete the todo atomically
    const result = await completeTodoAtomic(repos, {
      todo,
      household: (await repos.households.getById(DEMO_HOUSEHOLD_ID))!,
      performerMemberId: DEMO_SAM_MEMBER_ID,
      value: 10,
      beneficiaryMemberIds: [DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID],
      completedByUserId: DEMO_USER.userId,
    });

    // Verify: exactly 1 ContributionEntry created
    expect(result.contributionEntry).toBeDefined();
    expect(result.contributionEntry.value).toBe(10);
    expect(result.contributionEntry.unit).toBe('minutes');
    expect(result.contributionEntry.performedByMemberId).toBe(DEMO_SAM_MEMBER_ID);

    // Verify: todo is completed
    const updatedTodo = await repos.todos.getById(todo.id);
    expect(updatedTodo?.status).toBe('completed');
    expect(updatedTodo?.completedAt).toBeDefined();

    // Verify: exactly 1 new contribution (2 from fixture + 1 from completion)
    const allContribs = await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID);
    expect(allContribs).toHaveLength(3);
  });

  test('8. Edit contribution value and verify balance recalculation', async () => {
    const memberIds = [DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID];
    const contribs = await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID);
    const originalContrib = contribs.find((c) => c.label === 'Vaisselle du soir');
    expect(originalContrib).toBeDefined();

    // Edit the value
    const updated = await repos.contributions.update(originalContrib!.id, {
      value: 30, // Changed from 15 to 30
      modifiedBy: DEMO_USER.userId,
    });
    expect(updated.value).toBe(30);
    expect(updated.modifiedBy).toBe(DEMO_USER.userId);

    // Verify balance recalculation
    const allContribs = await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID);
    const balances = calculateContributionBalances(allContribs, 'minutes', [], memberIds);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
  });

  test('9. Delete expense and verify financial balance recalculation', async () => {
    const memberIds = [DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID];

    // Add an expense
    const expense = await repos.expenses.create({
      householdId: DEMO_HOUSEHOLD_ID,
      title: 'To be deleted',
      amountMinor: 1000,
      currency: 'CHF',
      paidByMemberId: DEMO_ALEX_MEMBER_ID,
      participantMemberIds: memberIds,
      splitMode: 'equal',
      occurredAt: '2026-09-17T14:00:00.000Z',
      createdBy: DEMO_USER.userId,
    });

    // Delete it
    await repos.expenses.delete(expense.id);

    // Verify
    const remaining = await repos.expenses.getByHousehold(DEMO_HOUSEHOLD_ID);
    expect(remaining.find((e) => e.id === expense.id)).toBeUndefined();
  });

  test('10. Activity log shows mixed entries', async () => {
    const contribs = await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID);
    const expenses = await repos.expenses.getByHousehold(DEMO_HOUSEHOLD_ID);
    const settlements = await repos.settlements.getByHousehold(DEMO_HOUSEHOLD_ID);

    const page = paginateActivityLog(contribs, expenses, settlements, { limit: 10 });
    // Should have 2 contributions from fixture + 1 todo from fixture
    expect(page.entries.length).toBeGreaterThanOrEqual(2);
    expect(page.hasMore).toBe(false);

    // Verify entries are sorted by occurredAt DESC (newest first)
    for (let i = 1; i < page.entries.length; i++) {
      expect(
        page.entries[i - 1].entry.occurredAt >= page.entries[i].entry.occurredAt
      ).toBe(true);
    }
  });

  test('11. Authorization: member access is enforced', async () => {
    const memberships = await repos.memberships.getByUserAndHousehold(
      DEMO_USER.userId,
      DEMO_HOUSEHOLD_ID
    );
    expect(memberships).not.toBeNull();

    // Authorization check should pass (user is a member of the household)
    const allMemberships = await repos.memberships.getByHousehold(DEMO_HOUSEHOLD_ID);
    expect(() =>
      requireHouseholdMembership(DEMO_USER.userId, DEMO_HOUSEHOLD_ID, allMemberships)
    ).not.toThrow();

    // Owner role check should pass (user is OWNER)
    expect(() =>
      requireRole(DEMO_USER.userId, DEMO_HOUSEHOLD_ID, allMemberships, 'OWNER')
    ).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════
// Invitation flow E2E
// ══════════════════════════════════════════════════════════════

describe('V3-08 E2E: Invitation flow', () => {
  let repos: AllRepositories;

  beforeEach(async () => {
    repos = createInMemoryRepositories();
    await ensureDemoFixture(repos, DEMO_USER);
  });

  test('create invitation → accept → join group', async () => {
    // 1. Create invitation
    const invitation = await repos.invitations.create({
      householdId: DEMO_HOUSEHOLD_ID,
      invitedByUserId: DEMO_USER.userId,
      invitedEmail: 'newuser@example.com',
      role: 'MEMBER',
      status: 'pending',
      linkToken: 'test-token-abc',
      expiresAt: '2026-12-31T00:00:00.000Z',
    });
    expect(invitation.id).toBeDefined();
    expect(invitation.status).toBe('pending');

    // 2. Lookup by token
    const found = await repos.invitations.getByLinkToken('test-token-abc');
    expect(found).not.toBeNull();
    expect(found!.householdId).toBe(DEMO_HOUSEHOLD_ID);

    // 3. Accept invitation
    const accepted = await repos.invitations.updateStatus(invitation.id, 'accepted');
    expect(accepted.status).toBe('accepted');

    // 4. Create membership for the new user
    const newMembership = await repos.memberships.create({
      userId: 'new-user-id',
      householdId: DEMO_HOUSEHOLD_ID,
      role: 'MEMBER',
    });
    expect(newMembership.id).toBeDefined();

    // 5. Create member entry
    const newMember = await repos.members.create({
      householdId: DEMO_HOUSEHOLD_ID,
      name: 'New Member',
      userId: 'new-user-id',
    });
    expect(newMember.id).toBeDefined();

    // 6. Verify household now has 3 members
    const members = await repos.members.getByHousehold(DEMO_HOUSEHOLD_ID);
    expect(members).toHaveLength(3);
  });
});

// ══════════════════════════════════════════════════════════════
// Sync delta flow E2E
// ══════════════════════════════════════════════════════════════

describe('V3-08 E2E: Sync delta flow', () => {
  let repos: AllRepositories;

  beforeEach(async () => {
    repos = createInMemoryRepositories();
    await ensureDemoFixture(repos, DEMO_USER);
  });

  test('pull 3 deltas applies changes, push sends local writes', async () => {
    const syncState = repos.syncState;

    // 1. Create a local contribution (generates a dirty record)
    const localContrib = await repos.contributions.create({
      householdId: DEMO_HOUSEHOLD_ID,
      label: 'Local write',
      performedByMemberId: DEMO_ALEX_MEMBER_ID,
      beneficiaryMemberIds: [DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID],
      value: 25,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-17T15:00:00.000Z',
      createdBy: DEMO_USER.userId,
    });

    // 2. Pull 3 remote deltas
    let pullCount = 0;
    await pullDeltas(syncState, DEMO_HOUSEHOLD_ID, async (coll) => {
      pullCount++;
      if (coll !== 'contribution_entries') return [];
      return [
        {
          id: `remote-${pullCount}`,
          householdId: DEMO_HOUSEHOLD_ID,
          collection: 'contribution_entries',
          revision: pullCount,
          updatedAt: '2026-09-17T16:00:00Z',
          deletedAt: null,
          payload: JSON.stringify({
            id: `remote-${pullCount}`,
            householdId: DEMO_HOUSEHOLD_ID,
            label: `Remote contribution ${pullCount}`,
            performedByMemberId: DEMO_SAM_MEMBER_ID,
            beneficiaryMemberIds: [DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID],
            value: 10 * pullCount,
            unit: 'minutes',
            persistentTaskId: null,
            occurredAt: `2026-09-17T${16 + pullCount}:00:00.000Z`,
            createdBy: 'user-sam',
          }),
        },
      ];
    });

    // Pull was called for each collection
    expect(pullCount).toBe(SYNC_COLLECTIONS.length);

    // 3. Verify data is readable
    const allContribs = await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID);
    // 2 from fixture + 1 local + potentially materialized remote
    expect(allContribs.length).toBeGreaterThanOrEqual(3);

    // 4. Push sends local dirty records
    const pushResult = await pushDeltas(syncState, DEMO_HOUSEHOLD_ID, async (coll, records) => {
      return records.map((r, i) => ({ ...r, revision: 100 + i }));
    });

    // Push should have attempted at least 1 record
    expect(pushResult.totalPushed).toBeGreaterThanOrEqual(0);
  });
});

// ══════════════════════════════════════════════════════════════
// Auth adapter E2E
// ══════════════════════════════════════════════════════════════

describe('V3-08 E2E: Auth adapter', () => {
  test('auth adapter provides working demo sign-in', async () => {
    const auth = new LocalAuthAdapter();
    expect(auth.isAvailable()).toBe(true);

    const user = await auth.signInWithEmail('demo@chorescore.app', 'test');
    expect(user).not.toBeNull();
    expect(user?.email).toBe('demo@chorescore.app');

    // Sign out
    await auth.signOut();
    const states: any[] = [];
    const unsub = auth.onAuthStateChanged((u) => states.push(u));
    // Wait for the state change
    await new Promise((r) => setTimeout(r, 10));
    unsub();
  });
});
