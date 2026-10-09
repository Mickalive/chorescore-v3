/**
 * ChoreScore V4 — add-entry service (pure, UI-independent)
 *
 * Builds a valid, persistable ledger draft from the Add screen's form values:
 *   - a task draft  → `ContributionEntry` (contribution ledger, weighted split);
 *   - an expense draft → `ExpenseEntry` (money ledger, exact integer split).
 *
 * Why a service instead of inline screen code:
 *   - no accounting logic ever lives in React (V3_BACKEND_FRUGAL §8);
 *   - validation and the category-ratio snapshot are unit-testable without a
 *     renderer;
 *   - the same rules can later be reused by the To-do completion path.
 *
 * Invariants preserved:
 *   - a custom task ratio must cover every beneficiary;
 *   - an expense custom split must total exactly the amount in integer minor
 *     units (validated with the real allocation rules);
 *   - the category label/ratio is snapshoted so a later rename/edit/delete
 *     never reinterprets the stored entry;
 *   - notes/photos are optional and validated (never free-form exported).
 *
 * The builders take already-parsed numbers so parsing stays a separate,
 * independently testable concern (see the `parse*` helpers).
 */

import {
  Attachment,
  Category,
  ContributionEntry,
  ContributionUnit,
  ExpenseEntry,
  ExpenseParticipantShare,
  ExpenseSplitMode,
  TaskSplitWeight,
} from '../entities';
import { normalizeCurrency } from '../calculations/validation';
import { allocateExpense } from '../calculations/expenseLedger';
import { createAttachment, normalizeNote } from './attachmentService';
import { resolveTaskSplitForNewEntry } from './categoryService';

/** User-entered labels/titles are bounded (UI + storage cost). */
export const ADD_LABEL_MAX_LENGTH = 120;

/** Which split the user selected on a new task. */
export type TaskSplitChoice = 'equal' | 'category' | 'custom';

export type AddDraftError =
  | 'label-required'
  | 'label-too-long'
  | 'value-invalid'
  | 'performer-required'
  | 'beneficiaries-required'
  | 'task-split-invalid'
  | 'task-split-missing-weight'
  | 'amount-invalid'
  | 'currency-invalid'
  | 'paid-by-required'
  | 'participants-required'
  | 'expense-split-invalid'
  | 'note-invalid'
  | 'attachment-invalid';

export type AddDraftResult<T> =
  | { ok: true; draft: T }
  | { ok: false; error: AddDraftError };

// ── Parsing helpers (pure, independently testable) ────────────

/** Parse a strictly positive decimal, tolerant of a comma decimal separator. */
export function parsePositiveNumber(raw: string): number | null {
  if (typeof raw !== 'string' || raw.includes('-')) return null;
  const cleaned = raw.replace(/[^0-9.,]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Parse a money string into positive integer minor units. */
export function parseAmountToMinor(raw: string): number | null {
  const value = parsePositiveNumber(raw);
  if (value === null) return null;
  const minor = Math.round(value * 100);
  return minor > 0 ? minor : null;
}

/** Parse a custom-share string into non-negative integer minor units (empty = 0). */
export function parseShareToMinor(raw: string): number | null {
  if (typeof raw !== 'string' || raw.includes('-')) return null;
  const cleaned = raw.replace(/[^0-9.,]/g, '').replace(',', '.');
  if (!cleaned) return 0;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Build one task weight per member, each defaulting to 1 (equal ratio). */
export function defaultTaskWeights(memberIds: readonly string[]): TaskSplitWeight[] {
  return memberIds.map((memberId) => ({ memberId, weight: 1 }));
}

/**
 * Read raw per-member weight strings into a ratio.
 * Every listed member must have a finite weight > 0, otherwise null is
 * returned so the caller surfaces a validation error instead of storing an
 * unreadable ratio.
 */
export function taskWeightsFromRaw(
  memberIds: readonly string[],
  rawByMember: Record<string, string>,
): TaskSplitWeight[] | null {
  const weights: TaskSplitWeight[] = [];
  for (const memberId of memberIds) {
    const raw = rawByMember[memberId];
    if (raw === undefined || raw.trim() === '') return null;
    const value = Number(raw.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) return null;
    weights.push({ memberId, weight: value });
  }
  return weights.length > 0 ? weights : null;
}

/** Read raw per-participant share strings into integer minor-unit shares. */
export function expenseSharesFromRaw(
  memberIds: readonly string[],
  rawByMember: Record<string, string>,
): ExpenseParticipantShare[] | null {
  const shares: ExpenseParticipantShare[] = [];
  for (const memberId of memberIds) {
    const minor = parseShareToMinor(rawByMember[memberId] ?? '');
    if (minor === null) return null;
    shares.push({ memberId, amountMinor: minor });
  }
  return shares.length > 0 ? shares : null;
}

// ── Shared helpers ────────────────────────────────────────────

function normalizeLabel(raw: string, emptyError: AddDraftError): AddDraftResult<string> {
  const label = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (label.length === 0) return { ok: false, error: emptyError };
  if (label.length > ADD_LABEL_MAX_LENGTH) return { ok: false, error: 'label-too-long' };
  return { ok: true, draft: label };
}

function normalizeAttachments(
  attachments?: Attachment[],
): AddDraftResult<Attachment[] | undefined> {
  if (!attachments || attachments.length === 0) return { ok: true, draft: undefined };
  try {
    return { ok: true, draft: attachments.map((attachment) => createAttachment(attachment)) };
  } catch {
    return { ok: false, error: 'attachment-invalid' };
  }
}

function normalizeOptionalNote(note?: string): AddDraftResult<string | undefined> {
  try {
    return { ok: true, draft: normalizeNote(note) };
  } catch {
    return { ok: false, error: 'note-invalid' };
  }
}

function snapshotCategory(category?: Category | null): {
  categoryId: string | null;
  categoryLabelSnapshot?: string;
} {
  if (!category) return { categoryId: null };
  return { categoryId: category.id, categoryLabelSnapshot: category.name };
}

// ── Task draft ────────────────────────────────────────────────

export interface TaskDraftInput {
  householdId: string;
  label: string;
  value: number;
  unit: ContributionUnit;
  performedByMemberId: string;
  beneficiaryMemberIds: string[];
  occurredAt: string;
  createdBy: string;
  persistentTaskId?: string | null;
  /** Selected user-created category, or null for "no category". */
  category?: Category | null;
  /** Defaults to 'category': apply the category ratio when it defines one. */
  splitChoice?: TaskSplitChoice;
  /** Required when `splitChoice === 'custom'`. */
  customWeights?: TaskSplitWeight[] | null;
  note?: string;
  attachments?: Attachment[];
}

export function buildTaskDraft(
  input: TaskDraftInput,
): AddDraftResult<Omit<ContributionEntry, 'id'>> {
  if (typeof input.householdId !== 'string' || input.householdId.trim().length === 0) {
    return { ok: false, error: 'label-required' };
  }

  const label = normalizeLabel(input.label, 'label-required');
  if (!label.ok) return label;

  if (!Number.isFinite(input.value) || input.value <= 0) {
    return { ok: false, error: 'value-invalid' };
  }
  if (typeof input.performedByMemberId !== 'string' || input.performedByMemberId.length === 0) {
    return { ok: false, error: 'performer-required' };
  }

  const beneficiaries = Array.isArray(input.beneficiaryMemberIds)
    ? input.beneficiaryMemberIds
    : [];
  if (beneficiaries.length === 0 || new Set(beneficiaries).size !== beneficiaries.length) {
    return { ok: false, error: 'beneficiaries-required' };
  }

  const choice: TaskSplitChoice = input.splitChoice ?? 'category';
  const category = input.category ?? null;

  let split: ReturnType<typeof resolveTaskSplitForNewEntry>;
  try {
    if (choice === 'equal') {
      // The user explicitly asked for the equal split: the category default
      // ratio is intentionally bypassed (still snapshoted on the category).
      split = { splitMode: 'equal', splitSource: 'equal' };
    } else if (choice === 'custom') {
      const weights = input.customWeights ?? null;
      if (!weights || weights.length === 0) return { ok: false, error: 'task-split-invalid' };
      split = resolveTaskSplitForNewEntry({
        overrideWeights: weights,
        beneficiaryMemberIds: beneficiaries,
      });
    } else {
      // 'category' (default): category ratio when defined, otherwise equal.
      split = resolveTaskSplitForNewEntry({ category, beneficiaryMemberIds: beneficiaries });
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('defines no weight for beneficiary')) {
      return { ok: false, error: 'task-split-missing-weight' };
    }
    return { ok: false, error: 'task-split-invalid' };
  }

  const note = normalizeOptionalNote(input.note);
  if (!note.ok) return note;
  const attachments = normalizeAttachments(input.attachments);
  if (!attachments.ok) return attachments;

  const snapshot = snapshotCategory(category);
  const draft: Omit<ContributionEntry, 'id'> = {
    householdId: input.householdId,
    label: label.draft,
    performedByMemberId: input.performedByMemberId,
    beneficiaryMemberIds: beneficiaries,
    value: input.value,
    unit: input.unit,
    persistentTaskId: input.persistentTaskId ?? null,
    occurredAt: input.occurredAt,
    createdBy: input.createdBy,
    categoryId: snapshot.categoryId,
  };
  if (snapshot.categoryLabelSnapshot !== undefined) {
    draft.categoryLabelSnapshot = snapshot.categoryLabelSnapshot;
  }
  if (note.draft !== undefined) draft.note = note.draft;
  if (attachments.draft !== undefined) draft.attachments = attachments.draft;
  if (split.splitMode === 'custom' && split.splitWeights) {
    draft.splitMode = 'custom';
    draft.splitWeights = split.splitWeights;
    draft.splitSource = split.splitSource;
  }

  return { ok: true, draft };
}

// ── Expense draft ─────────────────────────────────────────────

export interface ExpenseDraftInput {
  householdId: string;
  title: string;
  amountMinor: number;
  currency: string;
  paidByMemberId: string;
  participantMemberIds: string[];
  splitMode: ExpenseSplitMode;
  customShares?: ExpenseParticipantShare[] | null;
  occurredAt: string;
  createdBy: string;
  /** Selected user-created category, or null for "no category". */
  category?: Category | null;
  note?: string;
  attachments?: Attachment[];
}

export function buildExpenseDraft(
  input: ExpenseDraftInput,
): AddDraftResult<Omit<ExpenseEntry, 'id'>> {
  if (typeof input.householdId !== 'string' || input.householdId.trim().length === 0) {
    return { ok: false, error: 'label-required' };
  }

  const title = normalizeLabel(input.title, 'label-required');
  if (!title.ok) return title;

  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    return { ok: false, error: 'amount-invalid' };
  }
  if (typeof input.paidByMemberId !== 'string' || input.paidByMemberId.length === 0) {
    return { ok: false, error: 'paid-by-required' };
  }

  const participants = Array.isArray(input.participantMemberIds)
    ? input.participantMemberIds
    : [];
  if (participants.length === 0 || new Set(participants).size !== participants.length) {
    return { ok: false, error: 'participants-required' };
  }

  let currency: string;
  try {
    currency = normalizeCurrency(input.currency);
  } catch {
    return { ok: false, error: 'currency-invalid' };
  }

  const note = normalizeOptionalNote(input.note);
  if (!note.ok) return note;
  const attachments = normalizeAttachments(input.attachments);
  if (!attachments.ok) return attachments;

  const snapshot = snapshotCategory(input.category ?? null);
  const draft: Omit<ExpenseEntry, 'id'> = {
    householdId: input.householdId,
    title: title.draft,
    amountMinor: input.amountMinor,
    currency,
    paidByMemberId: input.paidByMemberId,
    participantMemberIds: participants,
    splitMode: input.splitMode,
    occurredAt: input.occurredAt,
    createdBy: input.createdBy,
    categoryId: snapshot.categoryId,
  };
  if (snapshot.categoryLabelSnapshot !== undefined) {
    draft.categoryLabelSnapshot = snapshot.categoryLabelSnapshot;
    // Legacy display label kept for V3-shaped readers.
    draft.category = snapshot.categoryLabelSnapshot;
  }
  if (note.draft !== undefined) draft.note = note.draft;
  if (attachments.draft !== undefined) draft.attachments = attachments.draft;
  if (input.splitMode === 'custom') {
    const shares = input.customShares;
    if (!shares || shares.length === 0) return { ok: false, error: 'expense-split-invalid' };
    draft.customShares = shares.map((share) => ({ ...share }));
    // Validate against the real allocation rules (one share per participant,
    // integer minor units, total == amountMinor) before any write.
    try {
      allocateExpense({ ...draft, id: 'draft' });
    } catch {
      return { ok: false, error: 'expense-split-invalid' };
    }
  } else {
    delete draft.customShares;
  }

  return { ok: true, draft };
}
