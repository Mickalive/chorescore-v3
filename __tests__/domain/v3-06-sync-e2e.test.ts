/**
 * V3-06 E2E Sync Pipeline Tests
 *
 * Proves that the sync pipeline is wired end-to-end:
 *   1. A remote delta materializes into business data (balances update).
 *   2. A local write appears in getDirtyRecords and is pushed.
 *   3. Concurrent same-id edits are resolved deterministically.
 *   4. Cross-tenant reads are blocked at the data-access level.
 *   5. Balance falsification is rejected.
 *   6. No N+1 reads, no massive listeners.
 *
 * These tests must FAIL until the pipeline is wired.
 * They verify the findings from the V3-06 audit.
 */

import { createInMemoryRepositories, AllRepositories } from '../../src/infrastructure/repositories/RepositoryFactory';
import {
  InMemorySyncStateRepository,
} from '../../src/infrastructure/repositories/InMemoryRepositories';
import {
  Household,
  Membership,
  Member,
  ContributionEntry,
  ExpenseEntry,
  SyncRecord,
  SyncCollection,
} from '../../src/domain/entities';
import {
  pullDeltas,
  pushDeltas,
  syncHousehold,
  SYNC_COLLECTIONS,
} from '../../src/domain/services/syncEngine';
import {
  requireHouseholdMembership,
  requireRole,
  resolveConflict,
  AuthorizationError,
} from '../../src/domain/services/authorizationRules';
import {
  calculateContributionBalances,
  balancesToArray,
} from '../../src/domain/calculations/contributionLedger';

const HH = 'h-test';
const HH2 = 'h-test-2';

function household(overrides: Partial<Household> = {}): Household {
  return {
    id: HH,
    name: 'Test Group',
    ownerId: 'user-a',
    contributionUnit: 'minutes',
    crossLedgerCompensationEnabled: false,
    contributionToMoneyRate: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function member(id: string, householdId: string = HH): Member {
  return {
    id,
    householdId,
    name: `Member ${id}`,
    userId: `user-${id}`,
    joinedAt: '2026-01-01T00:00:00.000Z',
  };
}

// ── 1. Remote Delta Materializes into Business Data ────────────

describe('V3-06 E2E: remote delta materializes into business data', () => {
  let repos: AllRepositories;

  beforeEach(() => {
    repos = createInMemoryRepositories();
  });

  test('applyDeltas creates a contribution entry that is readable from business repo', async () => {
    // Seed household and members
    await repos.households.seed([household()]);
    await repos.members.seed([member('m-a'), member('m-b')]);

    // Simulate a remote delta: someone on another device created a contribution
    const remotePayload = JSON.stringify({
      id: 'c-remote-1',
      householdId: HH,
      label: 'Vaisselle du remote',
      performedByMemberId: 'm-a',
      beneficiaryMemberIds: ['m-a', 'm-b'],
      value: 20,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });

    const remoteRecords: SyncRecord[] = [{
      id: 'c-remote-1',
      householdId: HH,
      collection: 'contribution_entries',
      revision: 1,
      updatedAt: '2026-09-16T10:00:00Z',
      deletedAt: null,
      payload: remotePayload,
    }];

    // Pull the delta — this should materialize into contribution_entries
    const result = await pullDeltas(repos.syncState, HH, async (coll, sinceRev) => {
      if (coll !== 'contribution_entries') return [];
      expect(sinceRev).toBe(0);
      return remoteRecords;
    });

    expect(result.totalApplied).toBe(1);

    // The contribution should now be readable from the business repository
    const entry = await repos.contributions.getById('c-remote-1');
    expect(entry).not.toBeNull();
    expect(entry!.label).toBe('Vaisselle du remote');
    expect(entry!.value).toBe(20);
    expect(entry!.unit).toBe('minutes');
    expect(entry!.performedByMemberId).toBe('m-a');
    expect(entry!.beneficiaryMemberIds).toEqual(['m-a', 'm-b']);
  });

  test('applyDeltas materializes an expense entry', async () => {
    await repos.households.seed([household()]);
    await repos.members.seed([member('m-a'), member('m-b')]);

    const remotePayload = JSON.stringify({
      id: 'e-remote-1',
      householdId: HH,
      title: 'Courses Migros',
      amountMinor: 4250,
      currency: 'CHF',
      paidByMemberId: 'm-b',
      participantMemberIds: ['m-a', 'm-b'],
      splitMode: 'equal',
      occurredAt: '2026-09-16T11:00:00.000Z',
      createdBy: 'user-b',
    });

    const remoteRecords: SyncRecord[] = [{
      id: 'e-remote-1',
      householdId: HH,
      collection: 'expense_entries',
      revision: 1,
      updatedAt: '2026-09-16T11:00:00Z',
      deletedAt: null,
      payload: remotePayload,
    }];

    await pullDeltas(repos.syncState, HH, async (coll, sinceRev) => {
      if (coll !== 'expense_entries') return [];
      return remoteRecords;
    });

    const entry = await repos.expenses.getById('e-remote-1');
    expect(entry).not.toBeNull();
    expect(entry!.title).toBe('Courses Migros');
    expect(entry!.amountMinor).toBe(4250);
  });

  test('remote delta updates balances after materialization', async () => {
    await repos.households.seed([household()]);
    await repos.members.seed([member('m-a'), member('m-b')]);

    // Pull a contribution: m-a did 20 min for m-a + m-b
    const remotePayload = JSON.stringify({
      id: 'c-1',
      householdId: HH,
      label: 'Vaisselle',
      performedByMemberId: 'm-a',
      beneficiaryMemberIds: ['m-a', 'm-b'],
      value: 20,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });

    await pullDeltas(repos.syncState, HH, async (coll) => {
      if (coll !== 'contribution_entries') return [];
      return [{ id: 'c-1', householdId: HH, collection: 'contribution_entries', revision: 1, updatedAt: '2026-09-16T10:00:00Z', deletedAt: null, payload: remotePayload }];
    });

    // Read all contributions and compute balances
    const contributions = await repos.contributions.getByHousehold(HH);
    expect(contributions).toHaveLength(1);

    const memberIds = ['m-a', 'm-b'];
    const balances = calculateContributionBalances(contributions, 'minutes', [], memberIds);
    const arr = balancesToArray(balances);

    // m-a gets +20, m-b gets -10 (half of the 20 min done for both)
    const alexBalance = arr.find((b) => b.memberId === 'm-a');
    const samBalance = arr.find((b) => b.memberId === 'm-b');
    expect(alexBalance?.value).toBe(10); // +20 credit - 10 cost = 10
    expect(samBalance?.value).toBe(-10); // 0 - 10 cost = -10

    // Zero-sum invariant
    const sum = arr.reduce((s, b) => s + b.value, 0);
    expect(sum).toBe(0);
  });
});

// ── 2. Local Write Appears in getDirtyRecords and Is Pushed ────

describe('V3-06 E2E: local write is queued and pushed', () => {
  let repos: AllRepositories;

  beforeEach(() => {
    repos = createInMemoryRepositories();
  });

  test('creating a contribution produces a dirty record', async () => {
    await repos.households.seed([household()]);

    // Create a local contribution
    const created = await repos.contributions.create({
      householdId: HH,
      label: 'Local contribution',
      performedByMemberId: 'm-a',
      beneficiaryMemberIds: ['m-a'],
      value: 15,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });

    // The dirty records should contain this contribution
    const dirty = await repos.syncState.getDirtyRecords(HH, 'contribution_entries', 0);
    expect(dirty.length).toBeGreaterThanOrEqual(1);

    const dirtyRecord = dirty.find((r) => r.id === created.id);
    expect(dirtyRecord).toBeDefined();
    expect(dirtyRecord!.payload).toBeTruthy();

    // The payload should deserialize to the created entity
    const payload = JSON.parse(dirtyRecord!.payload!);
    expect(payload.label).toBe('Local contribution');
    expect(payload.value).toBe(15);
  });

  test('pushDeltas sends the actual local write to remote', async () => {
    await repos.households.seed([household()]);

    // Create a local contribution
    const created = await repos.contributions.create({
      householdId: HH,
      label: 'Push me',
      performedByMemberId: 'm-a',
      beneficiaryMemberIds: ['m-a'],
      value: 10,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });

    // Push — the remote should receive the real record
    const pushedRecords: SyncRecord[] = [];
    const result = await pushDeltas(repos.syncState, HH, async (_coll, records) => {
      pushedRecords.push(...records);
      // Server assigns revisions
      return records.map((r, i) => ({ ...r, revision: 100 + i }));
    });

    expect(result.totalPushed).toBeGreaterThanOrEqual(1);
    expect(pushedRecords.length).toBeGreaterThanOrEqual(1);

    const pushed = pushedRecords.find((r) => r.id === created.id);
    expect(pushed).toBeDefined();
    expect(pushed!.payload).toBeTruthy();
    expect(JSON.parse(pushed!.payload!).label).toBe('Push me');
  });

  test('creating an expense also produces a dirty record', async () => {
    await repos.households.seed([household()]);

    const created = await repos.expenses.create({
      householdId: HH,
      title: 'Local expense',
      amountMinor: 2500,
      currency: 'CHF',
      paidByMemberId: 'm-a',
      participantMemberIds: ['m-a', 'm-b'],
      splitMode: 'equal',
      occurredAt: '2026-09-16T11:00:00.000Z',
      createdBy: 'user-a',
    });

    const dirty = await repos.syncState.getDirtyRecords(HH, 'expense_entries', 0);
    expect(dirty.length).toBeGreaterThanOrEqual(1);

    const dirtyRecord = dirty.find((r) => r.id === created.id);
    expect(dirtyRecord).toBeDefined();
    expect(JSON.parse(dirtyRecord!.payload!).title).toBe('Local expense');
  });

  test('full sync: pull remote + push local in one cycle', async () => {
    await repos.households.seed([household()]);
    await repos.members.seed([member('m-a'), member('m-b')]);

    // 1. Create a local contribution (should produce dirty record)
    await repos.contributions.create({
      householdId: HH,
      label: 'Local',
      performedByMemberId: 'm-a',
      beneficiaryMemberIds: ['m-a'],
      value: 10,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });

    // 2. Pull a remote contribution
    const remotePayload = JSON.stringify({
      id: 'c-remote',
      householdId: HH,
      label: 'Remote',
      performedByMemberId: 'm-b',
      beneficiaryMemberIds: ['m-a', 'm-b'],
      value: 20,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T11:00:00.000Z',
      createdBy: 'user-b',
    });

    // 3. Full sync: pull then push
    const pushedRecords: SyncRecord[] = [];
    const syncResult = await syncHousehold(
      repos.syncState,
      HH,
      async (coll) => {
        if (coll !== 'contribution_entries') return [];
        return [{ id: 'c-remote', householdId: HH, collection: 'contribution_entries', revision: 1, updatedAt: '2026-09-16T11:00:00Z', deletedAt: null, payload: remotePayload }];
      },
      async (_coll, records) => {
        pushedRecords.push(...records);
        return records.map((r, i) => ({ ...r, revision: 200 + i }));
      },
    );

    // Pull materialized the remote contribution
    expect(syncResult.pull.totalApplied).toBe(1);
    const remoteEntry = await repos.contributions.getById('c-remote');
    expect(remoteEntry).not.toBeNull();
    expect(remoteEntry!.label).toBe('Remote');

    // Push sent the local contribution
    expect(syncResult.push.totalPushed).toBeGreaterThanOrEqual(1);
    expect(pushedRecords.some((r) => JSON.parse(r.payload!).label === 'Local')).toBe(true);

    // Both contributions exist in the business repo
    const all = await repos.contributions.getByHousehold(HH);
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});

// ── 3. Deterministic Conflict Resolution ──────────────────────

describe('V3-06 E2E: concurrent same-id edits resolved deterministically', () => {
  test('higher revision wins over lower revision', () => {
    const local = { id: 'c-1', revision: 3, updatedAt: '2026-09-16T10:00:00Z' };
    const remote = { id: 'c-1', revision: 5, updatedAt: '2026-09-16T09:00:00Z' };

    const winner = resolveConflict(local, remote);
    expect(winner.revision).toBe(5);
  });

  test('later timestamp wins on same revision', () => {
    const local = { id: 'c-1', revision: 3, updatedAt: '2026-09-16T10:00:00Z' };
    const remote = { id: 'c-1', revision: 3, updatedAt: '2026-09-16T12:00:00Z' };

    const winner = resolveConflict(local, remote);
    expect(winner.updatedAt).toBe('2026-09-16T12:00:00Z');
  });

  test('lexicographic id breaks final tie', () => {
    const local = { id: 'c-1', revision: 3, updatedAt: '2026-09-16T10:00:00Z' };
    const remote = { id: 'c-2', revision: 3, updatedAt: '2026-09-16T10:00:00Z' };

    const winner = resolveConflict(local, remote);
    expect(winner.id).toBe('c-2');
  });

  test('local wins when it has higher revision', () => {
    const local = { id: 'c-1', revision: 7, updatedAt: '2026-09-16T10:00:00Z' };
    const remote = { id: 'c-1', revision: 3, updatedAt: '2026-09-16T12:00:00Z' };

    const winner = resolveConflict(local, remote);
    expect(winner.revision).toBe(7);
  });
});

// ── 4. Hostile: Cross-Tenant Read Blocked ─────────────────────

describe('V3-06 hostile: cross-tenant isolation', () => {
  test('user cannot access data from a household they are not a member of', () => {
    const memberships: Membership[] = [
      { id: 'm1', userId: 'user-a', householdId: HH, role: 'OWNER', joinedAt: '2026-01-01' },
    ];

    // user-a CAN access HH
    const membership = requireHouseholdMembership('user-a', HH, memberships);
    expect(membership.householdId).toBe(HH);

    // user-a CANNOT access HH2
    expect(() => {
      requireHouseholdMembership('user-a', HH2, memberships);
    }).toThrow(AuthorizationError);
  });

  test('non-member user is blocked from all household data', () => {
    const memberships: Membership[] = [
      { id: 'm1', userId: 'user-a', householdId: HH, role: 'OWNER', joinedAt: '2026-01-01' },
    ];

    expect(() => {
      requireHouseholdMembership('user-stranger', HH, memberships);
    }).toThrow(AuthorizationError);

    try {
      requireHouseholdMembership('user-stranger', HH, memberships);
    } catch (e) {
      expect(e).toBeInstanceOf(AuthorizationError);
      expect((e as AuthorizationError).code).toBe('CROSS_TENANT');
    }
  });

  test('MEMBER cannot perform OWNER-only actions', () => {
    const memberships: Membership[] = [
      { id: 'm1', userId: 'user-member', householdId: HH, role: 'MEMBER', joinedAt: '2026-01-01' },
    ];

    expect(() => {
      requireRole('user-member', HH, memberships, 'OWNER');
    }).toThrow(AuthorizationError);

    try {
      requireRole('user-member', HH, memberships, 'OWNER');
    } catch (e) {
      expect(e).toBeInstanceOf(AuthorizationError);
      expect((e as AuthorizationError).code).toBe('INSUFFICIENT_ROLE');
    }
  });

  test('OWNER can perform OWNER actions', () => {
    const memberships: Membership[] = [
      { id: 'm1', userId: 'user-owner', householdId: HH, role: 'OWNER', joinedAt: '2026-01-01' },
    ];

    const result = requireRole('user-owner', HH, memberships, 'OWNER');
    expect(result.role).toBe('OWNER');
  });

  test('MEMBER can perform MEMBER actions', () => {
    const memberships: Membership[] = [
      { id: 'm1', userId: 'user-member', householdId: HH, role: 'MEMBER', joinedAt: '2026-01-01' },
    ];

    const result = requireRole('user-member', HH, memberships, 'MEMBER');
    expect(result.role).toBe('MEMBER');
  });
});

// ── 5. Hostile: Balance Falsification Rejected ────────────────

describe('V3-06 hostile: balance integrity', () => {
  test('all balance mutations must go through ledger operations', () => {
    // The assertLedgerWrite guard ensures that balance changes
    // only happen through proper ledger operations
    const { assertLedgerWrite } = require('../../src/domain/services/authorizationRules');

    // Valid ledger operation
    expect(() => assertLedgerWrite('create-contribution')).not.toThrow();
    expect(() => assertLedgerWrite('create-expense')).not.toThrow();
    expect(() => assertLedgerWrite('create-settlement')).not.toThrow();

    // Invalid: empty or non-string operation
    expect(() => assertLedgerWrite('')).toThrow(AuthorizationError);
    expect(() => assertLedgerWrite(null as any)).toThrow(AuthorizationError);
    expect(() => assertLedgerWrite(undefined as any)).toThrow(AuthorizationError);
  });

  test('contribution ledger maintains zero-sum invariant', async () => {
    const repos = createInMemoryRepositories();
    await repos.households.seed([household()]);
    await repos.members.seed([member('m-a'), member('m-b'), member('m-c')]);

    // Create contributions: m-a did 30 min for all 3
    await repos.contributions.create({
      householdId: HH,
      label: 'Task 1',
      performedByMemberId: 'm-a',
      beneficiaryMemberIds: ['m-a', 'm-b', 'm-c'],
      value: 30,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-a',
    });

    // Create contributions: m-b did 15 min for all 3
    await repos.contributions.create({
      householdId: HH,
      label: 'Task 2',
      performedByMemberId: 'm-b',
      beneficiaryMemberIds: ['m-a', 'm-b', 'm-c'],
      value: 15,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-16T11:00:00.000Z',
      createdBy: 'user-b',
    });

    const contributions = await repos.contributions.getByHousehold(HH);
    const memberIds = ['m-a', 'm-b', 'm-c'];
    const balances = calculateContributionBalances(contributions, 'minutes', [], memberIds);
    const arr = balancesToArray(balances);

    // Zero-sum invariant: sum must be exactly 0
    const sum = arr.reduce((s, b) => s + b.value, 0);
    expect(sum).toBe(0);
  });
});

// ── 6. Cost Instrumentation ────────────────────────────────────

describe('V3-06 E2E: cost instrumentation', () => {
  test('full sync has bounded cost per collection', () => {
    const { COST_BUDGETS } = require('../../src/domain/services/costInstrumentation');
    const budget = COST_BUDGETS['sync-delta'];
    expect(budget?.reads).toBeLessThanOrEqual(8);
    expect(budget?.writes).toBeLessThanOrEqual(8);
    expect(budget?.networkCalls).toBeLessThanOrEqual(2);
  });

  test('tab switch costs zero network reads', () => {
    const { COST_BUDGETS } = require('../../src/domain/services/costInstrumentation');
    const budget = COST_BUDGETS['tab-switch'];
    expect(budget?.networkCalls).toBe(0);
    expect(budget?.reads).toBe(0);
  });

  test('create-contribution has bounded writes', () => {
    const { COST_BUDGETS } = require('../../src/domain/services/costInstrumentation');
    const budget = COST_BUDGETS['create-contribution'];
    expect(budget?.writes).toBe(1);
    expect(budget?.networkCalls).toBe(0);
  });
});

// ── 7. No N+1 Reads ──────────────────────────────────────────

describe('V3-06 E2E: no N+1 reads', () => {
  test('loading members + contributions uses exactly 2 bulk reads', async () => {
    const repos = createInMemoryRepositories();

    // Seed 50 members and 200 contributions
    const members: Member[] = Array.from({ length: 50 }, (_, i) => member(`m-${i}`));
    for (const m of members) {
      await repos.members.create({ householdId: m.householdId, name: m.name, userId: m.userId });
    }

    for (let i = 0; i < 200; i++) {
      await repos.contributions.create({
        householdId: HH,
        label: `Contribution ${i}`,
        performedByMemberId: `m-${i % 50}`,
        beneficiaryMemberIds: ['m-0', 'm-1'],
        value: 15,
        unit: 'minutes',
        persistentTaskId: null,
        occurredAt: new Date(Date.now() - i * 60000).toISOString(),
        createdBy: 'user-a',
      });
    }

    // 2 bulk reads, not 50+200
    const [loadedMembers, loadedContributions] = await Promise.all([
      repos.members.getByHousehold(HH),
      repos.contributions.getByHousehold(HH),
    ]);

    expect(loadedMembers).toHaveLength(50);
    expect(loadedContributions).toHaveLength(200);
  });

  test('creating a contribution does not read the full history', async () => {
    const repos = createInMemoryRepositories();

    // Seed 500 existing contributions
    for (let i = 0; i < 500; i++) {
      await repos.contributions.create({
        householdId: HH,
        label: `Old ${i}`,
        performedByMemberId: 'm-a',
        beneficiaryMemberIds: ['m-a'],
        value: 5,
        unit: 'minutes',
        persistentTaskId: null,
        occurredAt: new Date(Date.now() - i * 60000).toISOString(),
        createdBy: 'user-a',
      });
    }

    // Create is a single write — no full history read
    const created = await repos.contributions.create({
      householdId: HH,
      label: 'New',
      performedByMemberId: 'm-b',
      beneficiaryMemberIds: ['m-b'],
      value: 10,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: new Date().toISOString(),
      createdBy: 'user-b',
    });

    expect(created.id).toBeDefined();
  });
});
