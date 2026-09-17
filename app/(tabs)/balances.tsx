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
 * Materialized for display efficiency; delta-based refresh on data change.
 *
 * Settlements are period-filtered: a settlement outside the period does not
 * affect the period view but remains in all-time. Materialized snapshots
 * are refreshed via delta on data change or focus, not full replay.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ScreenContainer } from '../../src/ui/components/ScreenContainer';
import { Text } from '../../src/ui/components/Text';
import { Card } from '../../src/ui/components/Card';
import { Button } from '../../src/ui/components/Button';
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
  ActivityEntry,
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
import { validateSettlementPreconditions } from '../../src/domain/calculations/settlementPreconditions';
import {
  createBalanceSnapshot,
  BalanceSnapshot,
  deltaUpdateContribution,
  deltaUpdateContributionFromSettlement,
  deltaUpdateMoneyFromSettlement,
} from '../../src/domain/calculations/materializedBalances';
import {
  paginateActivityLog,
  ActivityFilter,
  ActivityLogPage,
} from '../../src/domain/calculations/activityLog';

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

function formatActivityRow(entry: ActivityEntry, memberName: (id: string) => string, unit: ContributionUnit): string {
  switch (entry.type) {
    case 'contribution': {
      const e = entry.entry;
      const val = formatContributionValue(e.value, unit);
      return `${e.label}  ${val}  ${memberName(e.performedByMemberId)} → ${e.beneficiaryMemberIds.map(memberName).join(', ')}`;
    }
    case 'expense': {
      const e = entry.entry;
      return `${e.title}  ${formatMoneyAmount(e.amountMinor, e.currency)}  ${memberName(e.paidByMemberId)} → ${e.participantMemberIds.map(memberName).join(', ')}`;
    }
    case 'cross-ledger-settlement': {
      const e = entry.entry;
      const contrib = formatContributionValue(-e.contributionValue, e.contributionUnit);
      const money = formatMoneyAmount(e.moneyAmountMinor, e.currency);
      return `Compensation  ${memberName(e.contributionCreditorMemberId)} ${contrib} ↔ ${money}`;
    }
  }
}

const PERIOD_LABELS: Record<Period, string> = {
  week: 'Semaine',
  month: 'Mois',
  year: 'Annee',
  'all-time': 'Tout',
};

const HISTORY_FILTER_LABELS: Record<ActivityFilter, string> = {
  all: 'Tout',
  contribution: 'Contributions',
  expense: 'Depenses',
  settlement: 'Compensations',
};

const HISTORY_PAGE_SIZE = 20;

// ── Component ──────────────────────────────────────────────────

export default function BalancesScreen() {
  const { currentHouseholdId, repos, subscribeToDataChanges, emitDataChange } = useApp();
  const [period, setPeriod] = useState<Period>('all-time');
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [contributions, setContributions] = useState<ContributionEntry[]>([]);
  const [expenses, setExpenses] = useState<ExpenseEntry[]>([]);
  const [settlements, setSettlements] = useState<CrossLedgerSettlement[]>([]);

  // Materialized balance snapshot (all-time, for delta refresh)
  const snapshotRef = useRef<BalanceSnapshot | null>(null);

  // Track whether a full re-read is needed (initial load or household change)
  const initialLoadDoneRef = useRef(false);
  const lastHouseholdIdRef = useRef<string | null>(null);

  // Compenser modal state
  const [showCompenser, setShowCompenser] = useState(false);
  const [compenserCreditor, setCompenserCreditor] = useState<string>('');
  const [compenserValue, setCompenserValue] = useState<string>('');
  const [compenserError, setCompenserError] = useState<string | null>(null);

  // History filter state
  const [historyFilter, setHistoryFilter] = useState<ActivityFilter>('all');
  const [historyPage, setHistoryPage] = useState<ActivityLogPage | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Full load (initial / household change) ──────────────────

  const fullLoad = useCallback(async () => {
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

    // Build initial materialized snapshot (all-time)
    const memberIds = mems.map((m) => m.id);
    const unit = hh?.contributionUnit ?? 'minutes';
    snapshotRef.current = createBalanceSnapshot(
      contribs, exps, sett, unit, memberIds, 'all-time'
    );

    initialLoadDoneRef.current = true;
    lastHouseholdIdRef.current = currentHouseholdId;
  }, [currentHouseholdId, repos]);

  // ── Delta refresh (data-change signal) ──────────────────────
  // Re-reads only the changed collection type and applies delta
  // to the materialized snapshot.  No full re-read, no full replay.

  const handleDataChange = useCallback(async (
    type: 'contribution' | 'expense' | 'settlement' | 'household' | 'member',
    hhId: string,
  ) => {
    if (!currentHouseholdId || hhId !== currentHouseholdId) return;
    if (!initialLoadDoneRef.current || !snapshotRef.current) return;

    const unit = household?.contributionUnit ?? 'minutes';
    const memberIds = members.map((m) => m.id);

    switch (type) {
      case 'contribution': {
        // Re-read only contributions, apply delta against current snapshot
        const newContribs = await repos.contributions.getByHousehold(currentHouseholdId);
        const oldIds = new Set(contributions.map((c) => c.id));
        const added = newContribs.filter((c) => !oldIds.has(c.id));

        let snap = snapshotRef.current;
        for (const entry of added) {
          snap = {
            ...snap,
            contribution: deltaUpdateContribution(snap.contribution, entry, unit, memberIds, 'add'),
          };
        }
        snapshotRef.current = snap;
        setContributions(newContribs);
        break;
      }
      case 'expense': {
        const newExps = await repos.expenses.getByHousehold(currentHouseholdId);
        const oldIds = new Set(expenses.map((e) => e.id));
        const added = newExps.filter((e) => !oldIds.has(e.id));

        let snap = snapshotRef.current;
        for (const entry of added) {
          // Expense delta: paidBy gets +amountMinor, each participant share gets -amountMinor
          // For equal split, each participant bears amountMinor/count
          const count = entry.participantMemberIds.length;
          const share = Math.floor(entry.amountMinor / count);
          const remainder = entry.amountMinor % count;

          let newMoney = new Map(snap.moneyByCurrency.get(entry.currency) ?? []);
          newMoney.set(entry.paidByMemberId, (newMoney.get(entry.paidByMemberId) ?? 0) + entry.amountMinor);
          for (let i = 0; i < entry.participantMemberIds.length; i++) {
            const pid = entry.participantMemberIds[i];
            const deduction = share + (i < remainder ? 1 : 0);
            newMoney.set(pid, (newMoney.get(pid) ?? 0) - deduction);
          }
          const newMoneyByCurrency = new Map(snap.moneyByCurrency);
          newMoneyByCurrency.set(entry.currency, newMoney);
          snap = { ...snap, moneyByCurrency: newMoneyByCurrency };
        }
        snapshotRef.current = snap;
        setExpenses(newExps);
        break;
      }
      case 'settlement': {
        const newSett = await repos.settlements.getByHousehold(currentHouseholdId);
        const oldIds = new Set(settlements.map((s) => s.id));
        const added = newSett.filter((s) => !oldIds.has(s.id));

        let snap = snapshotRef.current;
        for (const s of added) {
          snap = {
            contribution: deltaUpdateContributionFromSettlement(snap.contribution, s, unit, 'add'),
            moneyByCurrency: (() => {
              const currencyMap = new Map(snap.moneyByCurrency);
              const currBalances = new Map(currencyMap.get(s.currency) ?? []);
              currencyMap.set(s.currency, deltaUpdateMoneyFromSettlement(currBalances, s, 'add'));
              return currencyMap;
            })(),
          };
        }
        snapshotRef.current = snap;
        setSettlements(newSett);
        break;
      }
      case 'household': {
        const hh = await repos.households.getById(currentHouseholdId);
        setHousehold(hh);
        break;
      }
      case 'member': {
        const mems = await repos.members.getByHousehold(currentHouseholdId);
        setMembers(mems);
        break;
      }
    }
  }, [currentHouseholdId, household, members, contributions, expenses, settlements, repos]);

  // Subscribe to data-change signals
  useEffect(() => {
    const unsub = subscribeToDataChanges(handleDataChange);
    return unsub;
  }, [subscribeToDataChanges, handleDataChange]);

  // Initial load
  useEffect(() => {
    fullLoad();
  }, [fullLoad]);

  // Refresh on screen focus — only if household changed or data may be stale
  useFocusEffect(
    useCallback(() => {
      if (!currentHouseholdId) return;
      if (lastHouseholdIdRef.current !== currentHouseholdId) {
        // Household changed — full reload
        fullLoad();
      }
      // Otherwise, data-change signal handles incremental updates
    }, [currentHouseholdId, fullLoad])
  );

  // ── Member name helper ────────────────────────────────────

  const memberName = useCallback(
    (memberId: string) => members.find((m) => m.id === memberId)?.name || 'Inconnu',
    [members]
  );

  // ── Period-filtered balances ───────────────────────────────

  const unit = household?.contributionUnit ?? 'minutes';
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);

  // Filter entries AND settlements by period — these are VIEW filters, never resets
  const periodContributions = useMemo(
    () => filterByPeriod(contributions, period),
    [contributions, period]
  );

  const periodExpenses = useMemo(
    () => filterByPeriod(expenses, period),
    [expenses, period]
  );

  const periodSettlements = useMemo(
    () => filterByPeriod(settlements, period),
    [settlements, period]
  );

  // Contribution balances (period-filtered, including period-filtered settlements)
  const contributionBalances = useMemo(
    () => {
      // Use materialized snapshot for all-time, recompute for period views
      if (period === 'all-time' && snapshotRef.current) {
        return snapshotRef.current.contribution;
      }
      // Period view: compute from period-filtered entries + period-filtered settlements
      return calculateContributionBalances(periodContributions, unit, periodSettlements, memberIds);
    },
    [periodContributions, unit, periodSettlements, memberIds, period]
  );

  const contributionArray = useMemo(
    () => balancesToArray(contributionBalances),
    [contributionBalances]
  );

  // Money balances (period-filtered, including period-filtered settlements)
  const moneyBalancesByCurrency = useMemo(
    () => {
      if (period === 'all-time' && snapshotRef.current) {
        return snapshotRef.current.moneyByCurrency;
      }
      return calculateFinancialBalancesByCurrency(periodExpenses, periodSettlements, memberIds);
    },
    [periodExpenses, periodSettlements, memberIds, period]
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

  // ── Compenser action logic ─────────────────────────────────

  const canCompensate = household?.crossLedgerCompensationEnabled === true
    && household.contributionToMoneyRate !== null;

  // Build Avant/Apres preview for the Compenser modal
  const compenserPreview = useMemo(() => {
    if (!canCompensate || !compenserCreditor || !compenserValue) return null;
    const value = parseFloat(compenserValue);
    if (isNaN(value) || value <= 0) return null;
    const rate = household!.contributionToMoneyRate!;

    // Find a counterparty with positive money balance (creditor in money ledger)
    let counterpartyId: string | null = null;
    for (const [currency, balances] of moneyBalancesByCurrency) {
      if (currency !== rate.currency) continue;
      for (const [memberId, amount] of balances) {
        if (memberId !== compenserCreditor && amount > 0) {
          counterpartyId = memberId;
          break;
        }
      }
      if (counterpartyId) break;
    }
    if (!counterpartyId) return null;

    const moneyAmount = quoteCrossLedgerMoneyAmount(value, unit, rate);
    if (moneyAmount <= 0) return null;

    // Compute before/after for both ledgers
    const contribBefore = balancesToArray(contributionBalances);
    const contribAfter = contribBefore.map((b) => {
      if (b.memberId === compenserCreditor) return { ...b, value: b.value - value };
      if (b.memberId === counterpartyId) return { ...b, value: b.value + value };
      return b;
    });

    const currBalances = moneyBalancesByCurrency.get(rate.currency);
    const moneyBefore = currBalances ? financialBalancesToArray(currBalances, rate.currency) : [];
    const moneyAfter = moneyBefore.map((b) => {
      if (b.memberId === compenserCreditor) return { ...b, amountMinor: b.amountMinor + moneyAmount };
      if (b.memberId === counterpartyId) return { ...b, amountMinor: b.amountMinor - moneyAmount };
      return b;
    });

    return {
      counterpartyId,
      moneyAmount,
      rate,
      contribBefore,
      contribAfter,
      moneyBefore,
      moneyAfter,
    };
  }, [
    canCompensate, compenserCreditor, compenserValue, household,
    unit, contributionBalances, moneyBalancesByCurrency,
  ]);

  const handleCompenserConfirm = useCallback(async () => {
    if (!currentHouseholdId || !household || !compenserPreview) return;
    setCompenserError(null);

    const value = parseFloat(compenserValue);
    const rate = compenserPreview.rate;
    const moneyAmount = compenserPreview.moneyAmount;

    // Create the settlement entity
    const settlementData = {
      householdId: currentHouseholdId,
      contributionCreditorMemberId: compenserCreditor,
      counterpartyMemberId: compenserPreview.counterpartyId,
      contributionValue: value,
      contributionUnit: unit,
      moneyAmountMinor: moneyAmount,
      currency: rate.currency,
      rateSnapshot: rate,
      occurredAt: new Date().toISOString(),
      createdBy: household.ownerId,
    };

    // Run precondition validation
    const result = validateSettlementPreconditions(
      settlementData as any,
      contributions,
      expenses,
      memberIds,
      settlements,
      true
    );

    if (!result.valid) {
      setCompenserError(result.errors[0]);
      return;
    }

    // Persist the immutable settlement — use the returned entity (real id)
    const persistedSettlement = await repos.settlements.create(settlementData);

    // Update local state with the real persisted entity
    const newSettlements = [...settlements, persistedSettlement];
    setSettlements(newSettlements);

    // Apply delta to materialized snapshot — BOTH ledgers
    if (snapshotRef.current) {
      snapshotRef.current = {
        contribution: deltaUpdateContributionFromSettlement(
          snapshotRef.current.contribution, persistedSettlement, unit, 'add'
        ),
        moneyByCurrency: (() => {
          const currencyMap = new Map(snapshotRef.current!.moneyByCurrency);
          const currBalances = new Map(currencyMap.get(persistedSettlement.currency) ?? []);
          currencyMap.set(persistedSettlement.currency, deltaUpdateMoneyFromSettlement(currBalances, persistedSettlement, 'add'));
          return currencyMap;
        })(),
      };
    }

    // Notify other screens (e.g. Ajouter, Todos) that a settlement was created
    emitDataChange('settlement', currentHouseholdId);

    // Close modal and reset
    setShowCompenser(false);
    setCompenserCreditor('');
    setCompenserValue('');
  }, [
    currentHouseholdId, household, compenserPreview, compenserCreditor, compenserValue,
    unit, contributions, expenses, memberIds, settlements, repos, emitDataChange,
  ]);

  // ── History pagination ─────────────────────────────────────

  const loadHistoryPage = useCallback((filter: ActivityFilter, cursor?: string | null) => {
    setHistoryLoading(true);
    const page = paginateActivityLog(contributions, expenses, settlements, {
      limit: HISTORY_PAGE_SIZE,
      filter,
      cursor: cursor ?? null,
    });
    setHistoryPage(page);
    setHistoryLoading(false);
  }, [contributions, expenses, settlements]);

  // Reset history page on filter change
  useEffect(() => {
    loadHistoryPage(historyFilter);
  }, [historyFilter, loadHistoryPage]);

  // ── Render ─────────────────────────────────────────────────

  const unitLabel = unit === 'minutes' ? 'min' : 'pts';

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.scrollContent}>
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

        {/* Cross-ledger compensation info + Compenser action */}
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
            {canCompensate && (
              <Button
                title="Compenser"
                variant="secondary"
                size="small"
                style={{ marginTop: spacing.md }}
                onPress={() => setShowCompenser(true)}
              />
            )}
          </Card>
        )}

        {/* ── Filtered History Section ──────────────────────── */}
        <Text variant="sectionTitle" style={styles.sectionTitle}>
          Activite
        </Text>
        <View style={styles.historyFilterRow}>
          {(['all', 'contribution', 'expense', 'settlement'] as ActivityFilter[]).map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.historyFilterBtn, historyFilter === f && styles.historyFilterBtnActive]}
              onPress={() => setHistoryFilter(f)}
            >
              <Text
                variant="caption"
                color={historyFilter === f ? colors.textOnPrimary : colors.textSecondary}
              >
                {HISTORY_FILTER_LABELS[f]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <Card style={styles.historyCard}>
          {historyPage && historyPage.entries.length > 0 ? (
            <>
              {historyPage.entries.map((entry) => (
                <View key={entry.entry.id} style={styles.historyRow}>
                  <Text variant="body" style={styles.historyText} numberOfLines={2}>
                    {formatActivityRow(entry, memberName, unit)}
                  </Text>
                </View>
              ))}
              {historyPage.hasMore && (
                <TouchableOpacity
                  style={styles.loadMoreBtn}
                  onPress={() => loadHistoryPage(historyFilter, historyPage.cursor)}
                >
                  <Text variant="caption" color={colors.textSecondary}>
                    {historyLoading ? 'Chargement...' : 'Charger plus'}
                  </Text>
                </TouchableOpacity>
              )}
            </>
          ) : (
            <Text variant="body" style={styles.emptyText}>
              Aucune activite.
            </Text>
          )}
        </Card>
      </ScrollView>

      {/* ── Compenser Modal ─────────────────────────────────── */}
      <Modal
        visible={showCompenser}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCompenser(false)}
      >
        <ScreenContainer>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text variant="screenTitle">Compenser</Text>
              <TouchableOpacity onPress={() => setShowCompenser(false)}>
                <Text variant="bodyBold" color={colors.textSecondary}>Fermer</Text>
              </TouchableOpacity>
            </View>

            <Text variant="body" style={styles.modalLabel}>
              Crediteur de contribution (celui qui a un credit positif)
            </Text>
            <View style={styles.memberSelectRow}>
              {memberIds.map((mid) => (
                <TouchableOpacity
                  key={mid}
                  style={[
                    styles.memberSelectBtn,
                    compenserCreditor === mid && styles.memberSelectBtnActive,
                  ]}
                  onPress={() => setCompenserCreditor(mid)}
                >
                  <Text
                    variant="caption"
                    color={compenserCreditor === mid ? colors.textOnPrimary : colors.text}
                  >
                    {memberName(mid)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text variant="body" style={styles.modalLabel}>
              Valeur a compenser ({unitLabel})
            </Text>
            <View style={styles.inputRow}>
              {['15', '30', '60'].map((preset) => (
                <TouchableOpacity
                  key={preset}
                  style={[styles.presetBtn, compenserValue === preset && styles.presetBtnActive]}
                  onPress={() => setCompenserValue(preset)}
                >
                  <Text variant="caption" color={compenserValue === preset ? colors.textOnPrimary : colors.text}>
                    {preset}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {compenserPreview && (
              <Card style={styles.previewCard}>
                <Text variant="bodyBold" style={{ marginBottom: spacing.sm }}>
                  Avant / Apres
                </Text>
                <Text variant="caption" color={colors.textSecondary} style={{ marginBottom: spacing.xs }}>
                  Contribution ({unitLabel})
                </Text>
                {compenserPreview.contribBefore.map((b) => {
                  const after = compenserPreview.contribAfter.find((a) => a.memberId === b.memberId);
                  return (
                    <View key={b.memberId} style={styles.previewRow}>
                      <Text variant="body" style={{ flex: 1 }}>{memberName(b.memberId)}</Text>
                      <Text variant="body" style={{ width: 80, textAlign: 'right' }}>
                        {formatContributionValue(b.value, unit)}
                      </Text>
                      <Text variant="body" style={{ width: 20, textAlign: 'center' }}>→</Text>
                      <Text variant="body" style={{ width: 80, textAlign: 'right' }}>
                        {formatContributionValue(after?.value ?? b.value, unit)}
                      </Text>
                    </View>
                  );
                })}

                <Text variant="caption" color={colors.textSecondary} style={{ marginTop: spacing.md, marginBottom: spacing.xs }}>
                  Argent ({compenserPreview.rate.currency})
                </Text>
                {compenserPreview.moneyBefore.map((b) => {
                  const after = compenserPreview.moneyAfter.find((a) => a.memberId === b.memberId);
                  return (
                    <View key={b.memberId} style={styles.previewRow}>
                      <Text variant="body" style={{ flex: 1 }}>{memberName(b.memberId)}</Text>
                      <Text variant="body" style={{ width: 80, textAlign: 'right' }}>
                        {formatMoneyAmount(b.amountMinor, b.currency)}
                      </Text>
                      <Text variant="body" style={{ width: 20, textAlign: 'center' }}>→</Text>
                      <Text variant="body" style={{ width: 80, textAlign: 'right' }}>
                        {formatMoneyAmount(after?.amountMinor ?? b.amountMinor, b.currency)}
                      </Text>
                    </View>
                  );
                })}

                <Text variant="caption" color={colors.textSecondary} style={{ marginTop: spacing.md }}>
                  Taux snapshot : {compenserPreview.rate.contributionValue} {unitLabel} = {compenserPreview.rate.moneyAmountMinor / 100} {compenserPreview.rate.currency}
                </Text>
                <Text variant="caption" color={colors.textSecondary}>
                  Montant : {compenserPreview.moneyAmount / 100} {compenserPreview.rate.currency}
                </Text>
              </Card>
            )}

            {compenserError && (
              <Text variant="body" color={colors.balanceNegative} style={{ marginTop: spacing.sm }}>
                {compenserError}
              </Text>
            )}

            <Button
              title="Confirmer la compensation"
              disabled={!compenserPreview}
              onPress={handleCompenserConfirm}
              style={{ marginTop: spacing.lg }}
            />
          </ScrollView>
        </ScreenContainer>
      </Modal>
    </ScreenContainer>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 40,
  },
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
  // History section
  historyFilterRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  historyFilterBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  historyFilterBtnActive: {
    backgroundColor: colors.primary,
  },
  historyCard: {
    marginBottom: spacing.md,
  },
  historyRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  historyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  loadMoreBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  // Compenser modal
  modalContent: {
    padding: spacing.xl,
    paddingBottom: 60,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  modalLabel: {
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  memberSelectRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  memberSelectBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  memberSelectBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  inputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  presetBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  presetBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  previewCard: {
    marginTop: spacing.md,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
});
