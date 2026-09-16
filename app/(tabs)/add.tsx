/**
 * ChoreScore V3 — Add Tab
 *
 * Unified entry point for contributions and expenses.
 *
 * Contribution: free label, value (minutes or points), performed-by,
 *   beneficiaries, date, PersistentTask shortcuts. No chrono.
 * Expense: title, amount (integer minor units), currency, paid-by,
 *   participants, equal/custom split, date, note, category.
 *
 * History: compact unified list directly below the form with
 *   cursor-based pagination across both repos (separate cursors,
 *   deterministic merge, no duplicates, no hard cap). Mutations are
 *   optimistic and transactional in local SQLite; the local store is
 *   always the source of truth for the UI.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
} from 'react-native';
import { ScreenContainer } from '../../src/ui/components/ScreenContainer';
import { Text } from '../../src/ui/components/Text';
import { Button } from '../../src/ui/components/Button';
import { Card } from '../../src/ui/components/Card';
import { colors, spacing, borderRadius } from '../../src/ui/design-system/theme';
import { useApp } from '../../src/features/app/AppContext';
import {
  ContributionEntry,
  ExpenseEntry,
  Member,
  ContributionUnit,
  ActivityEntry,
  ExpenseSplitMode,
  ExpenseParticipantShare,
  PersistentTask,
} from '../../src/domain/entities';
import { paginateActivityLog, ActivityFilter } from '../../src/domain/calculations/activityLog';
import { LocalSystemShareAdapter } from '../../src/infrastructure/local/LocalSystemShareAdapter';

// ── Types ──────────────────────────────────────────────────────

type EntryMode = 'contribution' | 'expense';

interface ContributionFormData {
  label: string;
  value: string;
  performedByMemberId: string;
  beneficiaryMemberIds: string[];
  occurredAt: Date;
  persistentTaskId: string | null;
}

interface ExpenseFormData {
  title: string;
  amountRaw: string; // user-entered string, e.g. "42.50"
  currency: string;
  paidByMemberId: string;
  participantMemberIds: string[];
  splitMode: ExpenseSplitMode;
  customShares: Record<string, string>; // memberId -> amountRaw string
  note: string;
  category: string;
  occurredAt: Date;
}

const DEFAULT_CURRENCY = 'CHF';
const PAGE_SIZE = 15;
const EXPENSE_CATEGORIES = [
  'Alimentation',
  'Transport',
  'Logement',
  'Loisirs',
  'Sante',
  'Autre',
];

// ── Helpers ────────────────────────────────────────────────────

function todayLocal(): Date {
  return new Date();
}

function formatAmountMinor(amountMinor: number, currency: string): string {
  const whole = Math.floor(amountMinor / 100);
  const cents = amountMinor % 100;
  return `${currency} ${whole}.${cents.toString().padStart(2, '0')}`;
}

function parseAmountToMinor(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.,]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const num = parseFloat(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${day}/${month} ${hours}:${minutes}`;
}

function formatDateTimeShort(d: Date): string {
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${day}/${month} ${hours}:${minutes}`;
}

// ── Component ──────────────────────────────────────────────────

export default function AddScreen() {
  const { currentHouseholdId, repos, currentUser } = useApp();
  const [mode, setMode] = useState<EntryMode>('contribution');
  const [members, setMembers] = useState<Member[]>([]);
  const [householdUnit, setHouseholdUnit] = useState<ContributionUnit>('minutes');

  // Contribution form
  const [cForm, setCForm] = useState<ContributionFormData>({
    label: '',
    value: '',
    performedByMemberId: '',
    beneficiaryMemberIds: [],
    occurredAt: todayLocal(),
    persistentTaskId: null,
  });

  // Expense form
  const [eForm, setEForm] = useState<ExpenseFormData>({
    title: '',
    amountRaw: '',
    currency: DEFAULT_CURRENCY,
    paidByMemberId: '',
    participantMemberIds: [],
    splitMode: 'equal',
    customShares: {},
    note: '',
    category: '',
    occurredAt: todayLocal(),
  });

  // History
  const [historyContributions, setHistoryContributions] = useState<ContributionEntry[]>([]);
  const [historyExpenses, setHistoryExpenses] = useState<ExpenseEntry[]>([]);
  const [historyContribCursor, setHistoryContribCursor] = useState<string | null>(null);
  const [historyExpenseCursor, setHistoryExpenseCursor] = useState<string | null>(null);
  const [historyContribExhausted, setHistoryContribExhausted] = useState(false);
  const [historyExpenseExhausted, setHistoryExpenseExhausted] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<ActivityFilter>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [persistentTasks, setPersistentTasks] = useState<PersistentTask[]>([]);

  // Track whether initial load is done so filter effect doesn't double-fetch
  const initialLoadDoneRef = useRef(false);

  // Edit state
  const [editingEntry, setEditingEntry] = useState<ActivityEntry | null>(null);

  // ── Load members + household settings ──────────────────────

  const loadHousehold = useCallback(async () => {
    if (!currentHouseholdId) return;
    const householdMembers = await repos.members.getByHousehold(currentHouseholdId);
    setMembers(householdMembers);

    const household = await repos.households.getById(currentHouseholdId);
    if (household) {
      setHouseholdUnit(household.contributionUnit);
    }

    // Load persistent tasks for shortcuts
    const tasks = await repos.tasks.getByHousehold(currentHouseholdId);
    setPersistentTasks(tasks);

    // Set defaults for member selectors
    if (householdMembers.length > 0) {
      setCForm((prev) => ({
        ...prev,
        performedByMemberId: prev.performedByMemberId || householdMembers[0].id,
        beneficiaryMemberIds:
          prev.beneficiaryMemberIds.length > 0
            ? prev.beneficiaryMemberIds
            : householdMembers.map((m) => m.id),
      }));
      setEForm((prev) => ({
        ...prev,
        paidByMemberId: prev.paidByMemberId || householdMembers[0].id,
        participantMemberIds:
          prev.participantMemberIds.length > 0
            ? prev.participantMemberIds
            : householdMembers.map((m) => m.id),
      }));
    }
  }, [currentHouseholdId, repos]);

  // ── Load history (per-repo cursors, deterministic merge) ────

  const loadHistory = useCallback(
    async (loadMore: boolean = false) => {
      if (!currentHouseholdId) return;

      // Skip repos that are already exhausted (cursor=null, hasMore=false)
      const contribCursor = loadMore ? historyContribCursor : null;
      const expenseCursor = loadMore ? historyExpenseCursor : null;

      const contribResult =
        loadMore && historyContribExhausted
          ? { items: [], cursor: null, hasMore: false }
          : await repos.contributions.getByHouseholdPaginated(
              currentHouseholdId,
              { limit: PAGE_SIZE, cursor: contribCursor ?? undefined }
            );
      const expenseResult =
        loadMore && historyExpenseExhausted
          ? { items: [], cursor: null, hasMore: false }
          : await repos.expenses.getByHouseholdPaginated(
              currentHouseholdId,
              { limit: PAGE_SIZE, cursor: expenseCursor ?? undefined }
            );

      if (!loadMore) {
        // First page — replace
        setHistoryContributions(contribResult.items);
        setHistoryExpenses(expenseResult.items);
      } else {
        // Append
        setHistoryContributions((prev) => [...prev, ...contribResult.items]);
        setHistoryExpenses((prev) => [...prev, ...expenseResult.items]);
      }

      // Per-repo cursors: each advances independently
      setHistoryContribCursor(contribResult.cursor);
      setHistoryExpenseCursor(expenseResult.cursor);
      setHistoryContribExhausted(contribResult.cursor === null && !contribResult.hasMore);
      setHistoryExpenseExhausted(expenseResult.cursor === null && !expenseResult.hasMore);
      setHistoryHasMore(contribResult.hasMore || expenseResult.hasMore);
    },
    [currentHouseholdId, repos, historyContribCursor, historyExpenseCursor, historyContribExhausted, historyExpenseExhausted]
  );

  // ── Initial load (single effect, no redundant double-fetch) ──

  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;

    const load = async () => {
      await loadHousehold();
      await loadHistory(false);
    };
    load();
  }, [loadHousehold, loadHistory]);

  // ── Filter change reloads (after initial load only) ─────────

  const prevFilterRef = useRef(historyFilter);

  useEffect(() => {
    if (!initialLoadDoneRef.current) return;
    if (prevFilterRef.current === historyFilter) return;
    prevFilterRef.current = historyFilter;
    // Filter is applied in useMemo below; no re-fetch needed
  }, [historyFilter]);

  // ── Merged + paginated activity entries (no hard cap) ─────
  // Repos already handle per-page limits; the merge step just
  // combines, sorts by occurredAt DESC, and applies the type filter.
  // We pass a large limit so all accumulated entries are shown.

  const activityEntries = useMemo(() => {
    const result = paginateActivityLog(historyContributions, historyExpenses, [], {
      limit: 10_000,
      filter: historyFilter,
    });
    return result.entries;
  }, [historyContributions, historyExpenses, historyFilter]);

  // ── Member name helper ────────────────────────────────────

  const memberName = useCallback(
    (memberId: string) => members.find((m) => m.id === memberId)?.name || 'Inconnu',
    [members]
  );

  // ── Submit contribution (optimistic) ──────────────────────

  const submitContribution = async () => {
    if (!currentHouseholdId || !cForm.label.trim() || !cForm.value) return;
    const numericValue = parseFloat(cForm.value);
    if (isNaN(numericValue) || numericValue <= 0) return;

    setIsSubmitting(true);
    try {
      const entryData = {
        householdId: currentHouseholdId,
        label: cForm.label.trim(),
        performedByMemberId: cForm.performedByMemberId,
        beneficiaryMemberIds:
          cForm.beneficiaryMemberIds.length > 0
            ? cForm.beneficiaryMemberIds
            : members.map((m) => m.id),
        value: numericValue,
        unit: householdUnit,
        persistentTaskId: cForm.persistentTaskId,
        occurredAt: cForm.occurredAt.toISOString(),
        createdBy: currentUser?.userId || '',
      };

      // Optimistic write: write to local store immediately
      const created = await repos.contributions.create(entryData);

      // Update local history immediately (optimistic UI)
      setHistoryContributions((prev) => [created, ...prev]);

      // Reset form
      setCForm({
        label: '',
        value: '',
        performedByMemberId: cForm.performedByMemberId,
        beneficiaryMemberIds: cForm.beneficiaryMemberIds,
        occurredAt: todayLocal(),
        persistentTaskId: null,
      });
    } catch {
      Alert.alert('Erreur', 'Impossible d\'ajouter la contribution.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Submit expense (optimistic) ──────────────────────────

  const submitExpense = async () => {
    if (!currentHouseholdId || !eForm.title.trim() || !eForm.amountRaw) return;
    const amountMinor = parseAmountToMinor(eForm.amountRaw);
    if (amountMinor === null) return;
    if (eForm.participantMemberIds.length === 0) return;

    setIsSubmitting(true);
    try {
      // Compute custom shares if custom split
      let customShares: ExpenseParticipantShare[] | undefined;
      if (eForm.splitMode === 'custom') {
        customShares = eForm.participantMemberIds.map((memberId) => ({
          memberId,
          amountMinor: parseAmountToMinor(eForm.customShares[memberId] || '0') || 0,
        }));
      }

      const entryData = {
        householdId: currentHouseholdId,
        title: eForm.title.trim(),
        amountMinor,
        currency: eForm.currency.toUpperCase() || DEFAULT_CURRENCY,
        paidByMemberId: eForm.paidByMemberId,
        participantMemberIds: eForm.participantMemberIds,
        splitMode: eForm.splitMode,
        customShares,
        note: eForm.note.trim() || undefined,
        category: eForm.category || undefined,
        occurredAt: eForm.occurredAt.toISOString(),
        createdBy: currentUser?.userId || '',
      };

      // Optimistic write
      const created = await repos.expenses.create(entryData);

      // Update local history immediately
      setHistoryExpenses((prev) => [created, ...prev]);

      // Reset form
      setEForm({
        title: '',
        amountRaw: '',
        currency: eForm.currency,
        paidByMemberId: eForm.paidByMemberId,
        participantMemberIds: eForm.participantMemberIds,
        splitMode: 'equal',
        customShares: {},
        note: '',
        category: '',
        occurredAt: todayLocal(),
      });
    } catch {
      Alert.alert('Erreur', 'Impossible d\'ajouter la depense.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Edit entry ───────────────────────────────────────────

  const startEdit = (entry: ActivityEntry) => {
    setEditingEntry(entry);
    if (entry.type === 'contribution') {
      const e = entry.entry as ContributionEntry;
      setMode('contribution');
      setCForm({
        label: e.label,
        value: e.value.toString(),
        performedByMemberId: e.performedByMemberId,
        beneficiaryMemberIds: e.beneficiaryMemberIds,
        occurredAt: new Date(e.occurredAt),
        persistentTaskId: e.persistentTaskId,
      });
    } else if (entry.type === 'expense') {
      const e = entry.entry as ExpenseEntry;
      setMode('expense');
      const customSharesRaw: Record<string, string> = {};
      if (e.customShares) {
        for (const s of e.customShares) {
          customSharesRaw[s.memberId] = (s.amountMinor / 100).toFixed(2);
        }
      }
      setEForm({
        title: e.title,
        amountRaw: (e.amountMinor / 100).toFixed(2),
        currency: e.currency,
        paidByMemberId: e.paidByMemberId,
        participantMemberIds: e.participantMemberIds,
        splitMode: e.splitMode,
        customShares: customSharesRaw,
        note: e.note || '',
        category: e.category || '',
        occurredAt: new Date(e.occurredAt),
      });
    }
  };

  const cancelEdit = () => {
    setEditingEntry(null);
    setCForm((prev) => ({
      ...prev,
      label: '',
      value: '',
      occurredAt: todayLocal(),
      persistentTaskId: null,
    }));
    setEForm((prev) => ({
      ...prev,
      title: '',
      amountRaw: '',
      note: '',
      category: '',
      occurredAt: todayLocal(),
    }));
  };

  const submitEdit = async () => {
    if (!editingEntry) return;

    try {
      if (editingEntry.type === 'contribution') {
        const existing = editingEntry.entry as ContributionEntry;
        const numericValue = parseFloat(cForm.value);
        if (isNaN(numericValue) || numericValue <= 0) return;

        // Optimistic update
        const updated = await repos.contributions.update(existing.id, {
          label: cForm.label.trim(),
          performedByMemberId: cForm.performedByMemberId,
          beneficiaryMemberIds: cForm.beneficiaryMemberIds,
          value: numericValue,
          occurredAt: cForm.occurredAt.toISOString(),
          modifiedBy: currentUser?.userId,
        });

        // Replace in local history
        setHistoryContributions((prev) =>
          prev.map((e) => (e.id === updated.id ? updated : e))
        );
      } else if (editingEntry.type === 'expense') {
        const existing = editingEntry.entry as ExpenseEntry;
        const amountMinor = parseAmountToMinor(eForm.amountRaw);
        if (amountMinor === null) return;

        let customShares: ExpenseParticipantShare[] | undefined;
        if (eForm.splitMode === 'custom') {
          customShares = eForm.participantMemberIds.map((memberId) => ({
            memberId,
            amountMinor: parseAmountToMinor(eForm.customShares[memberId] || '0') || 0,
          }));
        }

        const updated = await repos.expenses.update(existing.id, {
          title: eForm.title.trim(),
          amountMinor,
          currency: eForm.currency.toUpperCase(),
          paidByMemberId: eForm.paidByMemberId,
          participantMemberIds: eForm.participantMemberIds,
          splitMode: eForm.splitMode,
          customShares,
          note: eForm.note.trim() || undefined,
          category: eForm.category || undefined,
          occurredAt: eForm.occurredAt.toISOString(),
          modifiedBy: currentUser?.userId,
        });

        setHistoryExpenses((prev) =>
          prev.map((e) => (e.id === updated.id ? updated : e))
        );
      }

      setEditingEntry(null);
      cancelEdit();
    } catch {
      Alert.alert('Erreur', 'Impossible de modifier cette entree.');
    }
  };

  // ── Delete entry (with error handling) ─────────────────────

  const handleDelete = (entry: ActivityEntry) => {
    Alert.alert('Supprimer', 'Supprimer cette entree ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          try {
            if (entry.type === 'contribution') {
              await repos.contributions.delete(entry.entry.id);
              setHistoryContributions((prev) =>
                prev.filter((e) => e.id !== entry.entry.id)
              );
            } else if (entry.type === 'expense') {
              await repos.expenses.delete(entry.entry.id);
              setHistoryExpenses((prev) =>
                prev.filter((e) => e.id !== entry.entry.id)
              );
            }
          } catch {
            Alert.alert('Erreur', 'Impossible de supprimer cette entree.');
          }
        },
      },
    ]);
  };

  // ── Share entry ───────────────────────────────────────────

  const handleShare = async (entry: ActivityEntry) => {
    let message = '';
    if (entry.type === 'contribution') {
      const e = entry.entry as ContributionEntry;
      message = `${e.label} - ${e.value} ${householdUnit === 'minutes' ? 'min' : 'pts'} par ${memberName(e.performedByMemberId)} (${formatDateShort(e.occurredAt)})`;
    } else if (entry.type === 'expense') {
      const e = entry.entry as ExpenseEntry;
      message = `${e.title} - ${formatAmountMinor(e.amountMinor, e.currency)} paye par ${memberName(e.paidByMemberId)} (${formatDateShort(e.occurredAt)})`;
    }
    if (message) {
      const shareAdapter = new LocalSystemShareAdapter();
      await shareAdapter.share({ message });
    }
  };

  // ── Toggle member in beneficiary/participant list ─────────

  const toggleBeneficiary = (memberId: string) => {
    setCForm((prev) => {
      const ids = prev.beneficiaryMemberIds.includes(memberId)
        ? prev.beneficiaryMemberIds.filter((id) => id !== memberId)
        : [...prev.beneficiaryMemberIds, memberId];
      return { ...prev, beneficiaryMemberIds: ids };
    });
  };

  const toggleParticipant = (memberId: string) => {
    setEForm((prev) => {
      const ids = prev.participantMemberIds.includes(memberId)
        ? prev.participantMemberIds.filter((id) => id !== memberId)
        : [...prev.participantMemberIds, memberId];
      return { ...prev, participantMemberIds: ids };
    });
  };

  // ── Render ─────────────────────────────────────────────────

  const unitLabel = householdUnit === 'minutes' ? 'min' : 'pts';

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text variant="screenTitle">Ajouter</Text>
      </View>

      {/* Mode switch */}
      <View style={styles.modeSwitch}>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'contribution' && styles.modeButtonActive]}
          onPress={() => { setMode('contribution'); cancelEdit(); }}
        >
          <Text
            variant="tabLabel"
            color={mode === 'contribution' ? colors.textOnPrimary : colors.textSecondary}
          >
            Contribution
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'expense' && styles.modeButtonActive]}
          onPress={() => { setMode('expense'); cancelEdit(); }}
        >
          <Text
            variant="tabLabel"
            color={mode === 'expense' ? colors.textOnPrimary : colors.textSecondary}
          >
            Depense
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Contribution Form ────────────────────────────── */}
      {mode === 'contribution' && (
        <Card style={styles.formCard}>
          {editingEntry && editingEntry.type === 'contribution' && (
            <View style={styles.editBanner}>
              <Text variant="caption" color={colors.primary}>Modification</Text>
              <Button title="Annuler" variant="ghost" size="small" onPress={cancelEdit} />
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text variant="caption">Libelle</Text>
            <TextInput
              style={styles.input}
              value={cForm.label}
              onChangeText={(t) => setCForm((p) => ({ ...p, label: t }))}
              placeholder="Ex: Vaisselle, Courses..."
              placeholderTextColor={colors.textMuted}
            />
          </View>

          {/* PersistentTask shortcuts */}
          {persistentTasks.length > 0 && (
            <View style={styles.inputGroup}>
              <Text variant="caption">Raccourcis</Text>
              <View style={styles.memberRow}>
                {persistentTasks.map((pt) => (
                  <TouchableOpacity
                    key={pt.id}
                    style={[
                      styles.memberChip,
                      cForm.persistentTaskId === pt.id && styles.memberChipActive,
                    ]}
                    onPress={() => {
                      if (cForm.persistentTaskId === pt.id) {
                        // Deselect: clear persistentTaskId
                        setCForm((p) => ({ ...p, persistentTaskId: null }));
                      } else {
                        // Select: prefill label, value, and beneficiaries
                        setCForm((p) => ({
                          ...p,
                          persistentTaskId: pt.id,
                          label: pt.name,
                          value: pt.defaultValue.toString(),
                          beneficiaryMemberIds:
                            pt.defaultBeneficiaryMemberIds && pt.defaultBeneficiaryMemberIds.length > 0
                              ? pt.defaultBeneficiaryMemberIds
                              : p.beneficiaryMemberIds,
                        }));
                      }
                    }}
                  >
                    <Text
                      variant="caption"
                      color={
                        cForm.persistentTaskId === pt.id
                          ? colors.textOnPrimary
                          : colors.textSecondary
                      }
                    >
                      {pt.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text variant="caption">Valeur ({unitLabel})</Text>
            <TextInput
              style={styles.input}
              value={cForm.value}
              onChangeText={(t) => setCForm((p) => ({ ...p, value: t }))}
              placeholder={householdUnit === 'minutes' ? '15' : '3'}
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
            />
          </View>

          {/* Fait par */}
          <View style={styles.inputGroup}>
            <Text variant="caption">Fait par</Text>
            <View style={styles.memberRow}>
              {members.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={[
                    styles.memberChip,
                    cForm.performedByMemberId === m.id && styles.memberChipActive,
                  ]}
                  onPress={() => setCForm((p) => ({ ...p, performedByMemberId: m.id }))}
                >
                  <Text
                    variant="caption"
                    color={
                      cForm.performedByMemberId === m.id
                        ? colors.textOnPrimary
                        : colors.textSecondary
                    }
                  >
                    {m.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Fait pour */}
          <View style={styles.inputGroup}>
            <Text variant="caption">Fait pour</Text>
            <View style={styles.memberRow}>
              {members.map((m) => {
                const selected = cForm.beneficiaryMemberIds.includes(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.memberChip, selected && styles.memberChipActive]}
                    onPress={() => toggleBeneficiary(m.id)}
                  >
                    <Text
                      variant="caption"
                      color={selected ? colors.textOnPrimary : colors.textSecondary}
                    >
                      {m.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Date / Heure */}
          <View style={styles.inputGroup}>
            <Text variant="caption">Date / Heure</Text>
            <TouchableOpacity
              style={styles.dateTimeButton}
              onPress={() => {
                Alert.alert(
                  'Date / Heure',
                  formatDateTimeShort(cForm.occurredAt),
                  [
                    { text: 'Maintenant', onPress: () => setCForm((p) => ({ ...p, occurredAt: new Date() })) },
                    { text: 'Il y a 1h', onPress: () => setCForm((p) => ({ ...p, occurredAt: new Date(Date.now() - 3600000) })) },
                    { text: 'Hier', onPress: () => {
                      const d = new Date(); d.setDate(d.getDate() - 1); setCForm((p) => ({ ...p, occurredAt: d }));
                    }},
                    { text: 'Annuler', style: 'cancel' },
                  ]
                );
              }}
            >
              <Text variant="body">{formatDateTimeShort(cForm.occurredAt)}</Text>
            </TouchableOpacity>
          </View>

          <Button
            title={editingEntry ? 'Mettre a jour' : 'Ajouter contribution'}
            variant="primary"
            onPress={editingEntry ? submitEdit : submitContribution}
            disabled={!cForm.label.trim() || !cForm.value || isSubmitting}
            loading={isSubmitting}
            style={styles.submitButton}
          />
        </Card>
      )}

      {/* ── Expense Form ─────────────────────────────────── */}
      {mode === 'expense' && (
        <Card style={styles.formCard}>
          {editingEntry && editingEntry.type === 'expense' && (
            <View style={styles.editBanner}>
              <Text variant="caption" color={colors.primary}>Modification</Text>
              <Button title="Annuler" variant="ghost" size="small" onPress={cancelEdit} />
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text variant="caption">Titre</Text>
            <TextInput
              style={styles.input}
              value={eForm.title}
              onChangeText={(t) => setEForm((p) => ({ ...p, title: t }))}
              placeholder="Ex: Courses Migros..."
              placeholderTextColor={colors.textMuted}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text variant="caption">Montant</Text>
            <View style={styles.amountRow}>
              <TextInput
                style={[styles.input, styles.amountInput]}
                value={eForm.amountRaw}
                onChangeText={(t) => setEForm((p) => ({ ...p, amountRaw: t }))}
                placeholder="42.50"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={[styles.input, styles.currencyInput]}
                value={eForm.currency}
                onChangeText={(t) =>
                  setEForm((p) => ({ ...p, currency: t.toUpperCase().slice(0, 3) }))
                }
                placeholder="CHF"
                placeholderTextColor={colors.textMuted}
                maxLength={3}
                autoCapitalize="characters"
              />
            </View>
          </View>

          {/* Paye par */}
          <View style={styles.inputGroup}>
            <Text variant="caption">Paye par</Text>
            <View style={styles.memberRow}>
              {members.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={[
                    styles.memberChip,
                    eForm.paidByMemberId === m.id && styles.memberChipActive,
                  ]}
                  onPress={() => setEForm((p) => ({ ...p, paidByMemberId: m.id }))}
                >
                  <Text
                    variant="caption"
                    color={
                      eForm.paidByMemberId === m.id
                        ? colors.textOnPrimary
                        : colors.textSecondary
                    }
                  >
                    {m.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Participants */}
          <View style={styles.inputGroup}>
            <Text variant="caption">Participants</Text>
            <View style={styles.memberRow}>
              {members.map((m) => {
                const selected = eForm.participantMemberIds.includes(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.memberChip, selected && styles.memberChipActive]}
                    onPress={() => toggleParticipant(m.id)}
                  >
                    <Text
                      variant="caption"
                      color={selected ? colors.textOnPrimary : colors.textSecondary}
                    >
                      {m.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Split mode */}
          <View style={styles.inputGroup}>
            <Text variant="caption">Repartition</Text>
            <View style={styles.splitRow}>
              <TouchableOpacity
                style={[
                  styles.splitButton,
                  eForm.splitMode === 'equal' && styles.splitButtonActive,
                ]}
                onPress={() => setEForm((p) => ({ ...p, splitMode: 'equal' }))}
              >
                <Text
                  variant="caption"
                  color={
                    eForm.splitMode === 'equal' ? colors.textOnPrimary : colors.textSecondary
                  }
                >
                  Egal
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.splitButton,
                  eForm.splitMode === 'custom' && styles.splitButtonActive,
                ]}
                onPress={() => setEForm((p) => ({ ...p, splitMode: 'custom' }))}
              >
                <Text
                  variant="caption"
                  color={
                    eForm.splitMode === 'custom' ? colors.textOnPrimary : colors.textSecondary
                  }
                >
                  Personnalise
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Custom shares */}
          {eForm.splitMode === 'custom' && (
            <View style={styles.inputGroup}>
              <Text variant="caption">Parts par personne</Text>
              {eForm.participantMemberIds.map((memberId) => (
                <View key={memberId} style={styles.shareRow}>
                  <Text variant="body" style={styles.shareName}>
                    {memberName(memberId)}
                  </Text>
                  <TextInput
                    style={[styles.input, styles.shareInput]}
                    value={eForm.customShares[memberId] || ''}
                    onChangeText={(t) =>
                      setEForm((p) => ({
                        ...p,
                        customShares: { ...p.customShares, [memberId]: t },
                      }))
                    }
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
              ))}
            </View>
          )}

          {/* Category */}
          <View style={styles.inputGroup}>
            <Text variant="caption">Categorie</Text>
            <View style={styles.memberRow}>
              {EXPENSE_CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[
                    styles.memberChip,
                    eForm.category === cat && styles.memberChipActive,
                  ]}
                  onPress={() =>
                    setEForm((p) => ({ ...p, category: p.category === cat ? '' : cat }))
                  }
                >
                  <Text
                    variant="caption"
                    color={
                      eForm.category === cat ? colors.textOnPrimary : colors.textSecondary
                    }
                  >
                    {cat}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Note */}
          <View style={styles.inputGroup}>
            <Text variant="caption">Note (optionnel)</Text>
            <TextInput
              style={styles.input}
              value={eForm.note}
              onChangeText={(t) => setEForm((p) => ({ ...p, note: t }))}
              placeholder="Details..."
              placeholderTextColor={colors.textMuted}
              multiline
            />
          </View>

          {/* Date / Heure */}
          <View style={styles.inputGroup}>
            <Text variant="caption">Date / Heure</Text>
            <TouchableOpacity
              style={styles.dateTimeButton}
              onPress={() => {
                Alert.alert(
                  'Date / Heure',
                  formatDateTimeShort(eForm.occurredAt),
                  [
                    { text: 'Maintenant', onPress: () => setEForm((p) => ({ ...p, occurredAt: new Date() })) },
                    { text: 'Il y a 1h', onPress: () => setEForm((p) => ({ ...p, occurredAt: new Date(Date.now() - 3600000) })) },
                    { text: 'Hier', onPress: () => {
                      const d = new Date(); d.setDate(d.getDate() - 1); setEForm((p) => ({ ...p, occurredAt: d }));
                    }},
                    { text: 'Annuler', style: 'cancel' },
                  ]
                );
              }}
            >
              <Text variant="body">{formatDateTimeShort(eForm.occurredAt)}</Text>
            </TouchableOpacity>
          </View>

          {/* Custom split sum validation */}
          {eForm.splitMode === 'custom' && (() => {
            const totalShares = eForm.participantMemberIds.reduce((sum, mid) => {
              return sum + (parseAmountToMinor(eForm.customShares[mid] || '0') || 0);
            }, 0);
            const totalAmount = parseAmountToMinor(eForm.amountRaw) || 0;
            const isValid = totalAmount === 0 || totalShares === totalAmount;
            return !isValid ? (
              <Text variant="caption" color={colors.balanceNegative} style={{ marginBottom: spacing.sm }}>
                Total parts ({(totalShares / 100).toFixed(2)}) != montant ({(totalAmount / 100).toFixed(2)})
              </Text>
            ) : null;
          })()}

          <Button
            title={editingEntry ? 'Mettre a jour' : 'Ajouter depense'}
            variant="primary"
            onPress={editingEntry ? submitEdit : submitExpense}
            disabled={!eForm.title.trim() || !eForm.amountRaw || isSubmitting}
            loading={isSubmitting}
            style={styles.submitButton}
          />
        </Card>
      )}

      {/* ── History ─────────────────────────────────────── */}
      <View style={styles.historySection}>
        <View style={styles.historyHeader}>
          <Text variant="sectionTitle">Activite</Text>
          <View style={styles.filterRow}>
            {(['all', 'contribution', 'expense'] as ActivityFilter[]).map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.filterChip, historyFilter === f && styles.filterChipActive]}
                onPress={() => setHistoryFilter(f)}
              >
                <Text
                  variant="caption"
                  color={historyFilter === f ? colors.textOnPrimary : colors.textSecondary}
                >
                  {f === 'all' ? 'Tout' : f === 'contribution' ? 'Contrib.' : 'Depenses'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {activityEntries.length === 0 ? (
          <Text variant="body" style={styles.emptyText}>
            Aucune activite pour l'instant.
          </Text>
        ) : (
          activityEntries.map((entry) => (
            <View key={entry.entry.id} style={styles.historyRow}>
              <View style={styles.historyTypeBadge}>
                <Text
                  variant="caption"
                  color={
                    entry.type === 'contribution'
                      ? colors.balancePositive
                      : entry.type === 'expense'
                      ? colors.balanceNegative
                      : colors.textSecondary
                  }
                >
                  {entry.type === 'contribution' ? 'C' : entry.type === 'expense' ? 'D' : 'S'}
                </Text>
              </View>
              <View style={styles.historyInfo}>
                <Text variant="body" numberOfLines={1} style={styles.historyLabel}>
                  {entry.type === 'contribution'
                    ? (entry.entry as ContributionEntry).label
                    : entry.type === 'expense'
                    ? (entry.entry as ExpenseEntry).title
                    : 'Compensation'}
                </Text>
                <Text variant="caption" numberOfLines={1}>
                  {entry.type === 'contribution'
                    ? `${memberName((entry.entry as ContributionEntry).performedByMemberId)} · ${(entry.entry as ContributionEntry).value} ${unitLabel}`
                    : entry.type === 'expense'
                    ? `${memberName((entry.entry as ExpenseEntry).paidByMemberId)} · ${formatAmountMinor((entry.entry as ExpenseEntry).amountMinor, (entry.entry as ExpenseEntry).currency)}`
                    : ''}
                  {' · '}
                  {formatDateShort(entry.entry.occurredAt)}
                </Text>
              </View>
              <View style={styles.historyActions}>
                <TouchableOpacity
                  onPress={() => startEdit(entry)}
                  style={styles.actionButton}
                >
                  <Text variant="caption" color={colors.textSecondary}>
                    Edit
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleShare(entry)}
                  style={styles.actionButton}
                >
                  <Text variant="caption" color={colors.textSecondary}>
                    Share
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDelete(entry)}
                  style={styles.actionButton}
                >
                  <Text variant="caption" color={colors.balanceNegative}>
                    Suppr
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}

        {historyHasMore && (
          <Button
            title="Charger plus"
            variant="secondary"
            onPress={() => loadHistory(true)}
            style={styles.loadMoreButton}
          />
        )}
      </View>
    </ScreenContainer>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.lg,
  },
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.md,
    padding: 2,
    marginBottom: spacing.lg,
  },
  modeButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  modeButtonActive: {
    backgroundColor: colors.primary,
  },
  formCard: {
    marginBottom: spacing.lg,
  },
  editBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    marginTop: spacing.xs,
    fontSize: 16,
    color: colors.text,
  },
  amountRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  amountInput: {
    flex: 1,
  },
  currencyInput: {
    width: 70,
    textAlign: 'center',
  },
  memberRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  memberChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  memberChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  splitRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  splitButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  splitButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  shareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  shareName: {
    flex: 1,
  },
  shareInput: {
    width: 80,
    textAlign: 'right',
    marginTop: 0,
  },
  submitButton: {
    marginTop: spacing.sm,
  },
  dateTimeButton: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  historySection: {
    marginTop: spacing.md,
  },
  historyHeader: {
    marginBottom: spacing.md,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  historyTypeBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  historyInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  historyLabel: {
    marginBottom: 2,
  },
  historyActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  emptyText: {
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  loadMoreButton: {
    marginTop: spacing.md,
  },
});
