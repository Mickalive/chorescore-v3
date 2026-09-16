import {
  ContributionMoneyRate,
  ContributionUnit,
  CrossLedgerSettlement,
} from '../entities';
import { normalizeCurrency } from './expenseLedger';

function validateRate(rate: ContributionMoneyRate): void {
  if (!Number.isFinite(rate.contributionValue) || rate.contributionValue <= 0) {
    throw new Error('Rate contributionValue must be finite and > 0');
  }
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
  if (!Number.isFinite(contributionValue) || contributionValue <= 0) {
    throw new Error('Settlement contributionValue must be finite and > 0');
  }
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
 */
export function validateCrossLedgerSettlement(
  settlement: CrossLedgerSettlement
): void {
  if (settlement.contributionCreditorMemberId === settlement.counterpartyMemberId) {
    throw new Error('A cross-ledger settlement requires two different members');
  }
  if (settlement.rateSnapshot.contributionUnit !== settlement.contributionUnit) {
    throw new Error('Settlement unit does not match snapshotted rate');
  }
  if (
    normalizeCurrency(settlement.rateSnapshot.currency) !==
    normalizeCurrency(settlement.currency)
  ) {
    throw new Error('Settlement currency does not match snapshotted rate');
  }

  const expected = quoteCrossLedgerMoneyAmount(
    settlement.contributionValue,
    settlement.contributionUnit,
    settlement.rateSnapshot
  );

  if (expected !== settlement.moneyAmountMinor) {
    throw new Error(
      `Settlement amount ${settlement.moneyAmountMinor} does not match snapshotted rate (${expected})`
    );
  }
}
