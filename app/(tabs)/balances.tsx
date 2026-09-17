/**
 * ChoreScore V3 — Balances Tab
 *
 * Dual ledger view: Contribution + Argent.
 * Shows who is ahead or behind on each dimension.
 * Period filters (week, month, year, all-time) as VIEWS, never resets.
 *
 * Settlement suggestions are greedy pairwise transfers.
 * Cross-ledger compensation is disabled by default and requires a
 * group-defined rate. Each settlement produces an immutable
 * CrossLedgerSettlement record with a snapshotted rate.
 *
 * Balances are derived views — they never mutate the underlying ledger.
 * Materialized for display efficiency; full-replay available for verification.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { ScreenContainer } from '../../src/ui/components/ScreenContainer';
import { Text } from '../../src/ui/components/Text';
import { Card } from '../../src/ui/components/Card';
import { colors, spacing, borderRadius } from '../../src/ui/design-system/theme';
import { useApp } from '../../src/features/app/AppContext';
import {
  ContributionEntry,
  ContributionUnit,
  CrossLedgerSettlement,
  ExpenseEntry,
  Household,
  Member,
  ContributionTransfer,
  MoneyTransfer,
} from '../../src/domain/entities';
import {
  calculateContributionBalances,
  balancesToArray,
  suggestContributionTransfers,
  contributionLedgerIsZeroSum,
} from '../../src/domain/calculations/contributionLedger';
import {
  calculateFinancialBalancesByCurrency,
  financialBalancesToArray,
  suggestMoneyTransfers,
  financialLedgerIsZeroSum,
} from '../../src/domain/calculations/expenseLedger';
import { filterByPeriod, Period } from '../../src/domain/calculations/periods';
import { quoteCrossLedgerMoneyAmount } from '../../src/domain/calculations/crossLedgerSettlement';

// ── Helpers ────────────────────────────────────────────────────

function formatContributionValue(value: number, unit: ContributionUnit): string {
  const abs = Math.abs(value);
  const label = unit === 'minutes' ? 'min' : 'pts';
  if (value > 0) return `+ ${abs} ${label}`;
  if (value < 0) return `- ${abs} ${label}`;
  return `0 ${label}`;
}

function formatMoneyAmount(amountMinor: number, currency: string): string {
  const abs = Math.abs(amountMinor);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const formatted = `${whole}.${cents.toString().padStart(2, '0')}`;
  if (amountMinor > 0) return `+ ${currency} ${formatted}`;
  if (amountMinor < 0) return `- ${currency} ${formatted}`;
  return `${currency} 0.00`;
}

function formatTransferContribution(t: ContributionTransfer, memberName: (id: string) => string): string {
  return `${memberName(t.fromMemberId)} → ${memberName(t.toMemberId)} : ${t.value} ${t.unit === 'minutes' ? 'min' : 'pts'}`;
}

function formatTransferMoney(t: MoneyTransfer, memberName: (id: string) => string): string {
  const abs = Math.abs(t.amountMinor);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  return `${memberName(t.fromMemberId)} → ${memberName(t.toMemberId)} : ${t.currency} ${whole}.${cents.toString().padStart(2, '0')}`;
}

const PERIOD_LABELS: Record<Period, string> = {
  week: 'Semaine',
  month: 'Mois',
  year: 'Annee',
  'all-time': 'Tout',
};

// ── Component ──────────────────────────────────────────────────

export default function BalancesScreen() {
  const { currentHouseholdId, repos } = useApp();
  const [period, setPeriod] = useState<Period>('all-time');
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [contributions, setContributions] = useState<ContributionEntry[]>([]);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [settlements, setSettlements] = useState<CrossLedgerSettlement[]>([]);

  // ── Load data ──────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!currentHouseholdId) return;

    const [hh, mems, contribs, exps, sett] = await Promise.all([
      repos.households.getById(currentHouseholdId),
      repos.members.getByHousehold(currentHouseholdId),
      repos.contributions.getByHousehold(currentHouseholdId),
      repos.expenses.getByHousehold(currentHouseholdId),
      repos.settlements.getByHousehold(currentHouseholdId),
    ]);

    setHousehold(hh);
    setMembers(mems);
    setContributions(contribs);
    setExpenses(exps);
    setSettlements(sett);
  }, [currentHouseholdId, repos]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Member name helper ────────────────────────────────────

  const memberName = useCallback(
    (memberId: string) => members.find((m) => m.id === memberId)?.name || 'Inconnu',
    [members]
  );

  // ── Period-filtered balances ───────────────────────────────

  const unit = household?.contributionUnit ?? 'minutes';
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);

  // Filter entries by period — these are VIEW filters, never resets
  const periodContributions = useMemo(
    () => filterByPeriod(contributions, period),
    [contributions, period]
  );

  const periodExpenses = useMemo(
    () => filterByPeriod(expenses, period),
    [expenses, period]
  );

  // Contribution balances
  const contributionBalances = useMemo(
    () => calculateContributionBalances(periodContributions, unit, settlements, memberIds),
    [periodContributions, unit, settlements, memberIds]
  );

  const contributionArray = useMemo(
    () => balancesToArray(contributionBalances),
    [contributionBalances]
  );

  // Money balances (per currency)
  const moneyBalancesByCurrency = useMemo(
    () => calculateFinancialBalancesByCurrency(periodExpenses, settlements, memberIds),
    [periodExpenses, settlements, memberIds]
  );

  // Settlement suggestions
  const contributionSuggestions = useMemo(
    () => suggestContributionTransfers(contributionBalances, unit),
    [contributionBalances, unit]
  );

  const moneySuggestions = useMemo(() => {
    const suggestions: MoneyTransfer[] = [];
    for (const [currency, balances] of moneyBalancesByCurrency) {
      suggestions.push(...suggestMoneyTransfers(balances, currency));
    }
    return suggestions;
  }, [moneyBalancesByCurrency]);

  // Zero-sum checks
  const isContributionZeroSum = useMemo(
    () => contributionLedgerIsZeroSum(contributionBalances),
    [contributionBalances]
  );

  // ── Render ─────────────────────────────────────────────────

  const unitLabel = unit === 'minutes' ? 'min' : 'pts';

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text variant="screenTitle">Balances</Text>
      </View>

      {/* Period filter */}
      <View style={styles.periodSwitch}>
        {(['week', 'month', 'year', 'all-time'] as Period[]).map((p) => (
          <TouchableOpacity
            key={p}
            style={[styles.periodButton, period === p && styles.periodButtonActive]}
            onPress={() => setPeriod(p)}
          >
            <Text
              variant="caption"
              color={period === p ? colors.textOnPrimary : colors.textSecondary}
            >
              {PERIOD_LABELS[p]}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Contribution Ledger Block */}
      <Text variant="sectionTitle" style={styles.sectionTitle}>
        Contribution
      </Text>
      <Card style={styles.balanceCard}>
        {contributionArray.length === 0 ? (
          <Text variant="body" style={styles.emptyText}>
            Aucune contribution pour cette periode.
          </Text>
        ) : (
          contributionArray.map((balance) => (
            <View key={balance.memberId} style={styles.balanceRow}>
              <Text variant="body" style={styles.memberName}>
                {memberName(balance.memberId)}
              </Text>
              <Text
                variant="balance"
                color={
                  balance.value > 0
                    ? colors.balancePositive
                    : balance.value < 0
                    ? colors.balanceNegative
                    : colors.textSecondary
                }
              >
                {formatContributionValue(balance.value, unit)}
              </Text>
            </View>
          ))
        )}
        {contributionArray.length > 0 && (
          <View style={styles.zeroSumBadge}>
            <Text variant="caption" color={isContributionZeroSum ? colors.balancePositive : colors.balanceNegative}>
              {isContributionZeroSum ? '✓ Somme nulle' : '✗ Incoherence'}
            </Text>
          </View>
        )}
      </Card>

      {/* Contribution Settlement Suggestions */}
      {contributionSuggestions.length > 0 && (
        <Card style={styles.suggestionCard}>
          <View style={styles.suggestionHeader}>
            <Text variant="caption" color={colors.textSecondary}>
              Reglages suggerees
            </Text>
          </View>
          {contributionSuggestions.map((t, i) => (
            <View key={i} style={styles.suggestionRow}>
              <Text variant="body" style={styles.suggestionText}>
                {formatTransferContribution(t, memberName)}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {/* Money Ledger Block */}
      <Text variant="sectionTitle" style={styles.sectionTitle}>
        Argent
      </Text>
      {moneyBalancesByCurrency.size === 0 ? (
        <Card style={styles.balanceCard}>
          <Text variant="body" style={styles.emptyText}>
            Aucune depense pour cette periode.
          </Text>
        </Card>
      ) : (
        Array.from(moneyBalancesByCurrency.entries()).map(([currency, balances]) => {
          const arr = financialBalancesToArray(balances, currency);
          const isZeroSum = financialLedgerIsZeroSum(balances);
          return (
            <Card key={currency} style={styles.balanceCard}>
              {arr.map((balance) => (
                <View key={balance.memberId} style={styles.balanceRow}>
                  <Text variant="body" style={styles.memberName}>
                    {memberName(balance.memberId)}
                  </Text>
                  <Text
                    variant="balance"
                    color={
                      balance.amountMinor > 0
                        ? colors.balancePositive
                        : balance.amountMinor < 0
                        ? colors.balanceNegative
                        : colors.textSecondary
                    }
                  >
                    {formatMoneyAmount(balance.amountMinor, currency)}
                  </Text>
                </View>
              ))}
              <View style={styles.zeroSumBadge}>
                <Text variant="caption" color={isZeroSum ? colors.balancePositive : colors.balanceNegative}>
                  {isZeroSum ? '✓ Somme nulle' : '✗ Incoherence'} ({currency})
                </Text>
              </View>
            </Card>
          );
        })
      )}

      {/* Money Settlement Suggestions */}
      {moneySuggestions.length > 0 && (
        <Card style={styles.suggestionCard}>
          <View style={styles.suggestionHeader}>
            <Text variant="caption" color={colors.textSecondary}>
              Reglages suggerees
            </Text>
          </View>
          {moneySuggestions.map((t, i) => (
            <View key={i} style={styles.suggestionRow}>
              <Text variant="body" style={styles.suggestionText}>
                {formatTransferMoney(t, memberName)}
              </Text>
            </View>
          ))}
        </Card>
      )}

      {/* Cross-ledger compensation info */}
      {household && (
        <Card style={styles.compensationCard}>
          <View style={styles.compensationHeader}>
            <Text variant="sectionTitle" style={{ fontSize: 16 }}>
              Compensation
            </Text>
            <View style={[styles.statusBadge, household.crossLedgerCompensationEnabled ? styles.statusEnabled : styles.statusDisabled]}>
              <Text variant="caption" color={colors.textOnPrimary}>
                {household.crossLedgerCompensationEnabled ? 'Activee' : 'Desactivee'}
              </Text>
            </View>
          </View>
          <Text variant="body" style={styles.compensationDescription}>
            {household.crossLedgerCompensationEnabled
              ? `Taux : ${household.contributionToMoneyRate?.contributionValue} ${unitLabel} = ${household.contributionToMoneyRate ? `${household.contributionToMoneyRate.moneyAmountMinor / 100} ${household.contributionToMoneyRate.currency}` : '—'}`
              : 'La compensation entre contribution et argent est desactivee par defaut. Activez-la dans les options du groupe avec un taux defini par le groupe.'}
          </Text>
          {household.crossLedgerCompensationEnabled && household.contributionToMoneyRate && (
            <Text variant="caption" color={colors.textSecondary} style={{ marginTop: spacing.sm }}>
              Chaque compensation produit un enregistrement immuable avec le taux utilise.
            </Text>
          )}
        </Card>
      )}
    </ScreenContainer>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.lg,
  },
  periodSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.md,
    padding: 2,
    marginBottom: spacing.lg,
    gap: 2,
  },
  periodButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  periodButtonActive: {
    backgroundColor: colors.primary,
  },
  sectionTitle: {
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  balanceCard: {
    marginBottom: spacing.md,
  },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  memberName: {
    flex: 1,
  },
  zeroSumBadge: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  suggestionCard: {
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceAlt,
  },
  suggestionHeader: {
    marginBottom: spacing.sm,
  },
  suggestionRow: {
    paddingVertical: spacing.xs,
  },
  suggestionText: {
    fontSize: 14,
  },
  emptyText: {
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  compensationCard: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  compensationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  statusEnabled: {
    backgroundColor: colors.balancePositive,
  },
  statusDisabled: {
    backgroundColor: colors.textMuted,
  },
  compensationDescription: {
    lineHeight: 20,
  },
});
