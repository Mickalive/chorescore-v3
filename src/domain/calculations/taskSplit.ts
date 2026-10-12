/**
 * ChoreScore V4 — task split allocation.
 *
 * Two split modes for tasks, mirroring the money ledger:
 *   - equal (the V3 default): value / beneficiaryCount, exactly as before;
 *   - custom: a snapshoted weight ratio (equal-percentage) owned by the group
 *     or inherited from a user-created category's default ratio.
 *
 * Invariants:
 *   - shares always sum exactly to the entry value (zero-sum preserved);
 *   - allocation is deterministic (last beneficiary absorbs the residual);
 *   - a missing weight for a beneficiary is an error, never a silent fallback;
 *   - weights are copied on read, so a later category edit cannot mutate an
 *     entry that already stored its ratio snapshot.
 *
 * V3 entries carry no split fields and keep the original arithmetic
 * (`value / count` in beneficiary order): unit history and balances of the
 * validated baseline are never reinterpreted.
 */

import { ContributionEntry, TaskSplitMode, TaskSplitWeight } from '../entities';

export interface TaskBeneficiaryShare {
  memberId: string;
  share: number;
}

/** Decimal places kept when rounding weighted shares. */
const SHARE_PRECISION = 1e9;

function requireMemberId(memberId: string, label: string): void {
  if (typeof memberId !== 'string' || memberId.trim().length === 0) {
    throw new Error(`${label} requires a non-empty member id`);
  }
}

/**
 * Validate and copy a weight ratio. Returns a fresh array so callers always
 * store an independent snapshot.
 */
export function normalizeTaskSplitWeights(
  weights: TaskSplitWeight[],
  label: string = 'Task split'
): TaskSplitWeight[] {
  if (!Array.isArray(weights) || weights.length === 0) {
    throw new Error(`${label} must define at least one weight`);
  }

  const seen = new Set<string>();
  return weights.map((weight) => {
    requireMemberId(weight?.memberId, label);
    if (seen.has(weight.memberId)) {
      throw new Error(`${label} contains duplicate member ${weight.memberId}`);
    }
    seen.add(weight.memberId);
    if (!Number.isFinite(weight.weight) || weight.weight <= 0) {
      throw new Error(
        `${label} weight for ${weight.memberId} must be a finite number > 0, got ${weight.weight}`
      );
    }
    return { memberId: weight.memberId, weight: weight.weight };
  });
}

/** Deep-copy a ratio (null/undefined pass through). Snapshot safety. */
export function cloneTaskSplitWeights(
  weights: TaskSplitWeight[] | null | undefined
): TaskSplitWeight[] | null {
  if (!weights) return null;
  return weights.map((weight) => ({ memberId: weight.memberId, weight: weight.weight }));
}

/**
 * Resolve the weights that apply to an entry.
 * Returns null for the equal split (including all V3 entries).
 */
export function taskSplitWeightsFor(entry: ContributionEntry): TaskSplitWeight[] | null {
  const mode: TaskSplitMode = entry.splitMode ?? 'equal';
  if (mode === 'equal') return null;
  if (!entry.splitWeights || entry.splitWeights.length === 0) {
    throw new Error(`Contribution ${entry.id} uses a custom split but defines no weights`);
  }
  return entry.splitWeights;
}

/**
 * Allocate the value across beneficiaries.
 *
 * Equal mode (weights absent): exactly `value / count` per beneficiary,
 * identical to the validated V3 arithmetic.
 *
 * Custom mode: share = value * weight / totalWeight for every beneficiary
 * except the last one (rounded to SHARE_PRECISION), which absorbs the
 * residual so the shares sum exactly to `value`.
 */
export function allocateTaskShares(
  value: number,
  beneficiaryMemberIds: string[],
  weights?: TaskSplitWeight[] | null
): TaskBeneficiaryShare[] {
  if (beneficiaryMemberIds.length === 0) {
    throw new Error('Task split requires at least one beneficiary');
  }

  if (weights === null || weights === undefined) {
    return beneficiaryMemberIds.map((memberId) => ({
      memberId,
      share: value / beneficiaryMemberIds.length,
    }));
  }

  const normalized = normalizeTaskSplitWeights(weights);
  const weightByMember = new Map(normalized.map((w) => [w.memberId, w.weight]));

  const effectiveWeights = beneficiaryMemberIds.map((memberId) => {
    const weight = weightByMember.get(memberId);
    if (weight === undefined) {
      throw new Error(`Custom task split defines no weight for beneficiary ${memberId}`);
    }
    return weight;
  });

  const totalWeight = effectiveWeights.reduce((sum, weight) => sum + weight, 0);
  if (!(totalWeight > 0)) {
    throw new Error('Custom task split total weight must be > 0');
  }

  const shares: TaskBeneficiaryShare[] = [];
  let assigned = 0;
  for (let index = 0; index < beneficiaryMemberIds.length; index += 1) {
    const isLast = index === beneficiaryMemberIds.length - 1;
    if (isLast) {
      shares.push({ memberId: beneficiaryMemberIds[index], share: value - assigned });
      break;
    }
    const raw = (value * effectiveWeights[index]) / totalWeight;
    const share = Math.round(raw * SHARE_PRECISION) / SHARE_PRECISION;
    assigned += share;
    shares.push({ memberId: beneficiaryMemberIds[index], share });
  }

  return shares;
}

/**
 * Allocate an entry's value using its own snapshoted split.
 * Used by both the full ledger replay and the incremental balance deltas so
 * materialized balances always equal the rebuilt ledger.
 */
export function allocateEntryShares(entry: ContributionEntry): TaskBeneficiaryShare[] {
  return allocateTaskShares(entry.value, entry.beneficiaryMemberIds, taskSplitWeightsFor(entry));
}

/** Sum of allocated shares (used by invariant tests). */
export function sumTaskShares(shares: TaskBeneficiaryShare[]): number {
  return shares.reduce((sum, share) => sum + share.share, 0);
}
