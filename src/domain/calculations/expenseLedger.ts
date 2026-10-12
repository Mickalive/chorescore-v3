import {
  CrossLedgerSettlement,
  ExpenseEntry,
  ExpenseParticipantShare,
  MoneyBalance,
  MoneyTransfer,
} from '../entities';
import {
  normalizeCurrency,
  validateExpenseAmount,
  validateExpenseCurrency,
  validateExpenseParticipants,
} from './validation';
import { validateCrossLedgerSettlement } from './crossLedgerSettlement';

function add(map: Map<string, number>, memberId: string, delta: number): void {
  map.set(memberId, (map.get(memberId) ?? 0) + delta);
}

function validateExpenseBase(entry: ExpenseEntry): void {
  validateExpenseAmount(entry.amountMinor, entry.id);
  validateExpenseCurrency(entry.currency);
  validateExpenseParticipants(
    entry.paidByMemberId,
    entry.participantMemberIds,
    entry.id
  );
}

/**
 * Allocate an expense amount deterministically in integer minor units.
 * Equal-split rounding remainder follows participant order, making replay
 * deterministic and keeping the ledger exactly zero-sum.
 */
export function allocateExpense(entry: ExpenseEntry): ExpenseParticipantShare[] {
  validateExpenseBase(entry);

  if (entry.splitMode === 'equal') {
    const count = entry.participantMemberIds.length;
    const base = Math.floor(entry.amountMinor / count);
    const remainder = entry.amountMinor % count;

    return entry.participantMemberIds.map((memberId, index) => ({
      memberId,
      amountMinor: base + (index < remainder ? 1 : 0),
    }));
  }

  const shares = entry.customShares ?? [];
  if (shares.length !== entry.participantMemberIds.length) {
    throw new Error(`Expense ${entry.id} custom split must define one share per participant`);
  }

  const participantSet = new Set(entry.participantMemberIds);
  const shareMembers = new Set(shares.map((share) => share.memberId));
  if (shareMembers.size !== shares.length) {
    throw new Error(`Expense ${entry.id} custom split contains duplicate members`);
  }
  for (const share of shares) {
    if (!participantSet.has(share.memberId)) {
      throw new Error(`Expense ${entry.id} custom split contains a non-participant`);
    }
    if (!Number.isInteger(share.amountMinor) || share.amountMinor < 0) {
      throw new Error(`Expense ${entry.id} custom split amounts must be non-negative integers`);
    }
  }

  const total = shares.reduce((sum, share) => sum + share.amountMinor, 0);
  if (total !== entry.amountMinor) {
    throw new Error(
      `Expense ${entry.id} custom split totals ${total}, expected ${entry.amountMinor}`
    );
  }

  return shares.map((share) => ({ ...share }));
}

/**
 * Compute one currency ledger. Expenses and cross-ledger settlements are
 * replayed as immutable accounting entries.
 *
 * Convention: positive = member has advanced/is owed money; negative = owes.
 */
export function calculateFinancialBalances(
  expenses: ExpenseEntry[],
  currency: string,
  settlements: CrossLedgerSettlement[] = [],
  memberIds: string[] = []
): Map<string, number> {
  const normalizedCurrency = normalizeCurrency(currency);
  const balances = new Map<string, number>();
  for (const memberId of memberIds) balances.set(memberId, 0);

  for (const expense of expenses) {
    if (normalizeCurrency(expense.currency) !== normalizedCurrency) continue;
    const shares = allocateExpense(expense);

    add(balances, expense.paidByMemberId, expense.amountMinor);
    for (const share of shares) {
      add(balances, share.memberId, -share.amountMinor);
    }
  }

  for (const settlement of settlements) {
    if (normalizeCurrency(settlement.currency) !== normalizedCurrency) continue;
    validateCrossLedgerSettlement(settlement);

    // The contribution creditor spends contribution credit in exchange for
    // relief from money debt: their money balance moves upward toward zero.
    add(balances, settlement.contributionCreditorMemberId, settlement.moneyAmountMinor);
    add(balances, settlement.counterpartyMemberId, -settlement.moneyAmountMinor);
  }

  return balances;
}

export function calculateFinancialBalancesByCurrency(
  expenses: ExpenseEntry[],
  settlements: CrossLedgerSettlement[] = [],
  memberIds: string[] = []
): Map<string, Map<string, number>> {
  const currencies = new Set<string>();
  for (const expense of expenses) currencies.add(normalizeCurrency(expense.currency));
  for (const settlement of settlements) currencies.add(normalizeCurrency(settlement.currency));

  const result = new Map<string, Map<string, number>>();
  for (const currency of currencies) {
    result.set(currency, calculateFinancialBalances(expenses, currency, settlements, memberIds));
  }
  return result;
}

export function financialBalancesToArray(
  balances: Map<string, number>,
  currency: string
): MoneyBalance[] {
  const normalizedCurrency = normalizeCurrency(currency);
  return Array.from(balances.entries())
    .map(([memberId, amountMinor]) => ({ memberId, amountMinor, currency: normalizedCurrency }))
    .sort((a, b) => b.amountMinor - a.amountMinor || a.memberId.localeCompare(b.memberId));
}

export function sumFinancialBalances(balances: Map<string, number>): number {
  return Array.from(balances.values()).reduce((sum, amount) => sum + amount, 0);
}

export function financialLedgerIsZeroSum(balances: Map<string, number>): boolean {
  return sumFinancialBalances(balances) === 0;
}

export function suggestMoneyTransfers(
  balances: Map<string, number>,
  currency: string
): MoneyTransfer[] {
  const normalizedCurrency = normalizeCurrency(currency);
  const sorted = financialBalancesToArray(balances, normalizedCurrency);
  const creditors = sorted
    .filter((balance) => balance.amountMinor > 0)
    .map((balance) => ({ ...balance }));
  const debtors = sorted
    .filter((balance) => balance.amountMinor < 0)
    .sort((a, b) => a.amountMinor - b.amountMinor)
    .map((balance) => ({ ...balance }));

  const transfers: MoneyTransfer[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amountMinor = Math.min(creditor.amountMinor, -debtor.amountMinor);

    if (amountMinor > 0) {
      transfers.push({
        fromMemberId: debtor.memberId,
        toMemberId: creditor.memberId,
        amountMinor,
        currency: normalizedCurrency,
      });
    }

    creditor.amountMinor -= amountMinor;
    debtor.amountMinor += amountMinor;

    if (creditor.amountMinor === 0) creditorIndex += 1;
    if (debtor.amountMinor === 0) debtorIndex += 1;
  }

  return transfers;
}
