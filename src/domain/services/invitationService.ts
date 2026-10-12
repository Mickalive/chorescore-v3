/**
 * ChoreScore V3 — Invitation Service
 *
 * Manages the lifecycle of group invitations:
 *   1. Owner creates an invitation → generates a link token.
 *   2. Link is shared via system share sheet / deep-link.
 *   3. Recipient accepts → membership is created atomically.
 *
 * Invariants:
 *   - One pending invitation per email per household (idempotent).
 *   - Link tokens are opaque and collision-resistant (24 hex chars).
 *   - Accepting an expired/revoked invitation fails.
 *   - Accepting creates both membership and member atomically.
 *   - No premium gating, no plan limits.
 */

import { Household, Invitation, Membership, Member, MembershipRole } from '../entities';

export interface CreateInvitationInput {
  household: Household;
  invitedByUserId: string;
  /**
   * V4-03: invitations are shared by link. An email is optional context only
   * (e.g. pre-filled recipient); a link-only invitation has no email and is
   * still a complete, shareable invitation.
   */
  invitedEmail?: string;
  role?: MembershipRole;
  /**
   * V4-09: when set, the invitation is targeted at an existing named member
   * of the household. Accepting it links that member to the accepting
   * account (same member id, no duplicate) instead of creating a new member.
   */
  targetMemberId?: string | null;
}

export interface AcceptInvitationInput {
  invitation: Invitation;
  userId: string;
  displayName: string;
}

export interface InvitationResult {
  membership: Membership;
  member: Member;
  /**
   * V4-09: true when the acceptance linked an existing named member (the
   * caller must update that member's userId instead of creating a new one).
   */
  linksExistingMember: boolean;
}

/**
 * Generate a cryptographically-random link token.
 * 24 hex chars ≈ 96 bits of entropy, collision-resistant for invitation scale.
 */
function generateLinkToken(): string {
  const bytes = new Uint8Array(12);
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Fallback for Node test environment
    for (let i = 0; i < 12; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validate invitation creation inputs.
 */
export function validateCreateInvitation(input: CreateInvitationInput): void {
  const email = input.invitedEmail?.trim();
  if (email && !email.includes('@')) {
    throw new Error('A valid email is required when one is provided');
  }
  if (!input.invitedByUserId) {
    throw new Error('Inviter user ID is required');
  }
  if (!input.household.id) {
    throw new Error('Household ID is required');
  }
}

/**
 * Create a new invitation record.
 * The caller is responsible for persisting the invitation and checking
 * for an existing pending invitation (idempotency).
 */
export function createInvitation(input: CreateInvitationInput): Omit<Invitation, 'id' | 'createdAt'> {
  validateCreateInvitation(input);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  return {
    householdId: input.household.id,
    invitedByUserId: input.invitedByUserId,
    invitedEmail: input.invitedEmail?.trim() ?? '',
    role: input.role ?? 'MEMBER',
    status: 'pending',
    linkToken: generateLinkToken(),
    targetMemberId: input.targetMemberId ?? null,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Validate that an invitation can be accepted.
 *
 * @param currentMemberships - memberships already scoped to this household.
 * @param invitedUserId - the userId of the person accepting (may differ from email).
 */
export function validateAcceptInvitation(
  invitation: Invitation,
  household: Household,
  currentMemberships: Membership[],
  invitedUserId?: string,
): void {
  if (invitation.status !== 'pending') {
    throw new Error(`Invitation is ${invitation.status}, not pending`);
  }

  if (new Date(invitation.expiresAt) < new Date()) {
    throw new Error('Invitation has expired');
  }

  if (invitation.householdId !== household.id) {
    throw new Error('Invitation does not belong to this household');
  }

  // Already a member?
  if (invitedUserId) {
    const alreadyMember = currentMemberships.some((m) => m.userId === invitedUserId);
    if (alreadyMember) {
      throw new Error('User is already a member of this household');
    }
  }
}

/**
 * Plan the atomic membership + member creation from an accepted invitation.
 * Returns the data for both records. The caller executes them in a transaction.
 *
 * V4-09: when the invitation targets an existing named member
 * (`invitation.targetMemberId`), the acceptance LINKS that member to the
 * accepting account instead of creating a new member. The link is validated
 * strictly:
 *   - the target member must exist and belong to the invitation's household;
 *   - the target member must still be named (userId === null) — an already
 *     linked member can never be linked twice;
 *   - the caller must pass the exact member referenced by the invitation —
 *     matching by name is never allowed, so two people with the same name can
 *     never collapse into one identity.
 */
export function planInvitationAcceptance(
  invitation: Invitation,
  userId: string,
  displayName: string,
  existingMember?: Member | null,
): InvitationResult {
  const nowIso = new Date().toISOString();

  const membership: Membership = {
    id: `membership-${invitation.id}-${userId}`,
    userId,
    householdId: invitation.householdId,
    role: invitation.role,
    joinedAt: nowIso,
  };

  if (invitation.targetMemberId) {
    if (!existingMember) {
      throw new Error('This invitation targets a named member that could not be resolved');
    }
    if (existingMember.id !== invitation.targetMemberId) {
      throw new Error('Invitation targets a different member');
    }
    if (existingMember.householdId !== invitation.householdId) {
      throw new Error('Invitation target does not belong to this household');
    }
    if (existingMember.userId !== null && existingMember.userId !== undefined && existingMember.userId !== '') {
      throw new Error('Invitation target is already linked to an account');
    }
    return {
      membership,
      member: { ...existingMember, userId },
      linksExistingMember: true,
    };
  }

  const member: Member = {
    id: `member-${invitation.id}-${userId}`,
    householdId: invitation.householdId,
    name: displayName,
    userId,
    joinedAt: nowIso,
  };

  return { membership, member, linksExistingMember: false };
}
