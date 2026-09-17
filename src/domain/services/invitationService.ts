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
  invitedEmail: string;
  role?: MembershipRole;
}

export interface AcceptInvitationInput {
  invitation: Invitation;
  userId: string;
  displayName: string;
}

export interface InvitationResult {
  membership: Membership;
  member: Member;
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
  if (!input.invitedEmail || !input.invitedEmail.includes('@')) {
    throw new Error('A valid email is required');
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
    invitedEmail: input.invitedEmail,
    role: input.role ?? 'MEMBER',
    status: 'pending',
    linkToken: generateLinkToken(),
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
 */
export function planInvitationAcceptance(
  invitation: Invitation,
  userId: string,
  displayName: string,
): InvitationResult {
  const nowIso = new Date().toISOString();

  const membership: Membership = {
    id: `membership-${invitation.id}-${userId}`,
    userId,
    householdId: invitation.householdId,
    role: invitation.role,
    joinedAt: nowIso,
  };

  const member: Member = {
    id: `member-${invitation.id}-${userId}`,
    householdId: invitation.householdId,
    name: displayName,
    userId,
    joinedAt: nowIso,
  };

  return { membership, member };
}
