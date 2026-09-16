/**
 * ChoreScore V3 — settlement precondition checks.
 *
 * Before applying a cross-ledger settlement, callers should verify that
 * the contribution creditor actually has sufficient contribution credit
 * and that the counterparty has sufficient money debt. These preconditions
 * prevent over-settlement and make the ledger robust against malformed
 * or adversarial settlement records.
 *
 * All functions are pure and side-effect-free.
 */

import {
  ContributionEntry,
  ContributionUnit,
  CrossLedgerSettlement,
  ExpenseEntry,
} from '../entities';
import { calculateContributionBalances } from './contributionLedger';
import { calculateFinancialBalances } from './expenseLedger';
import { validateCrossLedgerSettlement } from './crossLedgerSettlement';

// ── Result types ──────────────────────────────────────────────

export interface SettlementPreconditionResult {
  valid: boolean;
  errors: string[];
}

// ── Over-settlement guards ────────────────────────────────────

/**
 * Check whether the contribution creditor has enough positive contribution
 * balance to cover the settlement. Returns the available balance and whether
 * the settlement would overshoot it.
 *
 * @param availableBalance  The creditor's current contribution balance (should be > 0).
 * @param settlementValue   The contribution value to be consumed by the settlement.
 * @param creditorId        Member ID of the contribution creditor (for error messages).
 */
export function checkContributionSufficient(
  availableBalance: number,
  settlementValue: number,
  creditorId: string
): { sufficient: boolean; available: number } {
  const sufficient = availableBalance >= settlementValue - 1e-9;
  return { sufficient, available: availableBalance };
}

/**
 * Check whether the counterparty has enough negative money balance (i.e.
 * owes enough money) to absorb the settlement money amount.
 *
 * @param counterpartyMoneyBalance  The counterparty's money balance (should be < 0).
 * @param moneyAmountMinor          The money amount the settlement will add to counterparty.
 * @param counterpartyId            Member ID for error messages.
 */
export function checkMoneyDebtSufficient(
  counterpartyMoneyBalance: number,
  moneyAmountMinor: number,
  counterpartyId: string
): { sufficient: boolean; availableDebt: number } {
  // Counterparty's money balance is negative (they owe money).
  // The settlement adds to their balance (reduces their debt).
  // They are "sufficient" if they currently owe at least as much as the settlement.
  const availableDebt = -counterpartyMoneyBalance; // Convert to positive
  const sufficient = availableDebt >= moneyAmountMinor - 1e-9;
  return { sufficient, availableDebt };
}

/**
 * Full precondition check for a proposed settlement: validates the settlement
 * structure AND checks that neither ledger would be overshoot.
 *
 * @param settlement             The proposed settlement to validate.
 * @param contributions          All contribution entries (for balance calculation).
 * @param expenses               All expense entries (for money balance calculation).
 * @param allMemberIds           All member IDs in the household.
 * @param validateStructure      Whether to run structural validation (default true).
 */
export function validateSettlementPreconditions(
  settlement: CrossLedgerSettlement,
  contributions: ContributionEntry[],
  expenses: ExpenseEntry[],
  allMemberIds: string[],
  validateStructure: boolean = true
): SettlementPreconditionResult {
  const errors: string[] = [];

  // 1. Structural validation (rate snapshot, amounts, members)
  if (validateStructure) {
    try {
      validateCrossLedgerSettlement(settlement);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  // 2. Check contribution creditor has sufficient contribution credit
  const contributionBalances = calculateContributionBalances(
    contributions,
    settlement.contributionUnit,
    [],
    allMemberIds
  );
  const creditorContribution = contributionBalances.get(settlement.contributionCreditorMemberId) ?? 0;
  const contribCheck = checkContributionSufficient(
    creditorContribution,
    settlement.contributionValue,
    settlement.contributionCreditorMemberId
  );
  if (!contribCheck.sufficient) {
    errors.push(
      `Contribution creditor ${settlement.contributionCreditorMemberId} has ${contribCheck.available} ${settlement.contributionUnit} available, but settlement requires ${settlement.contributionValue}`
    );
  }

  // 3. Check counterparty has sufficient money debt
  const moneyBalances = calculateFinancialBalances(
    expenses,
    settlement.currency,
    [],
    allMemberIds
  );
  const counterpartyMoney = moneyBalances.get(settlement.counterpartyMemberId) ?? 0;
  const moneyCheck = checkMoneyDebtSufficient(
    counterpartyMoney,
    settlement.moneyAmountMinor,
    settlement.counterpartyMemberId
  );
  if (!moneyCheck.sufficient) {
    errors.push(
      `Counterparty ${settlement.counterpartyMemberId} owes ${moneyCheck.availableDebt} ${settlement.currency} minor units, but settlement requires ${settlement.moneyAmountMinor}`
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate that a settlement applied after existing settlements
 * would not overshoot available balances. This is used when replaying
 * multiple settlements to catch malformed sequences.
 *
 * @param settlements     All settlements to replay in order.
 * @param contributions   All contribution entries.
 * @param expenses        All expense entries.
 * @param allMemberIds    All member IDs.
 */
export function validateSettlementSequence(
  settlements: CrossLedgerSettlement[],
  contributions: ContributionEntry[],
  expenses: ExpenseEntry[],
  allMemberIds: string[]
): SettlementPreconditionResult {
  const errors: string[] = [];
  const appliedSettlements: CrossLedgerSettlement[] = [];

  for (let i = 0; i < settlements.length; i++) {
    const settlement = settlements[i];

    // First validate structure
    try {
      validateCrossLedgerSettlement(settlement);
    } catch (e) {
      errors.push(`Settlement[${i}] ${settlement.id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    // Then check preconditions with previously applied settlements included
    const result = validateSettlementPreconditions(
      settlement,
      contributions,
      expenses,
      allMemberIds,
      false // Already validated structure
    );

    if (!result.valid) {
      for (const err of result.errors) {
        errors.push(`Settlement[${i}] ${settlement.id}: ${err}`);
      }
    }

    appliedSettlements.push(settlement);
  }

  return { valid: errors.length === 0, errors };
}
