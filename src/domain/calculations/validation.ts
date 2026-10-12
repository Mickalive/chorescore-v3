/**
 * ChoreScore V3 — shared domain validation utilities.
 *
 * Validation functions are pure, side-effect-free and throw descriptive
 * Error messages. They are called from ledger calculation functions and
 * from precondition checks before applying mutations.
 */

import { ContributionUnit, ContributionMoneyRate } from '../entities';

// ── Common guards ─────────────────────────────────────────────

export function requireFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite number > 0, got ${value}`);
  }
}

export function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, got ${value}`);
  }
}

export function requireNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer, got ${value}`);
  }
}

export function requireNonEmptyString(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export function requireNoDuplicates(ids: string[], label: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${label} contains duplicate entries`);
  }
}

export function requireDifferentMembers(idA: string, idB: string, label: string): void {
  if (idA === idB) {
    throw new Error(`${label} must reference two different members`);
  }
}

// ── Currency normalization ────────────────────────────────────

export function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new Error(`Invalid currency '${currency}'. Expected a 3-letter code.`);
  }
  return normalized;
}

// ── Contribution-specific validation ─────────────────────────

export function validateContributionUnit(unit: ContributionUnit): void {
  if (unit !== 'minutes' && unit !== 'points') {
    throw new Error(`Invalid contribution unit '${unit}'. Expected 'minutes' or 'points'.`);
  }
}

export function validateContributionValue(value: number, id: string): void {
  requireFinitePositive(value, `Contribution ${id} value`);
}

export function validateContributionMemberIds(
  performedByMemberId: string,
  beneficiaryMemberIds: string[],
  id: string
): void {
  requireNonEmptyString(performedByMemberId, `Contribution ${id} performedByMemberId`);
  if (beneficiaryMemberIds.length === 0) {
    throw new Error(`Contribution ${id} must have at least one beneficiary`);
  }
  requireNoDuplicates(beneficiaryMemberIds, `Contribution ${id} beneficiaryMemberIds`);
}

// ── Expense-specific validation ───────────────────────────────

export function validateExpenseAmount(amountMinor: number, id: string): void {
  requirePositiveInteger(amountMinor, `Expense ${id} amountMinor`);
}

export function validateExpenseCurrency(currency: string): string {
  return normalizeCurrency(currency);
}

export function validateExpenseParticipants(
  paidByMemberId: string,
  participantMemberIds: string[],
  id: string
): void {
  requireNonEmptyString(paidByMemberId, `Expense ${id} paidByMemberId`);
  if (participantMemberIds.length === 0) {
    throw new Error(`Expense ${id} must have at least one participant`);
  }
  requireNoDuplicates(participantMemberIds, `Expense ${id} participantMemberIds`);
}

// ── Settlement validation ─────────────────────────────────────

export function validateSettlementRateConsistency(
  settlementUnit: ContributionUnit,
  settlementCurrency: string,
  rate: ContributionMoneyRate,
  id: string
): void {
  validateContributionUnit(rate.contributionUnit);
  if (rate.contributionUnit !== settlementUnit) {
    throw new Error(`Settlement ${id} rate unit does not match settlement unit`);
  }
  if (normalizeCurrency(rate.currency) !== normalizeCurrency(settlementCurrency)) {
    throw new Error(`Settlement ${id} rate currency does not match settlement currency`);
  }
}

export function validateSettlementMembers(
  creditorId: string,
  counterpartyId: string,
  id: string
): void {
  requireDifferentMembers(creditorId, counterpartyId, `Settlement ${id}`);
}

export function validateSettlementAmounts(
  contributionValue: number,
  moneyAmountMinor: number,
  id: string
): void {
  requireFinitePositive(contributionValue, `Settlement ${id} contributionValue`);
  requirePositiveInteger(moneyAmountMinor, `Settlement ${id} moneyAmountMinor`);
}
