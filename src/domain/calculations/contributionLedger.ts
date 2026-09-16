import {
  Balance,
  ContributionEntry,
  ContributionTransfer,
  ContributionUnit,
  CrossLedgerSettlement,
} from '../entities';
import {
  validateContributionValue,
  validateContributionMemberIds,
  validateContributionUnit,
} from './validation';

const EPSILON = 1e-9;

function add(map: Map<string, number>, memberId: string, delta: number): void {
  map.set(memberId, (map.get(memberId) ?? 0) + delta);
}

function validateContribution(entry: ContributionEntry): void {
  validateContributionValue(entry.value, entry.id);
  validateContributionMemberIds(
    entry.performedByMemberId,
    entry.beneficiaryMemberIds,
    entry.id
  );
}

function validateSettlement(settlement: CrossLedgerSettlement): void {
  // Structural validation only; balance sufficiency is checked elsewhere
  if (settlement.contributionCreditorMemberId === settlement.counterpartyMemberId) {
    throw new Error(`Settlement ${settlement.id} cannot target the same member`);
  }
  if (!Number.isFinite(settlement.contributionValue) || settlement.contributionValue <= 0) {
    throw new Error(`Settlement ${settlement.id} must consume a positive contribution value`);
  }
  if (!Number.isInteger(settlement.moneyAmountMinor) || settlement.moneyAmountMinor <= 0) {
    throw new Error(`Settlement ${settlement.id} must contain a positive integer money amount`);
  }
  if (settlement.rateSnapshot.contributionUnit !== settlement.contributionUnit) {
    throw new Error(`Settlement ${settlement.id} rate unit does not match settlement unit`);
  }
  if (settlement.rateSnapshot.currency.toUpperCase() !== settlement.currency.toUpperCase()) {
    throw new Error(`Settlement ${settlement.id} rate currency does not match settlement currency`);
  }
}

/**
 * Compute contribution balances for exactly one unit.
 *
 * Historical entries of another unit are deliberately ignored rather than
 * converted. Unit changes therefore never reinterpret history silently.
 * Cross-ledger settlements are ledger entries too: they consume contribution
 * credit from one member and transfer that credit to the counterparty.
 */
export function calculateContributionBalances(
  entries: ContributionEntry[],
  unit: ContributionUnit,
  settlements: CrossLedgerSettlement[] = [],
  memberIds: string[] = []
): Map<string, number> {
  const balances = new Map<string, number>();
  for (const memberId of memberIds) balances.set(memberId, 0);

  for (const entry of entries) {
    if (entry.unit !== unit) continue;
    validateContribution(entry);

    add(balances, entry.performedByMemberId, entry.value);
    const share = entry.value / entry.beneficiaryMemberIds.length;
    for (const beneficiaryId of entry.beneficiaryMemberIds) {
      add(balances, beneficiaryId, -share);
    }
  }

  for (const settlement of settlements) {
    if (settlement.contributionUnit !== unit) continue;
    validateSettlement(settlement);

    add(balances, settlement.contributionCreditorMemberId, -settlement.contributionValue);
    add(balances, settlement.counterpartyMemberId, settlement.contributionValue);
  }

  return balances;
}

export function calculateContributionBalancesByUnit(
  entries: ContributionEntry[],
  settlements: CrossLedgerSettlement[] = [],
  memberIds: string[] = []
): Record<ContributionUnit, Map<string, number>> {
  return {
    minutes: calculateContributionBalances(entries, 'minutes', settlements, memberIds),
    points: calculateContributionBalances(entries, 'points', settlements, memberIds),
  };
}

export function balancesToArray(balances: Map<string, number>): Balance[] {
  return Array.from(balances.entries())
    .map(([memberId, value]) => ({ memberId, value }))
    .sort((a, b) => b.value - a.value || a.memberId.localeCompare(b.memberId));
}

export function sumContributionBalances(balances: Map<string, number>): number {
  return Array.from(balances.values()).reduce((sum, value) => sum + value, 0);
}

export function contributionLedgerIsZeroSum(balances: Map<string, number>): boolean {
  return Math.abs(sumContributionBalances(balances)) <= EPSILON;
}

/**
 * Greedy pairwise settlement suggestion for one contribution unit.
 * Positive balances are creditors, negative balances are debtors.
 */
export function suggestContributionTransfers(
  balances: Map<string, number>,
  unit: ContributionUnit
): ContributionTransfer[] {
  const positives = balancesToArray(balances)
    .filter((balance) => balance.value > EPSILON)
    .map((balance) => ({ ...balance }));
  const negatives = balancesToArray(balances)
    .filter((balance) => balance.value < -EPSILON)
    .sort((a, b) => a.value - b.value)
    .map((balance) => ({ ...balance }));

  const transfers: ContributionTransfer[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < positives.length && debtorIndex < negatives.length) {
    const creditor = positives[creditorIndex];
    const debtor = negatives[debtorIndex];
    const amount = Math.min(creditor.value, -debtor.value);

    if (amount > EPSILON) {
      transfers.push({
        fromMemberId: debtor.memberId,
        toMemberId: creditor.memberId,
        value: amount,
        unit,
      });
    }

    creditor.value -= amount;
    debtor.value += amount;

    if (creditor.value <= EPSILON) creditorIndex += 1;
    if (debtor.value >= -EPSILON) debtorIndex += 1;
  }

  return transfers;
}
