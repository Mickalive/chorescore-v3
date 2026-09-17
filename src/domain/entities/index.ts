/**
 * ChoreScore V3 — core domain entities.
 *
 * Domain code remains provider-independent. Historical ledger entries carry
 * the unit/currency that applied when they were created so later group
 * configuration changes never reinterpret history silently.
 */

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export type MembershipRole = 'MEMBER' | 'OWNER';

export interface Membership {
  id: string;
  userId: string;
  householdId: string;
  role: MembershipRole;
  joinedAt: string;
}

export type ContributionUnit = 'minutes' | 'points';

export interface ContributionMoneyRate {
  contributionValue: number;
  contributionUnit: ContributionUnit;
  moneyAmountMinor: number;
  currency: string;
}

export interface Household {
  id: string;
  name: string;
  ownerId: string;
  contributionUnit: ContributionUnit;
  crossLedgerCompensationEnabled: boolean;
  contributionToMoneyRate: ContributionMoneyRate | null;
  createdAt: string;
}

export interface Member {
  id: string;
  householdId: string;
  name: string;
  userId: string;
  joinedAt: string;
}

export interface ContributionEntry {
  id: string;
  householdId: string;
  label: string;
  performedByMemberId: string;
  beneficiaryMemberIds: string[];
  value: number;
  unit: ContributionUnit;
  persistentTaskId: string | null;
  occurredAt: string;
  createdBy: string;
  modifiedBy?: string;
}

export interface PersistentTask {
  id: string;
  householdId: string;
  name: string;
  defaultValue: number;
  defaultUnit: ContributionUnit;
  defaultBeneficiaryMemberIds?: string[];
  createdAt: string;
}

export interface TodoItem {
  id: string;
  householdId: string;
  title: string;
  assigneeMemberId: string | null;
  beneficiaryMemberIds: string[];
  dueAt: string | null;
  reminderAt: string | null;
  notes: string;
  persistentTaskId: string | null;
  status: 'todo' | 'in-progress' | 'completed';
  createdAt: string;
  completedAt?: string;
}

export type ExpenseSplitMode = 'equal' | 'custom';

export interface ExpenseParticipantShare {
  memberId: string;
  amountMinor: number;
}

export interface ExpenseEntry {
  id: string;
  householdId: string;
  title: string;
  amountMinor: number;
  currency: string;
  paidByMemberId: string;
  participantMemberIds: string[];
  splitMode: ExpenseSplitMode;
  customShares?: ExpenseParticipantShare[];
  note?: string;
  category?: string;
  occurredAt: string;
  createdBy: string;
  modifiedBy?: string;
}

/**
 * A cross-ledger settlement consumes contribution credit held by
 * contributionCreditorMemberId and uses it to reduce that member's money
 * debt toward counterpartyMemberId.
 */
export interface CrossLedgerSettlement {
  id: string;
  householdId: string;
  contributionCreditorMemberId: string;
  counterpartyMemberId: string;
  contributionValue: number;
  contributionUnit: ContributionUnit;
  moneyAmountMinor: number;
  currency: string;
  rateSnapshot: ContributionMoneyRate;
  occurredAt: string;
  createdBy: string;
}

export interface Balance {
  memberId: string;
  value: number;
}

export interface MoneyBalance {
  memberId: string;
  amountMinor: number;
  currency: string;
}

export interface ContributionTransfer {
  fromMemberId: string;
  toMemberId: string;
  value: number;
  unit: ContributionUnit;
}

export interface MoneyTransfer {
  fromMemberId: string;
  toMemberId: string;
  amountMinor: number;
  currency: string;
}

export type ActivityEntry =
  | { type: 'contribution'; entry: ContributionEntry }
  | { type: 'expense'; entry: ExpenseEntry }
  | { type: 'cross-ledger-settlement'; entry: CrossLedgerSettlement };

// ── V3-06: Invitations ─────────────────────────────────────────

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';

export interface Invitation {
  id: string;
  householdId: string;
  invitedByUserId: string;
  invitedEmail: string;
  role: MembershipRole;
  status: InvitationStatus;
  /** Opaque token embedded in the share link / deep-link. */
  linkToken: string;
  createdAt: string;
  expiresAt: string;
}

// ── V3-06: Sync cursors & revisions ────────────────────────────

/**
 * Per-group sync cursor stored locally.  Each client tracks the last
 * revision it successfully pulled for each collection so the next sync
 * fetches only the delta.
 */
export interface SyncCursor {
  householdId: string;
  collection: SyncCollection;
  lastRevision: number;
  lastSyncedAt: string;
}

export type SyncCollection =
  | 'contribution_entries'
  | 'expense_entries'
  | 'settlements'
  | 'todo_items'
  | 'persistent_tasks'
  | 'members'
  | 'memberships'
  | 'households';

/**
 * A single revisioned change record.  Used by the sync engine to represent
 * an upsert or tombstone in a delta-only protocol.
 */
export interface SyncRecord {
  id: string;
  householdId: string;
  collection: SyncCollection;
  revision: number;
  /** ISO timestamp of the last mutation. */
  updatedAt: string;
  /** Null for upserts, non-null for soft-deletes. */
  deletedAt: string | null;
  /** Serialized entity payload (JSON).  Absent for tombstones. */
  payload: string | null;
}

/**
 * Lightweight change signal emitted by the sync engine when new deltas
 * have been applied.  Screens subscribe and refresh only affected data
 * instead of doing a full re-read.
 */
export interface SyncChangeSignal {
  householdId: string;
  collections: SyncCollection[];
  receivedAt: string;
}
