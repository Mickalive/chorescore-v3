/**
 * ChoreScore V4 — Group creation & member management use-cases
 *
 * A group can be created with the names of the people already in it, before
 * anyone of them has an account. Each named person becomes exactly one member
 * identity (`userId === null`) that every ledger can reference immediately;
 * when that person later joins, the same member record is linked to an account
 * without rewriting history (see `Member` in the domain entities).
 *
 * Both operations run inside a single repository transaction so a partially
 * built group can never be observed: either the group + owner + named members
 * all exist, or none do.
 *
 * Free for all. No premium gating, no member limit.
 */

import { ContributionUnit, Household, Member } from '../../domain/entities';
import { AllRepositories } from '../../infrastructure/repositories/RepositoryFactory';

/** Named-member names are short labels, not free-form profile text. */
export const MEMBER_NAME_MAX_LENGTH = 60;

/**
 * Normalize a member name: trim, collapse internal whitespace and enforce a
 * bounded length. An empty name is rejected instead of silently creating an
 * anonymous member.
 */
export function normalizeMemberName(raw: string): string {
  if (typeof raw !== 'string') {
    throw new Error('Member name must be a string');
  }
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) {
    throw new Error('Member name must be non-empty');
  }
  if (name.length > MEMBER_NAME_MAX_LENGTH) {
    throw new Error(`Member name must be at most ${MEMBER_NAME_MAX_LENGTH} characters`);
  }
  return name;
}

/** A named member draft, ready to persist (no account linked yet). */
export interface NamedMemberDraft {
  householdId: string;
  name: string;
  userId: null;
}

/**
 * Build the named-member drafts for a new group. Blank entries are skipped so a
 * trailing empty input row never creates a phantom member; invalid non-blank
 * names throw so the caller can surface a validation error.
 */
export function buildNamedMembers(
  householdId: string,
  names: readonly string[] = [],
): NamedMemberDraft[] {
  if (!householdId) {
    throw new Error('householdId is required');
  }
  const drafts: NamedMemberDraft[] = [];
  for (const raw of names) {
    if (typeof raw !== 'string' || raw.trim() === '') {
      continue;
    }
    drafts.push({ householdId, name: normalizeMemberName(raw), userId: null });
  }
  return drafts;
}

export interface CreateGroupInput {
  name: string;
  owner: { userId: string; displayName: string };
  /** Names of the other members, entered at creation time. */
  memberNames?: readonly string[];
  contributionUnit?: ContributionUnit;
}

export interface CreateGroupResult {
  household: Household;
  ownerMember: Member;
  namedMembers: Member[];
}

/**
 * Create a group, its OWNER membership, the owner's linked member and every
 * named member in one transaction.
 */
export async function createGroupWithMembers(
  repos: AllRepositories,
  input: CreateGroupInput,
): Promise<CreateGroupResult> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) {
    throw new Error('Group name is required');
  }
  if (!input.owner?.userId) {
    throw new Error('An owner is required');
  }
  // Validate every member name before writing anything, so an invalid entry
  // fails fast rather than mid-transaction.
  const ownerName = normalizeMemberName(input.owner.displayName || 'Membre');
  const drafts = buildNamedMembers('placeholder', input.memberNames);

  let result: CreateGroupResult | null = null;

  await repos.withTransaction(async () => {
    const household = await repos.households.create({
      name,
      ownerId: input.owner.userId,
      contributionUnit: input.contributionUnit ?? 'minutes',
      crossLedgerCompensationEnabled: false,
      contributionToMoneyRate: null,
    });

    await repos.memberships.create({
      userId: input.owner.userId,
      householdId: household.id,
      role: 'OWNER',
    });

    const ownerMember = await repos.members.create({
      householdId: household.id,
      name: ownerName,
      userId: input.owner.userId,
    });

    const namedMembers: Member[] = [];
    for (const draft of drafts) {
      namedMembers.push(
        await repos.members.create({
          householdId: household.id,
          name: draft.name,
          userId: null,
        }),
      );
    }

    result = { household, ownerMember, namedMembers };
  });

  if (!result) {
    throw new Error('Group creation did not complete');
  }
  return result;
}

/**
 * Add a named member to an existing group. Used from the group's member
 * section ("ajout ultérieur"), not at creation time.
 */
export async function addGroupMember(
  repos: AllRepositories,
  householdId: string,
  rawName: string,
): Promise<Member> {
  if (!householdId) {
    throw new Error('householdId is required');
  }
  const name = normalizeMemberName(rawName);
  return repos.members.create({ householdId, name, userId: null });
}
