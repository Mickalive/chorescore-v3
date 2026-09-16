/**
 * ChoreScore V3 — Balances Tab
 *
 * Dual ledger view: Contribution + Argent.
 * Shows who is ahead or behind on each dimension.
 * Period filters (week, month, year, all-time) as VIEWS, never resets.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { ScreenContainer } from '../../src/ui/components/ScreenContainer';
import { Text } from '../../src/ui/components/Text';
import { Card } from '../../src/ui/components/Card';
import { colors, spacing, borderRadius } from '../../src/ui/design-system/theme';
import { useApp } from '../../src/features/app/AppContext';
import { calculateContributionBalances, balancesToArray } from '../../src/domain/calculations/contributionLedger';
import { Member } from '../../src/domain/entities';

type Period = 'week' | 'month' | 'year' | 'all-time';

export default function BalancesScreen() {
  const { currentHouseholdId, repos } = useApp();
  const [period, setPeriod] = useState<Period>('all-time');
  const [members, setMembers] = useState<Member[]>([]);
  const [contributionBalances, setContributionBalances] = useState<Array<{ memberId: string; value: number }>>([]);

  const loadBalances = useCallback(async () => {
    if (!currentHouseholdId) return;

    const householdMembers = await repos.members.getByHousehold(currentHouseholdId);
    setMembers(householdMembers);

    const entries = await repos.contributions.getByHousehold(currentHouseholdId);
    const settlements = await repos.settlements.getByHousehold(currentHouseholdId);
    const memberIds = householdMembers.map((m) => m.id);

    const balances = calculateContributionBalances(entries, 'minutes', settlements, memberIds);
    setContributionBalances(balancesToArray(balances));
  }, [currentHouseholdId, repos]);

  useEffect(() => {
    loadBalances();
  }, [loadBalances]);

  const getMemberName = (memberId: string) => {
    return members.find((m) => m.id === memberId)?.name || 'Inconnu';
  };

  const formatBalance = (value: number) => {
    const abs = Math.abs(value);
    if (value > 0) return `+ ${abs} min`;
    if (value < 0) return `- ${abs} min`;
    return '0 min';
  };

  const getBalanceColor = (value: number) => {
    if (value > 0) return colors.balancePositive;
    if (value < 0) return colors.balanceNegative;
    return colors.textSecondary;
  };

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
              {p === 'week' ? 'Semaine' : p === 'month' ? 'Mois' : p === 'year' ? 'Annee' : 'Tout'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Contribution Ledger */}
      <Text variant="sectionTitle" style={styles.sectionTitle}>
        Contribution
      </Text>
      <Card style={styles.balanceCard}>
        {contributionBalances.length === 0 ? (
          <Text variant="body" style={styles.emptyText}>
            Aucune contribution pour cette periode.
          </Text>
        ) : (
          contributionBalances.map((balance) => (
            <View key={balance.memberId} style={styles.balanceRow}>
              <Text variant="body">{getMemberName(balance.memberId)}</Text>
              <Text
                variant="balance"
                color={getBalanceColor(balance.value)}
              >
                {formatBalance(balance.value)}
              </Text>
            </View>
          ))
        )}
      </Card>

      {/* Money Ledger placeholder */}
      <Text variant="sectionTitle" style={styles.sectionTitle}>
        Argent
      </Text>
      <Card style={styles.balanceCard}>
        <Text variant="body" style={styles.emptyText}>
          Aucune depense pour cette periode.
        </Text>
      </Card>
    </ScreenContainer>
  );
}

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
  emptyText: {
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
});
