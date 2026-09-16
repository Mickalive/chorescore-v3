/**
 * ChoreScore V3 — cross-ledger settlement conversion and validation.
 *
 * Settlements are immutable accounting records. The snapshotted rate
 * ensures that later changes to household settings never reinterpret
 * historical settlements.
 */

import {
  ContributionMoneyRate,
  ContributionUnit,
  CrossLedgerSettlement,
} from '../entities';
import {
  normalizeCurrency,
  validateSettlementRateConsistency,
  validateSettlementMembers,
  validateSettlementAmounts,
  requireFinitePositive,
  validateContributionUnit,
} from './validation';

function validateRate(rate: ContributionMoneyRate): void {
  requireFinitePositive(rate.contributionValue, 'Rate contributionValue');
  if (!Number.isInteger(rate.moneyAmountMinor) || rate.moneyAmountMinor <= 0) {
    throw new Error('Rate moneyAmountMinor must be a positive integer');
  }
  normalizeCurrency(rate.currency);
}

/**
 * Convert a contribution amount using an explicit group-defined rate.
 * Rounding is deterministic to the nearest currency minor unit.
 */
export function quoteCrossLedgerMoneyAmount(
  contributionValue: number,
  contributionUnit: ContributionUnit,
  rate: ContributionMoneyRate
): number {
  validateRate(rate);
  requireFinitePositive(contributionValue, 'Settlement contributionValue');
  validateContributionUnit(contributionUnit);
  if (rate.contributionUnit !== contributionUnit) {
    throw new Error('Settlement contribution unit does not match rate unit');
  }

  return Math.round(
    (contributionValue / rate.contributionValue) * rate.moneyAmountMinor
  );
}

/**
 * Validate that an immutable settlement still matches its snapshotted rate.
 * Later changes to household settings are irrelevant: only rateSnapshot is used.
 *
 * This function validates the settlement structure. For full precondition
 * checks (including balance sufficiency), use settlementPreconditions.ts.
 */
export function validateCrossLedgerSettlement(
  settlement: CrossLedgerSettlement
): void {
  validateSettlementMembers(
    settlement.contributionCreditorMemberId,
    settlement.counterpartyMemberId,
    settlement.id
  );
  validateSettlementAmounts(
    settlement.contributionValue,
    settlement.moneyAmountMinor,
    settlement.id
  );
  validateSettlementRateConsistency(
    settlement.contributionUnit,
    settlement.currency,
    settlement.rateSnapshot,
    settlement.id
  );

  const expected = quoteCrossLedgerMoneyAmount(
    settlement.contributionValue,
    settlement.contributionUnit,
    settlement.rateSnapshot
  );

  if (expected !== settlement.moneyAmountMinor) {
    throw new Error(
      `Settlement ${settlement.id} amount ${settlement.moneyAmountMinor} does not match snapshotted rate (${expected})`
    );
  }
}
