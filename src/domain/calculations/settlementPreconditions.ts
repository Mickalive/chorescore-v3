/**
 * ChoreScore V3 — settlement precondition checks.
 *
 * Before applying a cross-ledger settlement, callers should verify that
 * the contribution creditor actually has sufficient contribution credit
 * and that the counterparty has sufficient money receivable (positive
 * balance). These preconditions prevent over-settlement and make the
 * ledger robust against malformed or adversarial settlement records.
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
 * Check whether the counterparty has enough positive money receivable
 * (positive balance) to absorb the settlement money amount. The settlement
 * reduces the counterparty's receivable; they must have at least as much
 * as the settlement amount.
 *
 * @param counterpartyMoneyBalance  The counterparty's money balance (should be > 0).
 * @param moneyAmountMinor          The money amount the settlement will deduct from counterparty.
 * @param counterpartyId            Member ID for error messages.
 */
export function checkMoneyDebtSufficient(
  counterpartyMoneyBalance: number,
  moneyAmountMinor: number,
  counterpartyId: string
): { sufficient: boolean; availableReceivable: number } {
  // Counterparty's money balance is positive (they are owed money / have a receivable).
  // The settlement deducts from their balance (reduces their receivable).
  // They are "sufficient" if their receivable is at least as large as the settlement.
  const availableReceivable = counterpartyMoneyBalance;
  const sufficient = availableReceivable >= moneyAmountMinor - 1e-9;
  return { sufficient, availableReceivable };
}

/**
 * Full precondition check for a proposed settlement: validates the settlement
 * structure AND checks that neither ledger would be overshoot.
 *
 * @param settlement             The proposed settlement to validate.
 * @param contributions          All contribution entries (for balance calculation).
 * @param expenses               All expense entries (for money balance calculation).
 * @param allMemberIds           All member IDs in the household.
 * @param priorSettlements       Settlements already applied before this one (for accumulation).
 * @param validateStructure      Whether to run structural validation (default true).
 */
export function validateSettlementPreconditions(
  settlement: CrossLedgerSettlement,
  contributions: ContributionEntry[],
  expenses: ExpenseEntry[],
  allMemberIds: string[],
  priorSettlements: CrossLedgerSettlement[] = [],
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
  //    Include prior settlements so accumulated consumption is accounted for.
  const contributionBalances = calculateContributionBalances(
    contributions,
    settlement.contributionUnit,
    priorSettlements,
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

  // 3. Check counterparty has sufficient money receivable
  //    Include prior settlements so accumulated consumption is accounted for.
  const moneyBalances = calculateFinancialBalances(
    expenses,
    settlement.currency,
    priorSettlements,
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
      `Counterparty ${settlement.counterpartyMemberId} has ${moneyCheck.availableReceivable} ${settlement.currency} minor units receivable, but settlement requires ${settlement.moneyAmountMinor}`
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
    // so each subsequent settlement is checked against balances that reflect
    // all earlier settlements.
    const result = validateSettlementPreconditions(
      settlement,
      contributions,
      expenses,
      allMemberIds,
      appliedSettlements,
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
