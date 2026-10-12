/**
 * ChoreScore V4 — category service.
 *
 * Categories are 100% user-created: there is no seeded taxonomy, no
 * mandatory category and no default name list anywhere in the product.
 *
 * Responsibilities:
 *   - validate/normalize a user-entered category name;
 *   - own the category's default task ratio as a snapshotable value;
 *   - resolve the split a NEW entry should use (explicit override wins over
 *     the category default, which wins over the equal split);
 *   - resolve a readable category label for an entry without ever letting a
 *     rename or a deletion reinterpret historical entries.
 *
 * Deleting a category never touches ledger entries: they keep their
 * categoryId plus the label captured at creation time.
 */

import { Category, TaskSplitMode, TaskSplitSource, TaskSplitWeight } from '../entities';
import { cloneTaskSplitWeights, normalizeTaskSplitWeights } from '../calculations/taskSplit';

/** User-entered category names are bounded (UI + storage cost). */
export const CATEGORY_NAME_MAX_LENGTH = 60;

/**
 * Normalize a user-entered category name.
 * Trims and collapses whitespace; never maps a name onto a default taxonomy.
 */
export function normalizeCategoryName(name: string): string {
  if (typeof name !== 'string') {
    throw new Error('Category name must be a string');
  }
  const normalized = name.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    throw new Error('Category name must be a non-empty string');
  }
  if (normalized.length > CATEGORY_NAME_MAX_LENGTH) {
    throw new Error(
      `Category name must be at most ${CATEGORY_NAME_MAX_LENGTH} characters, got ${normalized.length}`
    );
  }
  return normalized;
}

export interface CategoryDraft {
  householdId: string;
  name: string;
  defaultTaskRatio?: TaskSplitWeight[] | null;
}

/** Validate the data needed to create a category (no id/timestamps here). */
export function buildCategoryDraft(draft: CategoryDraft): {
  householdId: string;
  name: string;
  defaultTaskRatio: TaskSplitWeight[] | null;
} {
  if (typeof draft.householdId !== 'string' || draft.householdId.trim().length === 0) {
    throw new Error('Category requires a householdId');
  }
  return {
    householdId: draft.householdId,
    name: normalizeCategoryName(draft.name),
    defaultTaskRatio:
      draft.defaultTaskRatio && draft.defaultTaskRatio.length > 0
        ? normalizeTaskSplitWeights(draft.defaultTaskRatio, 'Category default ratio')
        : null,
  };
}

/** Validate a rename. Returns the patch to apply. */
export function renameCategory(name: string): { name: string } {
  return { name: normalizeCategoryName(name) };
}

/** Validate a new default ratio. Returns an independent copy (snapshot-safe). */
export function setCategoryDefaultTaskRatio(
  ratio: TaskSplitWeight[] | null | undefined
): { defaultTaskRatio: TaskSplitWeight[] | null } {
  if (!ratio || ratio.length === 0) return { defaultTaskRatio: null };
  return { defaultTaskRatio: normalizeTaskSplitWeights(ratio, 'Category default ratio') };
}

/**
 * Independent copy of a category's default ratio.
 * Mutating the category afterwards must never change an already-captured ratio.
 */
export function categoryDefaultTaskRatioSnapshot(
  category: Pick<Category, 'defaultTaskRatio'> | null | undefined
): TaskSplitWeight[] | null {
  if (!category) return null;
  return cloneTaskSplitWeights(category.defaultTaskRatio);
}

export interface ResolvedTaskSplit {
  splitMode: TaskSplitMode;
  splitWeights?: TaskSplitWeight[];
  splitSource: TaskSplitSource;
}

/**
 * Decide the split for a NEW task entry.
 * Precedence: explicit override > category default ratio > equal split.
 * The returned weights are always a fresh copy for the entry to snapshot.
 *
 * When `beneficiaryMemberIds` is provided, a custom ratio must define a weight
 * for every beneficiary: a category default ratio only covers the members it
 * names, and a missing weight is an error at creation time rather than a
 * silent fallback (which would make the stored entry unreadable on replay).
 */
export function resolveTaskSplitForNewEntry(options: {
  category?: Pick<Category, 'defaultTaskRatio'> | null;
  overrideWeights?: TaskSplitWeight[] | null;
  beneficiaryMemberIds?: string[];
}): ResolvedTaskSplit {
  const { category, overrideWeights, beneficiaryMemberIds } = options;

  let resolved: ResolvedTaskSplit;
  if (overrideWeights && overrideWeights.length > 0) {
    resolved = {
      splitMode: 'custom',
      splitWeights: normalizeTaskSplitWeights(overrideWeights, 'Task split override'),
      splitSource: 'custom',
    };
  } else {
    const categoryRatio = categoryDefaultTaskRatioSnapshot(category);
    if (categoryRatio && categoryRatio.length > 0) {
      resolved = { splitMode: 'custom', splitWeights: categoryRatio, splitSource: 'category-default' };
    } else {
      resolved = { splitMode: 'equal', splitSource: 'equal' };
    }
  }

  if (beneficiaryMemberIds) {
    requireSplitCoverage(resolved, beneficiaryMemberIds);
  }
  return resolved;
}

/**
 * A custom ratio must cover every beneficiary of the entry.
 * Extra weights (members not benefiting from this entry) are allowed: a
 * category ratio is defined per group, not per entry.
 */
export function requireSplitCoverage(
  split: ResolvedTaskSplit,
  beneficiaryMemberIds: string[]
): void {
  if (split.splitMode !== 'custom' || !split.splitWeights) return;
  if (beneficiaryMemberIds.length === 0) {
    throw new Error('Task split requires at least one beneficiary');
  }
  const covered = new Set(split.splitWeights.map((weight) => weight.memberId));
  for (const memberId of beneficiaryMemberIds) {
    if (!covered.has(memberId)) {
      const source = split.splitSource === 'category-default' ? 'Category default ratio' : 'Task split';
      throw new Error(`${source} defines no weight for beneficiary ${memberId}`);
    }
  }
}

/**
 * Readable category label for an entry.
 * Prefers the live category name, falls back to the label captured at
 * creation, and finally reports null when the category was deleted before
 * the entry ever stored one. History is never rewritten either way.
 */
export interface EntryCategoryRef {
  categoryId?: string | null;
  categoryLabelSnapshot?: string;
}

export function resolveEntryCategoryLabel(
  entry: EntryCategoryRef,
  categories: Pick<Category, 'id' | 'name'>[]
): string | null {
  const categoryId = entry.categoryId ?? null;
  if (!categoryId) return entry.categoryLabelSnapshot ?? null;

  const category = categories.find((candidate) => candidate.id === categoryId);
  if (category) return category.name;
  return entry.categoryLabelSnapshot ?? null;
}
