/**
 * ChoreScore V3 — Unit Change Service
 *
 * Handles changing a household's contribution unit (minutes ↔ points).
 *
 * Invariant (constitution §18):
 *   "Aucun changement d'unité ne doit silencieusement réinterpréter
 *    l'historique."
 *
 * Design:
 *   - The household.contributionUnit field is updated.
 *   - All historical contribution entries RETAIN their original unit.
 *   - New contributions use the new unit.
 *   - The UI displays each entry with its own unit.
 *   - Optionally, the household can provide an explicit conversion
 *     rate (defined by the group, not imposed by ChoreScore).
 *   - The conversion rate is stored on the household but does NOT
 *     retroactively modify existing entries.
 *
 * This is V3-06 territory: group configuration changes must never
 * reinterpret historical ledger data.
 */

import { Household, ContributionUnit } from '../entities';

export interface UnitChangeResult {
  updatedHousehold: Household;
  /** Number of historical entries that are NOT modified (informational). */
  historicalEntriesPreserved: number;
  /** True if a conversion rate was set (informational). */
  conversionRateSet: boolean;
}

/**
 * Plan a unit change on a household.
 *
 * This is a pure function that computes the new household state.
 * The caller persists it and does NOT touch any historical entries.
 *
 * @param household Current household state.
 * @param newUnit The target unit ('minutes' | 'points').
 * @param conversionRate Optional explicit conversion rate the group defines.
 *   If provided, it is stored on the household for future reference
 *   but does NOT retroactively modify existing entries.
 *   Format: { contributionValue, moneyAmountMinor, currency }
 */
export function planUnitChange(
  household: Household,
  newUnit: ContributionUnit,
  conversionRate?: { contributionValue: number; moneyAmountMinor: number; currency: string },
): UnitChangeResult {
  if (newUnit === household.contributionUnit && !conversionRate) {
    // No change needed
    return {
      updatedHousehold: household,
      historicalEntriesPreserved: 0,
      conversionRateSet: false,
    };
  }

  const updatedHousehold: Household = {
    ...household,
    contributionUnit: newUnit,
    contributionToMoneyRate: conversionRate
      ? {
          contributionValue: conversionRate.contributionValue,
          contributionUnit: newUnit,
          moneyAmountMinor: conversionRate.moneyAmountMinor,
          currency: conversionRate.currency,
        }
      : household.contributionToMoneyRate,
  };

  return {
    updatedHousehold,
    historicalEntriesPreserved: 0, // Caller provides this count
    conversionRateSet: !!conversionRate,
  };
}

/**
 * Validate that a unit change is allowed.
 */
export function validateUnitChange(
  household: Household,
  newUnit: ContributionUnit,
): void {
  if (newUnit !== 'minutes' && newUnit !== 'points') {
    throw new Error('Unit must be "minutes" or "points"');
  }

  if (!household.id) {
    throw new Error('Household ID is required');
  }
}
