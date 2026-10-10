/**
 * V4-09 — Targeted invitation links the same named member (no duplicate)
 *
 * Evidence for the V4-09 acceptance item:
 *   "named member invitation links same memberId without duplicate and
 *    preserves ledger history"
 *
 * A group created with member names has exactly one member identity per
 * person (userId === null). When that person later accepts a targeted
 * invitation, the SAME member record is linked to their account:
 *   - no new member row is created (no duplicate identity);
 *   - every ledger entry that referenced the member id keeps its history;
 *   - the link is by member id, never by name — two people with the same
 *     name can never collapse into one identity;
 *   - an already-linked member can never be linked twice.
 */

import { createInMemoryRepositories } from '../../src/infrastructure/repositories/RepositoryFactory';
import { createGroupWithMembers } from '../../src/application/use-cases/groupMembers';
import {
  createInvitation,
  planInvitationAcceptance,
  validateAcceptInvitation,
} from '../../src/domain/services/invitationService';
import { Member } from '../../src/domain/entities';

describe('V4-09 targeted invitation — same memberId, no duplicate', () => {
  test('accepting a targeted invitation links the exact named member and preserves ledger history', async () => {
    const repos = createInMemoryRepositories();
    const { household, namedMembers } = await createGroupWithMembers(repos, {
      name: 'Colocation',
      owner: { userId: 'user-owner', displayName: 'Alex' },
      memberNames: ['Marie'],
    });
    const marie = namedMembers[0];
    expect(marie.userId).toBeNull();

    // Ledger history already references the named member BEFORE any account
    // exists: a contribution performed by Marie.
    await repos.contributions.create({
      householdId: household.id,
      label: 'Vaisselle',
      performedByMemberId: marie.id,
      beneficiaryMemberIds: [marie.id],
      value: 15,
      unit: 'minutes',
      persistentTaskId: null,
      occurredAt: '2026-10-01T10:00:00.000Z',
      createdBy: 'user-owner',
    });

    // The owner creates a targeted invitation for Marie.
    const invData = createInvitation({
      household,
      invitedByUserId: 'user-owner',
      targetMemberId: marie.id,
    });
    expect(invData.targetMemberId).toBe(marie.id);
    const invitation = await repos.invitations.create(invData);

    // Marie accepts with her authenticated account.
    const existingMemberships = await repos.memberships.getByHousehold(household.id);
    validateAcceptInvitation(invitation, household, existingMemberships, 'user-marie');
    const result = planInvitationAcceptance(
      invitation,
      'user-marie',
      'Marie',
      marie,
    );
    expect(result.linksExistingMember).toBe(true);
    expect(result.member.id).toBe(marie.id);

    await repos.withTransaction(async () => {
      await repos.memberships.create({
        userId: result.membership.userId,
        householdId: result.membership.householdId,
        role: result.membership.role,
      });
      await repos.members.update(result.member.id, { userId: result.member.userId });
      await repos.invitations.updateStatus(invitation.id, 'accepted');
    });

    // Exactly ONE member named Marie, with the ORIGINAL member id, now linked.
    const members = await repos.members.getByHousehold(household.id);
    expect(members).toHaveLength(2); // owner + Marie — no duplicate
    const linkedMarie = members.find((m) => m.id === marie.id);
    expect(linkedMarie).toBeDefined();
    expect(linkedMarie?.name).toBe('Marie');
    expect(linkedMarie?.userId).toBe('user-marie');
    expect(members.filter((m) => m.name === 'Marie')).toHaveLength(1);

    // Ledger history is preserved: the contribution still references the
    // same member id (no rewrite, no duplicate identity).
    const entries = await repos.contributions.getByHousehold(household.id);
    expect(entries).toHaveLength(1);
    expect(entries[0].performedByMemberId).toBe(marie.id);

    // The invitation is accepted.
    const updatedInv = await repos.invitations.getById(invitation.id);
    expect(updatedInv?.status).toBe('accepted');
  });

  test('a targeted invitation cannot link a different member (never by name)', async () => {
    const repos = createInMemoryRepositories();
    const { household, namedMembers } = await createGroupWithMembers(repos, {
      name: 'Colocation',
      owner: { userId: 'user-owner', displayName: 'Alex' },
      memberNames: ['Marie', 'Sam'],
    });
    const marie = namedMembers[0];
    const sam = namedMembers[1];

    const invData = createInvitation({
      household,
      invitedByUserId: 'user-owner',
      targetMemberId: marie.id,
    });
    const invitation = await repos.invitations.create(invData);

    // Sam tries to accept the invitation meant for Marie.
    expect(() =>
      planInvitationAcceptance(invitation, 'user-sam', 'Sam', sam),
    ).toThrow('Invitation targets a different member');
  });

  test('a targeted invitation cannot link an already-linked member', async () => {
    const repos = createInMemoryRepositories();
    const { household, namedMembers } = await createGroupWithMembers(repos, {
      name: 'Colocation',
      owner: { userId: 'user-owner', displayName: 'Alex' },
      memberNames: ['Marie'],
    });
    const marie = namedMembers[0];

    // Marie already linked her account through another invitation.
    await repos.members.update(marie.id, { userId: 'user-marie' });
    const linkedMarie = await repos.members.getById(marie.id);
    expect(linkedMarie?.userId).toBe('user-marie');

    const invData = createInvitation({
      household,
      invitedByUserId: 'user-owner',
      targetMemberId: marie.id,
    });
    const invitation = await repos.invitations.create(invData);

    expect(() =>
      planInvitationAcceptance(invitation, 'user-marie', 'Marie', linkedMarie),
    ).toThrow('already linked');
  });

  test('a targeted invitation without a resolvable member is rejected', async () => {
    const repos = createInMemoryRepositories();
    const { household } = await createGroupWithMembers(repos, {
      name: 'Colocation',
      owner: { userId: 'user-owner', displayName: 'Alex' },
      memberNames: ['Marie'],
    });

    const invData = createInvitation({
      household,
      invitedByUserId: 'user-owner',
      targetMemberId: 'member-missing',
    });
    const invitation = await repos.invitations.create(invData);

    expect(() =>
      planInvitationAcceptance(invitation, 'user-marie', 'Marie', null),
    ).toThrow('could not be resolved');
  });

  test('a link-only invitation still creates a new member', async () => {
    const repos = createInMemoryRepositories();
    const { household } = await createGroupWithMembers(repos, {
      name: 'Colocation',
      owner: { userId: 'user-owner', displayName: 'Alex' },
    });

    const invData = createInvitation({
      household,
      invitedByUserId: 'user-owner',
    });
    expect(invData.targetMemberId).toBeNull();
    const invitation = await repos.invitations.create(invData);

    const result = planInvitationAcceptance(
      invitation,
      'user-new',
      'New Member',
    );
    expect(result.linksExistingMember).toBe(false);
    expect(result.member.id).not.toMatch(/^member-missing/);

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

    const members = await repos.members.getByHousehold(household.id);
    expect(members).toHaveLength(2); // owner + new member
  });
});

describe('V4-09 member repository update', () => {
  test('update links a named member without changing its identity', async () => {
    const repos = createInMemoryRepositories();
    const { household, namedMembers } = await createGroupWithMembers(repos, {
      name: 'Colocation',
      owner: { userId: 'user-owner', displayName: 'Alex' },
      memberNames: ['Marie'],
    });
    const marie = namedMembers[0];

    const updated = await repos.members.update(marie.id, { userId: 'user-marie' });
    expect(updated.id).toBe(marie.id);
    expect(updated.householdId).toBe(household.id);
    expect(updated.name).toBe('Marie');
    expect(updated.userId).toBe('user-marie');

    const reloaded = await repos.members.getById(marie.id);
    expect(reloaded?.userId).toBe('user-marie');
    expect(reloaded?.name).toBe('Marie');
  });

  test('update records a dirty sync record for the member collection', async () => {
    const repos = createInMemoryRepositories();
    const { household, namedMembers } = await createGroupWithMembers(repos, {
      name: 'Colocation',
      owner: { userId: 'user-owner', displayName: 'Alex' },
      memberNames: ['Marie'],
    });
    const marie = namedMembers[0];

    await repos.members.update(marie.id, { userId: 'user-marie' });

    const dirty = await repos.syncState.getDirtyRecords(household.id, 'members', 0);
    const record = dirty.find((r) => r.id === marie.id);
    expect(record).toBeDefined();
    expect(record?.deletedAt).toBeNull();
    const payload = JSON.parse(record?.payload ?? '{}') as Member;
    expect(payload.userId).toBe('user-marie');
  });
});