/**
 * ChoreScore V3 — Materialized Balance Service
 *
 * Balances are derived views over the ledger. They are computed from the
 * full ledger once, then updated incrementally by delta when entries are
 * added, modified or removed. This avoids replaying the full history on
 * every UI render.
 *
 * The materialized state is always reconstructible from the ledger.
 * Tests verify this invariant: materialized == full-replay.
 *
 * This service is pure / side-effect-free. It owns no storage;
 * callers provide the entry arrays and receive updated balance maps.
 */

import { ContributionEntry, ContributionUnit, ExpenseEntry, CrossLedgerSettlement } from '../entities';
import { calculateContributionBalances, balancesToArray, sumContributionBalances, contributionLedgerIsZeroSum } from './contributionLedger';
import { calculateFinancialBalancesByCurrency, financialBalancesToArray, financialLedgerIsZeroSum } from './expenseLedger';
import { filterByPeriod, Period, periodBoundary } from './periods';

// ── Types ──────────────────────────────────────────────────────

export interface MaterializedContributionBalance {
  memberId: string;
  value: number;
  unit: ContributionUnit;
}

export interface MaterializedMoneyBalance {
  memberId: string;
  amountMinor: number;
  currency: string;
}

export interface MaterializedGroupBalances {
  /** Per-member contribution balances for the group's unit. */
  contribution: MaterializedContributionBalance[];
  /** Per-member financial balances, grouped by currency. */
  money: MaterializedMoneyBalance[];
  /** Whether the contribution ledger is mathematically zero-sum. */
  contributionZeroSum: boolean;
  /** Whether each money ledger is mathematically zero-sum. */
  moneyZeroSum: boolean;
  /** Total contribution value in the unit (informational). */
  totalContribution: number;
  /** Period used for this snapshot. */
  period: Period;
  /** ISO timestamp of the computation. */
  computedAt: string;
}

export interface BalanceSnapshot {
  contribution: Map<string, number>;
  moneyByCurrency: Map<string, Map<string, number>>;
}

// ── Full computation (used for initial load and verification) ───

/**
 * Compute contribution balances for a given period.
 * Period is a VIEW — the underlying perpetual ledger is never mutated.
 * Settlements are ALSO filtered by period: a settlement outside the period
 * does not affect the period view (but it remains in all-time).
 */
export function computePeriodContributionBalances(
  entries: ContributionEntry[],
  unit: ContributionUnit,
  settlements: CrossLedgerSettlement[],
  memberIds: string[],
  period: Period,
  referenceDate: Date = new Date()
): Map<string, number> {
  const filtered = filterByPeriod(entries, period, referenceDate);
  const filteredSettlements = filterByPeriod(settlements, period, referenceDate);
  return calculateContributionBalances(filtered, unit, filteredSettlements, memberIds);
}

/**
 * Compute financial balances for a given period.
 * Settlements are filtered by period (same as contributions).
 */
export function computePeriodFinancialBalances(
  expenses: ExpenseEntry[],
  settlements: CrossLedgerSettlement[],
  memberIds: string[],
  period: Period,
  referenceDate: Date = new Date()
): Map<string, Map<string, number>> {
  const filtered = filterByPeriod(expenses, period, referenceDate);
  const filteredSettlements = filterByPeriod(settlements, period, referenceDate);
  return calculateFinancialBalancesByCurrency(filtered, filteredSettlements, memberIds);
}

// ── Delta-based incremental update ─────────────────────────────

/**
 * Given an existing contribution balance map and a delta (added/removed/modified
 * entry), produce an updated balance map without replaying the full ledger.
 *
 * For simplicity and correctness, when entries are modified we recompute
 * the delta as: remove old effect, apply new effect. For pure additions,
 * we only apply the new effect. For removals, we subtract the old effect.
 *
 * @param current   The existing balance map.
 * @param entries   ALL entries (needed to resolve the full set of memberIds).
 * @param unit      The contribution unit.
 * @param settlements All settlements.
 * @param memberIds All member IDs.
 */
export function deltaUpdateContribution(
  current: Map<string, number>,
  entry: ContributionEntry,
  unit: ContributionUnit,
  memberIds: string[],
  type: 'add' | 'remove'
): Map<string, number> {
  if (entry.unit !== unit) return current;

  const next = new Map(current);
  const sign = type === 'add' ? 1 : -1;

  // Performer gets credit (or loses it on removal)
  next.set(entry.performedByMemberId, (next.get(entry.performedByMemberId) ?? 0) + sign * entry.value);

  // Each beneficiary bears a share of the cost
  const share = entry.value / entry.beneficiaryMemberIds.length;
  for (const beneficiaryId of entry.beneficiaryMemberIds) {
    next.set(beneficiaryId, (next.get(beneficiaryId) ?? 0) - sign * share);
  }

  return next;
}

/**
 * Apply a settlement delta to contribution balances.
 */
export function deltaUpdateContributionFromSettlement(
  current: Map<string, number>,
  settlement: CrossLedgerSettlement,
  unit: ContributionUnit,
  type: 'add' | 'remove'
): Map<string, number> {
  if (settlement.contributionUnit !== unit) return current;

  const next = new Map(current);
  const sign = type === 'add' ? 1 : -1;

  // Creditor loses contribution credit
  next.set(
    settlement.contributionCreditorMemberId,
    (next.get(settlement.contributionCreditorMemberId) ?? 0) - sign * settlement.contributionValue
  );
  // Counterparty gains contribution credit
  next.set(
    settlement.counterpartyMemberId,
    (next.get(settlement.counterpartyMemberId) ?? 0) + sign * settlement.contributionValue
  );

  return next;
}

// ── Snapshot helpers ───────────────────────────────────────────

/**
 * Create a full snapshot from raw ledger data. Used for initial load.
 */
export function createBalanceSnapshot(
  contributions: ContributionEntry[],
  expenses: ExpenseEntry[],
  settlements: CrossLedgerSettlement[],
  contributionUnit: ContributionUnit,
  memberIds: string[],
  period: Period = 'all-time',
  referenceDate: Date = new Date()
): BalanceSnapshot {
  const contribution = computePeriodContributionBalances(
    contributions, contributionUnit, settlements, memberIds, period, referenceDate
  );
  const moneyByCurrency = computePeriodFinancialBalances(
    expenses, settlements, memberIds, period, referenceDate
  );
  return { contribution, moneyByCurrency };
}

/**
 * Format a contribution balance array for display.
 */
export function formatContributionBalances(
  balances: Map<string, number>,
  unit: ContributionUnit
): MaterializedContributionBalance[] {
  return balancesToArray(balances).map((b) => ({
    memberId: b.memberId,
    value: b.value,
    unit,
  }));
}

/**
 * Format financial balances for display.
 */
export function formatMoneyBalances(
  balancesByCurrency: Map<string, Map<string, number>>
): MaterializedMoneyBalance[] {
  const result: MaterializedMoneyBalance[] = [];
  for (const [currency, balances] of balancesByCurrency) {
    const arr = financialBalancesToArray(balances, currency);
    result.push(...arr);
  }
  return result;
}
