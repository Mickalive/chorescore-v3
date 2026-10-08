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
  /**
   * Linked account id, or null for a named member.
   *
   * V4: a group can be created with member names before anyone has an
   * account. A named member (userId === null) is still exactly one member
   * identity in every ledger; when that person later joins, the same member
   * record is linked (userId becomes a user id) without rewriting history.
   */
  userId: string | null;
  joinedAt: string;
}

export type MemberIdentityKind = 'named' | 'linked';

/** Named member: created from a name only, not yet linked to an account. */
export function isNamedMember(member: Pick<Member, 'userId'>): boolean {
  return memberIdentityKind(member) === 'named';
}

/** Linked member: tied to an authenticated account. */
export function isLinkedMember(member: Pick<Member, 'userId'>): boolean {
  return memberIdentityKind(member) === 'linked';
}

/**
 * Distinguish the two member identities without ever merging them:
 * a named member must never be treated as an account, and two different
 * names must never collapse into one identity.
 */
export function memberIdentityKind(member: Pick<Member, 'userId'>): MemberIdentityKind {
  return member.userId === null || member.userId === undefined || member.userId === ''
    ? 'named'
    : 'linked';
}

// ── V4-01: Categories (user-created only, never seeded) ────────

/**
 * Weighted ratio used by an equal-percentage task split.
 * Weights are group-defined numbers; ChoreScore never imposes a taxonomy.
 */
export interface TaskSplitWeight {
  memberId: string;
  weight: number;
}

export type TaskSplitMode = 'equal' | 'custom';

/**
 * Where an entry's split came from at creation time.
 * `category-default` entries carry a snapshot of the category ratio, so
 * later category edits or deletions never reinterpret history.
 */
export type TaskSplitSource = 'equal' | 'custom' | 'category-default';

export interface Category {
  id: string;
  householdId: string;
  name: string;
  /** Default task ratio for new tasks in this category; null means equal split. */
  defaultTaskRatio: TaskSplitWeight[] | null;
  createdAt: string;
  updatedAt: string;
}

// ── V4-01: Attachments (provider-agnostic) ─────────────────────

export type AttachmentKind = 'photo';

/**
 * A photo attached to a task or expense.
 * `ref` is an opaque provider reference (file id or local uri): no provider
 * type ever reaches the domain, and the reference never leaves the device.
 */
export interface Attachment {
  id: string;
  kind: AttachmentKind;
  ref: string;
  mimeType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
  createdAt: string;
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
  /** Optional user-created category reference. */
  categoryId?: string | null;
  /** Category name captured at creation; keeps history readable after a rename. */
  categoryLabelSnapshot?: string;
  /** Optional free note (operational data only — never exported to analytics). */
  note?: string;
  /** Optional photo attachments (provider-agnostic references). */
  attachments?: Attachment[];
  /** Defaults to 'equal' when absent (V3 entries are always equal split). */
  splitMode?: TaskSplitMode;
  /** Snapshot of the split ratio used for this entry. */
  splitWeights?: TaskSplitWeight[];
  /** Provenance of the split (equal / custom / category-default). */
  splitSource?: TaskSplitSource;
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

/**
 * V4-01: a todo is either a task (contribution ledger) or an expense
 * (money ledger). Completion of either kind stays atomic: one todo update,
 * exactly one ledger entry.
 */
export type TodoKind = 'task' | 'expense';

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
  /** Defaults to 'task' when absent (V3 todos are tasks). */
  kind?: TodoKind;
  categoryId?: string | null;
  /** Default amount for an expense todo (integer minor units). */
  expenseAmountMinor?: number;
  expenseCurrency?: string;
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
  /** Display label kept by the entry (V3 behaviour). */
  category?: string;
  /** Optional user-created category reference. */
  categoryId?: string | null;
  /** Category name captured at creation; keeps history readable after a rename. */
  categoryLabelSnapshot?: string;
  /** Optional photo attachments (provider-agnostic references). */
  attachments?: Attachment[];
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
