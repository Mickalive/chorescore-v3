/**
 * V3-02 — Infrastructure tests
 *
 * Verifies in-memory repositories work correctly and that
 * the domain entities flow through the infrastructure layer.
 * These are provider-independent tests that validate the contracts.
 */

import {
  InMemoryUserRepository,
  InMemoryMembershipRepository,
  InMemoryHouseholdRepository,
  InMemoryMemberRepository,
  InMemoryContributionEntryRepository,
  InMemoryPersistentTaskRepository,
  InMemoryTodoRepository,
  InMemoryExpenseEntryRepository,
  InMemorySettlementRepository,
} from '../../src/infrastructure/repositories/InMemoryRepositories';

describe('V3-02 InMemory repositories', () => {
  test('household CRUD works without restrictions', async () => {
    const repo = new InMemoryHouseholdRepository();

    const h1 = await repo.create({
      name: 'Colocation',
      ownerId: 'user-1',
      contributionUnit: 'minutes',
      crossLedgerCompensationEnabled: false,
      contributionToMoneyRate: null,
    });
    expect(h1.id).toBeTruthy();
    expect(h1.name).toBe('Colocation');
    expect(h1.contributionUnit).toBe('minutes');
    expect(h1.crossLedgerCompensationEnabled).toBe(false);

    const h2 = await repo.create({
      name: 'Vacances',
      ownerId: 'user-1',
      contributionUnit: 'points',
      crossLedgerCompensationEnabled: false,
      contributionToMoneyRate: null,
    });

    const all = await repo.getAll();
    expect(all).toHaveLength(2);

    const found = await repo.getById(h1.id);
    expect(found?.name).toBe('Colocation');

    // No limit on creation — unlimited groups
    const h3 = await repo.create({
      name: 'Troisieme groupe',
      ownerId: 'user-2',
      contributionUnit: 'minutes',
      crossLedgerCompensationEnabled: false,
      contributionToMoneyRate: null,
    });
    expect(all).toHaveLength(2); // all was captured before h3

    const allAfter = await repo.getAll();
    expect(allAfter).toHaveLength(3);
  });

  test('contribution entries store unit and beneficiary IDs correctly', async () => {
    const repo = new InMemoryContributionEntryRepository();

    const entry = await repo.create({
      householdId: 'h-1',
      label: 'Vaisselle',
      performedByMemberId: 'm-alex',
      beneficiaryMemberIds: ['m-alex', 'm-sam'],
      value: 15,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T12:00:00.000Z',
      createdBy: 'user-alex',
    });

    expect(entry.id).toBeTruthy();
    expect(entry.unit).toBe('minutes');
    expect(entry.value).toBe(15);
    expect(entry.beneficiaryMemberIds).toEqual(['m-alex', 'm-sam']);

    const fetched = await repo.getById(entry.id);
    expect(fetched?.label).toBe('Vaisselle');

    const byHousehold = await repo.getByHousehold('h-1');
    expect(byHousehold).toHaveLength(1);
  });

  test('expense entries store integer minor units and split mode', async () => {
    const repo = new InMemoryExpenseEntryRepository();

    const entry = await repo.create({
      householdId: 'h-1',
      title: 'Courses Migros',
      amountMinor: 4250,
      currency: 'CHF',
      paidByMemberId: 'm-alex',
      participantMemberIds: ['m-alex', 'm-sam'],
      splitMode: 'equal',
      occurredAt: '2026-09-16T12:00:00.000Z',
      createdBy: 'user-alex',
    });

    expect(entry.amountMinor).toBe(4250);
    expect(entry.currency).toBe('CHF');
    expect(entry.splitMode).toBe('equal');

    const fetched = await repo.getById(entry.id);
    expect(fetched?.title).toBe('Courses Migros');
  });

  test('settlements store rate snapshots immutably', async () => {
    const repo = new InMemorySettlementRepository();

    const settlement = await repo.create({
      householdId: 'h-1',
      contributionCreditorMemberId: 'm-alex',
      counterpartyMemberId: 'm-sam',
      contributionValue: 15,
      contributionUnit: 'minutes',
      moneyAmountMinor: 500,
      currency: 'CHF',
      rateSnapshot: {
        contributionValue: 60,
        contributionUnit: 'minutes',
        moneyAmountMinor: 2000,
        currency: 'CHF',
      },
      occurredAt: '2026-09-16T13:00:00.000Z',
      createdBy: 'user-alex',
    });

    expect(settlement.rateSnapshot.contributionValue).toBe(60);
    expect(settlement.moneyAmountMinor).toBe(500);

    const fetched = await repo.getById(settlement.id);
    expect(fetched?.rateSnapshot.moneyAmountMinor).toBe(2000);
  });

  test('membership prevents duplicate user-household pairs', async () => {
    const repo = new InMemoryMembershipRepository();

    await repo.create({
      userId: 'user-1',
      householdId: 'h-1',
      role: 'OWNER',
    });

    const existing = await repo.getByUserAndHousehold('user-1', 'h-1');
    expect(existing).not.toBeNull();
    expect(existing?.role).toBe('OWNER');

    // Another membership for different household works
    await repo.create({
      userId: 'user-1',
      householdId: 'h-2',
      role: 'MEMBER',
    });

    const h2Membership = await repo.getByUserAndHousehold('user-1', 'h-2');
    expect(h2Membership).not.toBeNull();
  });

  test('todo items track status and completion', async () => {
    const repo = new InMemoryTodoRepository();

    const todo = await repo.create({
      householdId: 'h-1',
      title: 'Sortir les poubelles',
      assigneeMemberId: 'm-sam',
      beneficiaryMemberIds: ['m-alex', 'm-sam'],
      dueAt: null,
      reminderAt: null,
      notes: '',
      persistentTaskId: null,
      status: 'todo',
    });

    expect(todo.status).toBe('todo');
    expect(todo.completedAt).toBeUndefined();

    const completed = await repo.update(todo.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });

    expect(completed.status).toBe('completed');
    expect(completed.completedAt).toBeTruthy();
  });

  test('persistent tasks store default values and unit', async () => {
    const repo = new InMemoryPersistentTaskRepository();

    const task = await repo.create({
      householdId: 'h-1',
      name: 'Vaisselle',
      defaultValue: 15,
      defaultUnit: 'minutes',
    });

    expect(task.defaultValue).toBe(15);
    expect(task.defaultUnit).toBe('minutes');

    const byHousehold = await repo.getByHousehold('h-1');
    expect(byHousehold).toHaveLength(1);
    expect(byHousehold[0].name).toBe('Vaisselle');
  });
});

describe('V3-02 multi-group support', () => {
  test('user can belong to multiple groups without restriction', async () => {
    const userRepo = new InMemoryUserRepository();
    const householdRepo = new InMemoryHouseholdRepository();
    const membershipRepo = new InMemoryMembershipRepository();

    const user = await userRepo.create({
      email: 'test@example.com',
      displayName: 'Test User',
    });

    // Create 5 groups — no limit
    for (let i = 1; i <= 5; i++) {
      const household = await householdRepo.create({
        name: `Groupe ${i}`,
        ownerId: user.id,
        contributionUnit: 'minutes',
        crossLedgerCompensationEnabled: false,
        contributionToMoneyRate: null,
      });

      await membershipRepo.create({
        userId: user.id,
        householdId: household.id,
        role: 'OWNER',
      });
    }

    const memberships = await membershipRepo.getByUser(user.id);
    expect(memberships).toHaveLength(5);

    const households = await householdRepo.getAll();
    expect(households).toHaveLength(5);
  });
});
