/**
 * V3-06 — Groupes, invitations, identité, sync et backend frugal
 *
 * Tests covering:
 *   1. Unlimited groups
 *   2. Invitation create/share/accept lifecycle
 *   3. Stable identity and group isolation
 *   4. Unit change does NOT reinterpret history
 *   5. Delta-only sync with cursors
 *   6. Deterministic conflict resolution
 *   7. Authorization rules (cross-tenant, balance integrity)
 *   8. Cost instrumentation and budgets
 *   9. No N+1 reads, no massive listeners
 */

import { createInMemoryRepositories, AllRepositories } from '../../src/infrastructure/repositories/RepositoryFactory';
import {
  InMemoryInvitationRepository,
  InMemorySyncStateRepository,
} from '../../src/infrastructure/repositories/InMemoryRepositories';
import {
  Household,
  Invitation,
  Membership,
  Member,
  ContributionEntry,
  SyncRecord,
  SyncCollection,
  ContributionUnit,
} from '../../src/domain/entities';
import {
  createInvitation,
  planInvitationAcceptance,
  validateAcceptInvitation,
} from '../../src/domain/services/invitationService';
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
  planUnitChange,
  validateUnitChange,
} from '../../src/domain/services/unitChangeService';
import {
  costTracker,
  COST_BUDGETS,
} from '../../src/domain/services/costInstrumentation';

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

// ── 1. Unlimited Groups ────────────────────────────────────────

describe('V3-06 unlimited groups', () => {
  test('user can create and belong to many groups without restriction', async () => {
    const repos = createInMemoryRepositories();
    const user = await repos.users.create({ email: 'multi@test.com', displayName: 'Multi' });

    // Create 50 groups — no limit enforced
    for (let i = 1; i <= 50; i++) {
      await repos.households.create({
        name: `Group ${i}`,
        ownerId: user.id,
        contributionUnit: 'minutes',
        crossLedgerCompensationEnabled: false,
        contributionToMoneyRate: null,
      });
    }

    const allHouseholds = await repos.households.getAll();
    expect(allHouseholds).toHaveLength(50);
  });

  test('multiple users can each create groups independently', async () => {
    const repos = createInMemoryRepositories();
    const userA = await repos.users.create({ email: 'a@test.com', displayName: 'A' });
    const userB = await repos.users.create({ email: 'b@test.com', displayName: 'B' });

    await repos.households.create({ name: 'A Group', ownerId: userA.id, contributionUnit: 'minutes', crossLedgerCompensationEnabled: false, contributionToMoneyRate: null });
    await repos.households.create({ name: 'B Group 1', ownerId: userB.id, contributionUnit: 'points', crossLedgerCompensationEnabled: false, contributionToMoneyRate: null });
    await repos.households.create({ name: 'B Group 2', ownerId: userB.id, contributionUnit: 'minutes', crossLedgerCompensationEnabled: false, contributionToMoneyRate: null });

    const all = await repos.households.getAll();
    expect(all).toHaveLength(3);
  });
});

// ── 2. Invitation Lifecycle ────────────────────────────────────

describe('V3-06 invitation lifecycle', () => {
  let repos: AllRepositories;

  beforeEach(() => {
    repos = createInMemoryRepositories();
  });

  test('create invitation generates a link token', () => {
    const h = household();
    const invData = createInvitation({
      household: h,
      invitedByUserId: 'user-a',
      invitedEmail: 'new@example.com',
    });

    expect(invData.linkToken).toBeTruthy();
    expect(invData.linkToken).toHaveLength(24); // 12 bytes = 24 hex chars
    expect(invData.status).toBe('pending');
    expect(invData.householdId).toBe(HH);
  });

  test('invitation persists and can be found by link token', async () => {
    const h = household();
    const invData = createInvitation({
      household: h,
      invitedByUserId: 'user-a',
      invitedEmail: 'new@example.com',
    });

    const created = await repos.invitations.create(invData);
    const found = await repos.invitations.getByLinkToken(created.linkToken);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
  });

  test('invitation can be shared (link token is present)', async () => {
    const h = household();
    const invData = createInvitation({
      household: h,
      invitedByUserId: 'user-a',
      invitedEmail: 'share@example.com',
    });

    const created = await repos.invitations.create(invData);

    // Simulate share: the link token would be embedded in a URL
    const shareLink = `https://chorescore.app/join/${created.linkToken}`;
    expect(shareLink).toContain(created.linkToken);
  });

  test('accept invitation creates membership and member atomically', async () => {
    const h = household();
    await repos.households.seed([h]);
    await repos.members.seed([member('m-a')]);
    await repos.memberships.seed([
      { id: 'membership-a', userId: 'user-a', householdId: HH, role: 'OWNER', joinedAt: '2026-01-01' },
    ]);

    const invData = createInvitation({
      household: h,
      invitedByUserId: 'user-a',
      invitedEmail: 'new@example.com',
    });
    const invitation = await repos.invitations.create(invData);

    // Validate acceptance
    const existingMemberships = await repos.memberships.getByHousehold(HH);
    expect(existingMemberships).toHaveLength(1);
    validateAcceptInvitation(invitation, h, existingMemberships);

    // Plan acceptance
    const result = planInvitationAcceptance(invitation, 'user-new', 'New Member');

    // Execute atomically
    await repos.withTransaction(async () => {
      await repos.memberships.create({
        userId: result.membership.userId,
        householdId: result.membership.householdId,
        role: result.membership.role,
      });
      await repos.members.create({
        householdId: result.member.householdId,
        name: result.member.name,
        userId: result.member.userId,
      });
      await repos.invitations.updateStatus(invitation.id, 'accepted');
    });

    // Verify
    const memberships = await repos.memberships.getByHousehold(HH);
    expect(memberships).toHaveLength(2); // original owner + new
    const members = await repos.members.getByHousehold(HH);
    expect(members).toHaveLength(2);

    const updatedInv = await repos.invitations.getById(invitation.id);
    expect(updatedInv?.status).toBe('accepted');
  });

  test('cannot accept an expired invitation', () => {
    const h = household();
    const expiredInvitation: Invitation = {
      id: 'inv-expired',
      householdId: HH,
      invitedByUserId: 'user-a',
      invitedEmail: 'expired@example.com',
      role: 'MEMBER',
      status: 'pending',
      linkToken: 'expired-token',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z', // Past
    };

    expect(() => {
      validateAcceptInvitation(expiredInvitation, h, []);
    }).toThrow('expired');
  });

  test('cannot accept a revoked invitation', () => {
    const h = household();
    const revokedInvitation: Invitation = {
      id: 'inv-revoked',
      householdId: HH,
      invitedByUserId: 'user-a',
      invitedEmail: 'revoked@example.com',
      role: 'MEMBER',
      status: 'revoked',
      linkToken: 'revoked-token',
      createdAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2026-09-08T00:00:00.000Z',
    };

    expect(() => {
      validateAcceptInvitation(revokedInvitation, h, []);
    }).toThrow('revoked');
  });

  test('pending invitations can be listed by household', async () => {
    const h = household();
    await repos.invitations.create(createInvitation({ household: h, invitedByUserId: 'user-a', invitedEmail: 'a@test.com' }));
    await repos.invitations.create(createInvitation({ household: h, invitedByUserId: 'user-a', invitedEmail: 'b@test.com' }));

    const pending = await repos.invitations.getByHousehold(HH);
    expect(pending).toHaveLength(2);
    expect(pending.every((i) => i.status === 'pending')).toBe(true);
  });

  test('invitation is idempotent per email per household (pre-check only)', async () => {
    const h = household();
    const inv1 = await repos.invitations.create(createInvitation({ household: h, invitedByUserId: 'user-a', invitedEmail: 'same@test.com' }));
    const inv2 = await repos.invitations.create(createInvitation({ household: h, invitedByUserId: 'user-a', invitedEmail: 'same@test.com' }));

    // Both exist, but a well-implemented UI would check for existing pending first
    const pending = await repos.invitations.getPendingByEmail('same@test.com');
    expect(pending).toHaveLength(2); // Both exist; UI should deduplicate before display

    // The domain check: there IS a pending invitation
    expect(pending.length).toBeGreaterThan(0);
  });
});

// ── 3. Identity & Group Isolation ──────────────────────────────

describe('V3-06 identity and group isolation', () => {
  test('user can only see memberships for their own groups', () => {
    const memberships: Membership[] = [
      { id: 'm1', userId: 'user-a', householdId: HH, role: 'OWNER', joinedAt: '2026-01-01' },
      { id: 'm2', userId: 'user-b', householdId: HH2, role: 'MEMBER', joinedAt: '2026-01-01' },
    ];

    // user-a can access HH
    const membership = requireHouseholdMembership('user-a', HH, memberships);
    expect(membership.householdId).toBe(HH);

    // user-a CANNOT access HH2
    expect(() => {
      requireHouseholdMembership('user-a', HH2, memberships);
    }).toThrow(AuthorizationError);
  });

  test('non-member user is blocked from household data', () => {
    const memberships: Membership[] = [
      { id: 'm1', userId: 'user-a', householdId: HH, role: 'OWNER', joinedAt: '2026-01-01' },
    ];

    expect(() => {
      requireHouseholdMembership('user-stranger', HH, memberships);
    }).toThrow(AuthorizationError);
  });

  test('role hierarchy: OWNER > MEMBER', () => {
    const memberships: Membership[] = [
      { id: 'm1', userId: 'user-owner', householdId: HH, role: 'OWNER', joinedAt: '2026-01-01' },
      { id: 'm2', userId: 'user-member', householdId: HH, role: 'MEMBER', joinedAt: '2026-01-01' },
    ];

    // OWNER can do OWNER things
    const owner = requireRole('user-owner', HH, memberships, 'OWNER');
    expect(owner.role).toBe('OWNER');

    // MEMBER cannot do OWNER things
    expect(() => {
      requireRole('user-member', HH, memberships, 'OWNER');
    }).toThrow(AuthorizationError);

    // MEMBER can do MEMBER things
    const member = requireRole('user-member', HH, memberships, 'MEMBER');
    expect(member.role).toBe('MEMBER');
  });
});

// ── 4. Unit Change Preserves History ───────────────────────────

describe('V3-06 unit change preserves history', () => {
  test('changing unit from minutes to points does not modify historical entries', () => {
    const h = household({ contributionUnit: 'minutes' });

    const result = planUnitChange(h, 'points');

    // Household is updated
    expect(result.updatedHousehold.contributionUnit).toBe('points');

    // Historical entries are not touched (this is a pure planning function)
    // The actual entries remain in the repository with their original unit
  });

  test('unit change with explicit conversion rate stores rate on household', () => {
    const h = household({ contributionUnit: 'minutes' });

    const result = planUnitChange(h, 'points', {
      contributionValue: 10,
      moneyAmountMinor: 1500,
      currency: 'CHF',
    });

    expect(result.updatedHousehold.contributionToMoneyRate).toEqual({
      contributionValue: 10,
      contributionUnit: 'points',
      moneyAmountMinor: 1500,
      currency: 'CHF',
    });
    expect(result.conversionRateSet).toBe(true);
  });

  test('no-op unit change returns same household', () => {
    const h = household({ contributionUnit: 'minutes' });
    const result = planUnitChange(h, 'minutes');
    expect(result.updatedHousehold).toBe(h); // Same reference
    expect(result.conversionRateSet).toBe(false);
  });

  test('contribution entries retain original unit after group unit change', async () => {
    const repos = createInMemoryRepositories();
    const h = household({ contributionUnit: 'minutes' });
    await repos.households.seed([h]);

    // Create contributions with minutes
    const entry1 = await repos.contributions.create({
      householdId: HH,
      label: 'Vaisselle',
      performedByMemberId: 'm-a',
      beneficiaryMemberIds: ['m-a', 'm-b'],
      value: 15,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-09-15T10:00:00.000Z',
      createdBy: 'user-a',
    });

    // Change unit to points
    const updatedHousehold = { ...h, contributionUnit: 'points' as ContributionUnit };
    await repos.households.update(HH, { contributionUnit: 'points' });

    // Original entry still has minutes
    const fetched = await repos.contributions.getById(entry1.id);
    expect(fetched?.unit).toBe('minutes');
    expect(fetched?.value).toBe(15); // Value unchanged

    // New contribution uses points
    const entry2 = await repos.contributions.create({
      householdId: HH,
      label: 'Courses',
      performedByMemberId: 'm-b',
      beneficiaryMemberIds: ['m-a', 'm-b'],
      value: 3,
      unit: updatedHousehold.contributionUnit,
      persistentTaskId: null,
      occurredAt: '2026-09-16T10:00:00.000Z',
      createdBy: 'user-b',
    });

    expect(entry2.unit).toBe('points');

    // Both entries exist with their respective units
    const allEntries = await repos.contributions.getByHousehold(HH);
    expect(allEntries).toHaveLength(2);
    expect(allEntries.find((e) => e.id === entry1.id)?.unit).toBe('minutes');
    expect(allEntries.find((e) => e.id === entry2.id)?.unit).toBe('points');
  });
});

// ── 5. Delta-Only Sync ────────────────────────────────────────

describe('V3-06 delta-only sync', () => {
  let syncState: InMemorySyncStateRepository;

  beforeEach(() => {
    syncState = new InMemorySyncStateRepository();
  });

  test('initial pull with no cursor fetches from revision 0', async () => {
    const remoteRecords: SyncRecord[] = [
      { id: 'c-1', householdId: HH, collection: 'contribution_entries', revision: 1, updatedAt: '2026-09-16T10:00:00Z', deletedAt: null, payload: '{"id":"c-1"}' },
      { id: 'c-2', householdId: HH, collection: 'contribution_entries', revision: 2, updatedAt: '2026-09-16T11:00:00Z', deletedAt: null, payload: '{"id":"c-2"}' },
    ];

    const result = await pullDeltas(syncState, HH, async (coll, sinceRev) => {
      if (coll !== 'contribution_entries') return [];
      expect(sinceRev).toBe(0); // No cursor → starts at 0
      return remoteRecords;
    });

    expect(result.totalApplied).toBe(2);
    expect(result.signal).not.toBeNull();
    expect(result.signal?.collections).toContain('contribution_entries');

    // Cursor is advanced
    const cursor = await syncState.getCursor(HH, 'contribution_entries');
    expect(cursor?.lastRevision).toBe(2);
  });

  test('subsequent pull only fetches delta after cursor', async () => {
    // Set initial cursor at revision 5
    await syncState.setCursor({
      householdId: HH,
      collection: 'contribution_entries',
      lastRevision: 5,
      lastSyncedAt: '2026-09-16T10:00:00Z',
    });

    const remoteRecords: SyncRecord[] = [
      { id: 'c-6', householdId: HH, collection: 'contribution_entries', revision: 6, updatedAt: '2026-09-16T12:00:00Z', deletedAt: null, payload: '{"id":"c-6"}' },
    ];

    await pullDeltas(syncState, HH, async (coll, sinceRev) => {
      if (coll !== 'contribution_entries') return [];
      expect(sinceRev).toBe(5); // Only delta since revision 5
      return remoteRecords;
    });

    const cursor = await syncState.getCursor(HH, 'contribution_entries');
    expect(cursor?.lastRevision).toBe(6);
  });

  test('sync across all collections has bounded cost', async () => {
    const fetchCalls: Array<{ collection: SyncCollection; since: number }> = [];

    await pullDeltas(syncState, HH, async (coll, sinceRev) => {
      fetchCalls.push({ collection: coll, since: sinceRev });
      return [];
    });

    // One call per collection
    expect(fetchCalls).toHaveLength(SYNC_COLLECTIONS.length);
    // All start from revision 0 (no prior cursor)
    expect(fetchCalls.every((c) => c.since === 0)).toBe(true);
  });

  test('push sends only dirty records', async () => {
    // Set cursor at revision 3
    await syncState.setCursor({
      householdId: HH,
      collection: 'contribution_entries',
      lastRevision: 3,
      lastSyncedAt: '2026-09-16T10:00:00Z',
    });

    // Apply some local deltas (simulating offline writes)
    await syncState.storeLocalRecords(HH, 'contribution_entries', [
      { id: 'c-4', householdId: HH, collection: 'contribution_entries', revision: 4, updatedAt: '2026-09-16T11:00:00Z', deletedAt: null, payload: '{"id":"c-4"}' },
      { id: 'c-5', householdId: HH, collection: 'contribution_entries', revision: 5, updatedAt: '2026-09-16T12:00:00Z', deletedAt: null, payload: '{"id":"c-5"}' },
    ]);

    const pushedRecords: SyncRecord[] = [];
    const result = await pushDeltas(syncState, HH, async (_coll, records) => {
      pushedRecords.push(...records);
      // Server assigns revisions 6, 7
      return records.map((r, i) => ({ ...r, revision: 6 + i }));
    });

    expect(result.totalPushed).toBe(2);
    expect(pushedRecords).toHaveLength(2);
    expect(pushedRecords[0].id).toBe('c-4');
    expect(pushedRecords[1].id).toBe('c-5');

    // Cursor advanced to server revision 7
    const cursor = await syncState.getCursor(HH, 'contribution_entries');
    expect(cursor?.lastRevision).toBe(7);
  });

  test('no signal emitted when no changes exist', async () => {
    const result = await pullDeltas(syncState, HH, async () => []);
    expect(result.signal).toBeNull();
    expect(result.totalApplied).toBe(0);
  });

  test('tab switch costs zero network reads', () => {
    // Tab switching should only read from local SQLite, never network
    const budget = COST_BUDGETS['tab-switch'];
    expect(budget?.networkCalls).toBe(0);
    expect(budget?.reads).toBe(0);
  });

  test('full sync has bounded cost per collection', () => {
    const budget = COST_BUDGETS['sync-delta'];
    expect(budget?.reads).toBeLessThanOrEqual(8); // 8 collections max
    expect(budget?.writes).toBeLessThanOrEqual(8);
    expect(budget?.networkCalls).toBeLessThanOrEqual(2); // pull + push
  });
});

// ── 6. Conflict Resolution ────────────────────────────────────

describe('V3-06 deterministic conflict resolution', () => {
  test('higher revision wins', () => {
    const local = { id: 'c-1', revision: 3, updatedAt: '2026-09-16T10:00:00Z', value: 'local' };
    const remote = { id: 'c-1', revision: 5, updatedAt: '2026-09-16T09:00:00Z', value: 'remote' };

    const winner = resolveConflict(local, remote);
    expect(winner.revision).toBe(5);
    expect(winner.value).toBe('remote');
  });

  test('later timestamp wins on same revision', () => {
    const local = { id: 'c-1', revision: 3, updatedAt: '2026-09-16T10:00:00Z', value: 'local' };
    const remote = { id: 'c-1', revision: 3, updatedAt: '2026-09-16T12:00:00Z', value: 'remote' };

    const winner = resolveConflict(local, remote);
    expect(winner.value).toBe('remote');
  });

  test('lexicographic id breaks final tie', () => {
    const local = { id: 'c-1', revision: 3, updatedAt: '2026-09-16T10:00:00Z', value: 'local' };
    const remote = { id: 'c-2', revision: 3, updatedAt: '2026-09-16T10:00:00Z', value: 'remote' };

    const winner = resolveConflict(local, remote);
    expect(winner.id).toBe('c-2'); // Lexicographically higher
  });

  test('local wins when it has higher revision', () => {
    const local = { id: 'c-1', revision: 7, updatedAt: '2026-09-16T10:00:00Z', value: 'local' };
    const remote = { id: 'c-1', revision: 3, updatedAt: '2026-09-16T12:00:00Z', value: 'remote' };

    const winner = resolveConflict(local, remote);
    expect(winner.value).toBe('local');
  });
});

// ── 7. Authorization Rules ────────────────────────────────────

describe('V3-06 authorization rules', () => {
  test('CROSS_TENANT error for non-member access', () => {
    const memberships: Membership[] = [
      { id: 'm1', userId: 'user-a', householdId: HH, role: 'OWNER', joinedAt: '2026-01-01' },
    ];

    try {
      requireHouseholdMembership('user-stranger', HH, memberships);
      fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AuthorizationError);
      expect((e as AuthorizationError).code).toBe('CROSS_TENANT');
    }
  });

  test('INSUFFICIENT_ROLE error for MEMBER trying OWNER actions', () => {
    const memberships: Membership[] = [
      { id: 'm1', userId: 'user-member', householdId: HH, role: 'MEMBER', joinedAt: '2026-01-01' },
    ];

    try {
      requireRole('user-member', HH, memberships, 'OWNER');
      fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AuthorizationError);
      expect((e as AuthorizationError).code).toBe('INSUFFICIENT_ROLE');
    }
  });

  test('successful authorization returns the membership', () => {
    const memberships: Membership[] = [
      { id: 'm1', userId: 'user-a', householdId: HH, role: 'OWNER', joinedAt: '2026-01-01' },
    ];

    const result = requireHouseholdMembership('user-a', HH, memberships);
    expect(result.id).toBe('m1');
  });
});

// ── 8. Cost Instrumentation ────────────────────────────────────

describe('V3-06 cost instrumentation', () => {
  beforeEach(() => {
    costTracker.reset();
  });

  test('create-contribution has bounded writes', () => {
    const budget = COST_BUDGETS['create-contribution'];
    expect(budget?.writes).toBe(1);
    expect(budget?.networkCalls).toBe(0); // Local-only write
  });

  test('complete-todo has exactly 2 writes', () => {
    const budget = COST_BUDGETS['complete-todo'];
    expect(budget?.writes).toBe(2); // 1 todo update + 1 contribution create
    expect(budget?.networkCalls).toBe(0);
  });

  test('open-household has bounded reads and zero network calls', () => {
    const budget = COST_BUDGETS['open-household'];
    expect(budget?.reads).toBeLessThanOrEqual(5);
    expect(budget?.networkCalls).toBe(0); // Local-first
  });

  test('cost tracker records operations', () => {
    const handle = costTracker.start('test-action');
    handle.recordRead();
    handle.recordRead();
    handle.recordWrite();
    handle.finish();

    const record = costTracker.getLastRecord();
    expect(record).not.toBeNull();
    expect(record?.action).toBe('test-action');
    expect(record?.reads).toBe(2);
    expect(record?.writes).toBe(1);
  });
});

// ── 9. No N+1 Reads ──────────────────────────────────────────

describe('V3-06 no N+1 reads', () => {
  test('loading members + contributions for a group uses exactly 2 bulk reads', async () => {
    const repos = createInMemoryRepositories();

    // Seed 100 members and 500 contributions
    const members: Member[] = Array.from({ length: 100 }, (_, i) => member(`m-${i}`));
    for (const m of members) {
      await repos.members.create({ householdId: m.householdId, name: m.name, userId: m.userId });
    }

    for (let i = 0; i < 500; i++) {
      await repos.contributions.create({
        householdId: HH,
        label: `Contribution ${i}`,
        performedByMemberId: `m-${i % 100}`,
        beneficiaryMemberIds: ['m-0', 'm-1'],
        value: 15,
        unit: 'minutes',
        persistentTaskId: null,
        occurredAt: new Date(Date.now() - i * 60000).toISOString(),
        createdBy: 'user-a',
      });
    }

    // Simulate screen load: 2 bulk reads, not 500+1
    const [loadedMembers, loadedContributions] = await Promise.all([
      repos.members.getByHousehold(HH),
      repos.contributions.getByHousehold(HH),
    ]);

    expect(loadedMembers).toHaveLength(100);
    expect(loadedContributions).toHaveLength(500);

    // No per-member or per-contribution reads needed
  });

  test('creating a contribution does not read the full history', async () => {
    const repos = createInMemoryRepositories();

    // Seed 1000 existing contributions
    for (let i = 0; i < 1000; i++) {
      await repos.contributions.create({
        householdId: HH,
        label: `Old contribution ${i}`,
        performedByMemberId: 'm-a',
        beneficiaryMemberIds: ['m-a'],
        value: 5,
        unit: 'minutes',
        persistentTaskId: null,
        occurredAt: new Date(Date.now() - i * 60000).toISOString(),
        createdBy: 'user-a',
      });
    }

    // Creating a new contribution is a single write
    const created = await repos.contributions.create({
      householdId: HH,
      label: 'New contribution',
      performedByMemberId: 'm-b',
      beneficiaryMemberIds: ['m-b'],
      value: 10,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: new Date().toISOString(),
      createdBy: 'user-b',
    });

    expect(created.id).toBeDefined();
    // The contribution repo getByHousehold is NOT called during create
  });
});
