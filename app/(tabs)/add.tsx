/**
 * ChoreScore V4 — Add Tab
 *
 * Unified entry point for tasks and expenses.
 *
 * Task: free label, value (minutes or points), performed-by, beneficiaries,
 *   user-created category, equal / category-default / custom split, optional
 *   note + photo, date, PersistentTask shortcuts. No chrono.
 * Expense: title, amount (integer minor units), currency, paid-by,
 *   participants, equal/custom split, user-created category, optional
 *   note + photo, date.
 *
 * Categories are user-created only: a group starts with zero categories and
 * the category manager lives under the add action. No imposed taxonomy.
 *
 * Below the form: a Members section (list, add-by-name, invite link) replaces
 * the old activity history, which now lives under Balances.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ScreenContainer } from '../../src/ui/components/ScreenContainer';
import { Text } from '../../src/ui/components/Text';
import { Button } from '../../src/ui/components/Button';
import { Card } from '../../src/ui/components/Card';
import { colors, spacing, borderRadius } from '../../src/ui/design-system/theme';
import { useApp } from '../../src/features/app/AppContext';
import { useI18n } from '../../src/i18n';
import {
  Attachment,
  Category,
  ContributionEntry,
  ContributionUnit,
  ExpenseEntry,
  ExpenseSplitMode,
  Member,
  PersistentTask,
  isLinkedMember,
} from '../../src/domain/entities';
import {
  buildCategoryDraft,
  renameCategory,
  setCategoryDefaultTaskRatio,
} from '../../src/domain/services/categoryService';
import {
  TaskSplitChoice,
  buildExpenseDraft,
  buildTaskDraft,
  expenseSharesFromRaw,
  parseAmountToMinor,
  parsePositiveNumber,
  taskWeightsFromRaw,
} from '../../src/domain/services/addEntryService';

// ── Types ──────────────────────────────────────────────────────

type EntryMode = 'task' | 'expense';

interface TaskFormData {
  label: string;
  value: string;
  performedByMemberId: string;
  beneficiaryMemberIds: string[];
  categoryId: string | null;
  occurredAt: Date;
  persistentTaskId: string | null;
  note: string;
  attachments: Attachment[];
}

interface ExpenseFormData {
  title: string;
  amountRaw: string;
  currency: string;
  paidByMemberId: string;
  participantMemberIds: string[];
  splitMode: ExpenseSplitMode;
  customShares: Record<string, string>;
  categoryId: string | null;
  occurredAt: Date;
  note: string;
  attachments: Attachment[];
}

interface CategoryDraftForm {
  name: string;
  ratioEnabled: boolean;
  weights: Record<string, string>;
}

const DEFAULT_CURRENCY = 'CHF';

// ── Helpers ────────────────────────────────────────────────────

function todayLocal(): Date {
  return new Date();
}

function formatAmountMinor(amountMinor: number, currency: string): string {
  const whole = Math.floor(amountMinor / 100);
  const cents = amountMinor % 100;
  return `${currency} ${whole}.${cents.toString().padStart(2, '0')}`;
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

/** Render integer minor units back into a plain decimal string for the form. */
function amountMinorToRaw(amountMinor: number): string {
  const whole = Math.floor(amountMinor / 100);
  const cents = amountMinor % 100;
  return `${whole}.${cents.toString().padStart(2, '0')}`;
}

/**
 * Build the update payload for an edited task.
 *
 * The explicit `undefined` entries are deliberate: the repository merges the
 * partial over the existing row, and SQLite writes `NULL` for undefined, so an
 * edit can genuinely *remove* a note, a photo, a category or a custom split.
 * Spreading the draft alone would keep stale values when a field is omitted.
 */
function taskUpdatePayload(
  draft: Omit<ContributionEntry, 'id'>,
  modifiedBy: string,
): Partial<ContributionEntry> {
  return {
    label: draft.label,
    performedByMemberId: draft.performedByMemberId,
    beneficiaryMemberIds: draft.beneficiaryMemberIds,
    value: draft.value,
    unit: draft.unit,
    persistentTaskId: draft.persistentTaskId,
    occurredAt: draft.occurredAt,
    categoryId: draft.categoryId,
    categoryLabelSnapshot: draft.categoryLabelSnapshot,
    note: draft.note,
    attachments: draft.attachments,
    splitMode: draft.splitMode,
    splitWeights: draft.splitWeights,
    splitSource: draft.splitSource,
    modifiedBy,
  };
}

/** Same "edit can clear a field" contract as {@link taskUpdatePayload}. */
function expenseUpdatePayload(
  draft: Omit<ExpenseEntry, 'id'>,
  modifiedBy: string,
): Partial<ExpenseEntry> {
  return {
    title: draft.title,
    amountMinor: draft.amountMinor,
    currency: draft.currency,
    paidByMemberId: draft.paidByMemberId,
    participantMemberIds: draft.participantMemberIds,
    splitMode: draft.splitMode,
    customShares: draft.customShares,
    category: draft.category,
    categoryId: draft.categoryId,
    categoryLabelSnapshot: draft.categoryLabelSnapshot,
    note: draft.note,
    attachments: draft.attachments,
    occurredAt: draft.occurredAt,
    modifiedBy,
  };
}

interface CategoryOption {
  id: string | null;
  name: string;
}

// ── Component ──────────────────────────────────────────────────

export default function AddScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { currentHouseholdId, repos, currentUser, emitDataChange, addMember, services } = useApp();

  // Edit mode: Balances pushes `/edit-entry` with an entry id + kind, which
  // renders this same screen so the create and edit forms stay in lockstep.
  const params = useLocalSearchParams<{ entryId?: string; entryType?: string }>();
  const editEntryId = typeof params.entryId === 'string' && params.entryId ? params.entryId : null;
  const editEntryType: EntryMode | null =
    params.entryType === 'task' || params.entryType === 'expense' ? params.entryType : null;
  const isEditing = !!editEntryId && !!editEntryType;
  const editLoadedRef = useRef(false);

  const [mode, setMode] = useState<EntryMode>('task');
  const [members, setMembers] = useState<Member[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [householdUnit, setHouseholdUnit] = useState<ContributionUnit>('minutes');
  const [persistentTasks, setPersistentTasks] = useState<PersistentTask[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Task split choice + raw weights
  const [taskSplitChoice, setTaskSplitChoice] = useState<TaskSplitChoice>('equal');
  const [taskWeightsRaw, setTaskWeightsRaw] = useState<Record<string, string>>({});
  // When editing a stored task, keep the entry's own unit so history is never
  // reinterpreted if the group later switched minutes <-> points.
  const [taskEditUnit, setTaskEditUnit] = useState<ContributionUnit | null>(null);

  // Category manager
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraftForm>({
    name: '',
    ratioEnabled: false,
    weights: {},
  });
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [ratioCategoryId, setRatioCategoryId] = useState<string | null>(null);
  const [categoryRatioWeights, setCategoryRatioWeights] = useState<Record<string, string>>({});

  // Members
  const [newMemberName, setNewMemberName] = useState('');
  const [isAddingMember, setIsAddingMember] = useState(false);

  // Last created entry (offered for native share)
  const [lastCreated, setLastCreated] = useState<{ kind: EntryMode; message: string } | null>(null);

  const attachmentSeqRef = useRef(0);
  const initialLoadDoneRef = useRef(false);

  // Task form
  const [taskForm, setTaskForm] = useState<TaskFormData>({
    label: '',
    value: '',
    performedByMemberId: '',
    beneficiaryMemberIds: [],
    categoryId: null,
    occurredAt: todayLocal(),
    persistentTaskId: null,
    note: '',
    attachments: [],
  });

  // Expense form
  const [expenseForm, setExpenseForm] = useState<ExpenseFormData>({
    title: '',
    amountRaw: '',
    currency: DEFAULT_CURRENCY,
    paidByMemberId: '',
    participantMemberIds: [],
    splitMode: 'equal',
    customShares: {},
    categoryId: null,
    occurredAt: todayLocal(),
    note: '',
    attachments: [],
  });

  // ── Load members + household settings + categories ─────────

  const loadCategories = useCallback(async () => {
    if (!currentHouseholdId) return;
    setCategories(await repos.categories.getByHousehold(currentHouseholdId));
  }, [currentHouseholdId, repos]);

  const loadHousehold = useCallback(async () => {
    if (!currentHouseholdId) return;
    const householdMembers = await repos.members.getByHousehold(currentHouseholdId);
    setMembers(householdMembers);

    const household = await repos.households.getById(currentHouseholdId);
    if (household) setHouseholdUnit(household.contributionUnit);

    setPersistentTasks(await repos.tasks.getByHousehold(currentHouseholdId));
    await loadCategories();

    if (householdMembers.length > 0) {
      setTaskForm((prev) => ({
        ...prev,
        performedByMemberId: prev.performedByMemberId || householdMembers[0].id,
        beneficiaryMemberIds:
          prev.beneficiaryMemberIds.length > 0
            ? prev.beneficiaryMemberIds
            : householdMembers.map((m) => m.id),
      }));
      setExpenseForm((prev) => ({
        ...prev,
        paidByMemberId: prev.paidByMemberId || householdMembers[0].id,
        participantMemberIds:
          prev.participantMemberIds.length > 0
            ? prev.participantMemberIds
            : householdMembers.map((m) => m.id),
      }));
    }
  }, [currentHouseholdId, repos, loadCategories]);

  useEffect(() => {
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;
    loadHousehold().catch(() => {
      // Keep the form usable; a later focus/retry can reload.
    });
  }, [loadHousehold]);

  // ── Pre-fill the form when editing an existing entry ───────
  useEffect(() => {
    if (!isEditing || !editEntryId || !editEntryType || !currentHouseholdId) return;
    if (editLoadedRef.current) return;
    editLoadedRef.current = true;
    setMode(editEntryType);

    (async () => {
      try {
        if (editEntryType === 'task') {
          const entry = await repos.contributions.getById(editEntryId);
          if (!entry || entry.householdId !== currentHouseholdId) {
            Alert.alert(t('state.error'), t('balances.entryMissing'));
            router.back();
            return;
          }
          setTaskEditUnit(entry.unit);
          setTaskForm({
            label: entry.label,
            value: String(entry.value),
            performedByMemberId: entry.performedByMemberId,
            beneficiaryMemberIds: [...entry.beneficiaryMemberIds],
            categoryId: entry.categoryId ?? null,
            occurredAt: new Date(entry.occurredAt),
            persistentTaskId: entry.persistentTaskId,
            note: entry.note ?? '',
            attachments: entry.attachments ?? [],
          });
          if (entry.splitMode === 'custom' && entry.splitWeights) {
            const raw: Record<string, string> = {};
            for (const weight of entry.splitWeights) raw[weight.memberId] = String(weight.weight);
            setTaskWeightsRaw(raw);
            setTaskSplitChoice('custom');
          } else if (entry.splitSource === 'category-default') {
            setTaskSplitChoice('category');
          } else {
            setTaskSplitChoice('equal');
          }
        } else {
          const entry = await repos.expenses.getById(editEntryId);
          if (!entry || entry.householdId !== currentHouseholdId) {
            Alert.alert(t('state.error'), t('balances.entryMissing'));
            router.back();
            return;
          }
          const customShares: Record<string, string> = {};
          for (const share of entry.customShares ?? []) {
            customShares[share.memberId] = amountMinorToRaw(share.amountMinor);
          }
          setExpenseForm({
            title: entry.title,
            amountRaw: amountMinorToRaw(entry.amountMinor),
            currency: entry.currency,
            paidByMemberId: entry.paidByMemberId,
            participantMemberIds: [...entry.participantMemberIds],
            splitMode: entry.splitMode,
            customShares,
            categoryId: entry.categoryId ?? null,
            occurredAt: new Date(entry.occurredAt),
            note: entry.note ?? '',
            attachments: entry.attachments ?? [],
          });
        }
      } catch {
        Alert.alert(t('state.error'), t('balances.entryMissing'));
        router.back();
      }
    })();
  }, [
    isEditing,
    editEntryId,
    editEntryType,
    currentHouseholdId,
    repos,
    router,
    t,
  ]);

  // ── Derived values ─────────────────────────────────────────

  const memberName = useCallback(
    (memberId: string) => members.find((m) => m.id === memberId)?.name || t('state.unknownMember'),
    [members, t]
  );

  const selectedTaskCategory = useMemo(
    () => categories.find((c) => c.id === taskForm.categoryId) ?? null,
    [categories, taskForm.categoryId]
  );

  const taskCategoryHasRatio = !!(
    selectedTaskCategory?.defaultTaskRatio && selectedTaskCategory.defaultTaskRatio.length > 0
  );

  const effectiveSplitChoice: TaskSplitChoice =
    taskSplitChoice === 'custom'
      ? 'custom'
      : taskCategoryHasRatio && taskSplitChoice === 'category'
      ? 'category'
      : 'equal';

  const taskWeightRaw = useMemo(() => {
    const raw: Record<string, string> = { ...taskWeightsRaw };
    for (const id of taskForm.beneficiaryMemberIds) {
      if (raw[id] === undefined) raw[id] = '1';
    }
    return raw;
  }, [taskWeightsRaw, taskForm.beneficiaryMemberIds]);

  const customTaskWeights = useMemo(
    () => taskWeightsFromRaw(taskForm.beneficiaryMemberIds, taskWeightRaw),
    [taskForm.beneficiaryMemberIds, taskWeightRaw]
  );

  const parsedAmountMinor = useMemo(
    () => parseAmountToMinor(expenseForm.amountRaw),
    [expenseForm.amountRaw]
  );

  const expenseCustomShares = useMemo(
    () => expenseSharesFromRaw(expenseForm.participantMemberIds, expenseForm.customShares),
    [expenseForm.participantMemberIds, expenseForm.customShares]
  );

  const expenseCustomTotal = useMemo(
    () => (expenseCustomShares ?? []).reduce((sum, share) => sum + share.amountMinor, 0),
    [expenseCustomShares]
  );

  const expenseCustomValid =
    expenseForm.splitMode !== 'custom' ||
    (expenseCustomShares !== null &&
      parsedAmountMinor !== null &&
      expenseCustomTotal === parsedAmountMinor);

  const categoryOptions: CategoryOption[] = useMemo(
    () => [{ id: null, name: t('add.categoryNone') }, ...categories.map((c) => ({ id: c.id, name: c.name }))],
    [categories, t]
  );

  // ── Members ────────────────────────────────────────────────

  const handleAddMember = async () => {
    const name = newMemberName.trim();
    if (!name || !currentHouseholdId || isAddingMember) return;
    setIsAddingMember(true);
    try {
      await addMember(currentHouseholdId, name);
      setNewMemberName('');
      await loadHousehold();
    } catch {
      Alert.alert(t('state.error'), t('add.memberAddError'));
    } finally {
      setIsAddingMember(false);
    }
  };

  // ── Photos ─────────────────────────────────────────────────

  const attachmentsAvailable = services.attachments.isAvailable();

  const addPhoto = async (apply: (attachment: Attachment) => void) => {
    if (!currentHouseholdId) return;
    try {
      const source = await services.attachments.pickPhoto();
      if (!source) return;
      const handle = await services.attachments.save(source, currentHouseholdId);
      attachmentSeqRef.current += 1;
      apply({
        id: `att-${Date.now()}-${attachmentSeqRef.current}`,
        kind: 'photo',
        ref: handle.ref,
        mimeType: handle.mimeType,
        byteSize: handle.byteSize,
        width: handle.width,
        height: handle.height,
        createdAt: new Date().toISOString(),
      });
    } catch {
      Alert.alert(t('state.error'), t('add.photoError'));
    }
  };

  const removePhoto = (
    attachments: Attachment[],
    id: string,
  ): Attachment[] => attachments.filter((attachment) => attachment.id !== id);

  // ── Category management ────────────────────────────────────

  const resetCategoryDraft = () =>
    setCategoryDraft({ name: '', ratioEnabled: false, weights: {} });

  const handleCreateCategory = async () => {
    if (!currentHouseholdId) return;
    try {
      const allMemberIds = members.map((m) => m.id);
      const weights = categoryDraft.ratioEnabled
        ? taskWeightsFromRaw(allMemberIds, categoryDraft.weights)
        : null;
      if (categoryDraft.ratioEnabled && !weights) {
        Alert.alert(t('state.error'), t('add.categoryError'));
        return;
      }
      const draft = buildCategoryDraft({
        householdId: currentHouseholdId,
        name: categoryDraft.name,
        defaultTaskRatio: weights,
      });
      await repos.categories.create({
        householdId: draft.householdId,
        name: draft.name,
        defaultTaskRatio: draft.defaultTaskRatio,
      });
      resetCategoryDraft();
      await loadCategories();
    } catch {
      Alert.alert(t('state.error'), t('add.categoryError'));
    }
  };

  const startRenameCategory = (category: Category) => {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
  };

  const handleRenameCategory = async (category: Category) => {
    try {
      await repos.categories.update(category.id, renameCategory(editingCategoryName));
      setEditingCategoryId(null);
      await loadCategories();
    } catch {
      Alert.alert(t('state.error'), t('add.categoryError'));
    }
  };

  const handleDeleteCategory = (category: Category) => {
    Alert.alert(
      t('add.categoryDelete'),
      t('add.categoryDeleteConfirm', { name: category.name }),
      [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t('add.categoryDelete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await repos.categories.delete(category.id);
              setTaskForm((prev) =>
                prev.categoryId === category.id ? { ...prev, categoryId: null } : prev,
              );
              setExpenseForm((prev) =>
                prev.categoryId === category.id ? { ...prev, categoryId: null } : prev,
              );
              await loadCategories();
            } catch {
              Alert.alert(t('state.error'), t('add.categoryError'));
            }
          },
        },
      ],
    );
  };

  const toggleRatioEditor = (category: Category) => {
    if (ratioCategoryId === category.id) {
      setRatioCategoryId(null);
      return;
    }
    const raw: Record<string, string> = {};
    for (const weight of category.defaultTaskRatio ?? []) {
      raw[weight.memberId] = String(weight.weight);
    }
    for (const member of members) {
      if (raw[member.id] === undefined) raw[member.id] = '1';
    }
    setCategoryRatioWeights(raw);
    setRatioCategoryId(category.id);
  };

  const handleSaveCategoryRatio = async (category: Category) => {
    try {
      const weights = taskWeightsFromRaw(
        members.map((m) => m.id),
        categoryRatioWeights,
      );
      if (!weights) {
        Alert.alert(t('state.error'), t('add.categoryError'));
        return;
      }
      await repos.categories.update(category.id, setCategoryDefaultTaskRatio(weights));
      setRatioCategoryId(null);
      await loadCategories();
      Alert.alert(t('add.categoryRatio'), t('add.categoryRatioSaved'));
    } catch {
      Alert.alert(t('state.error'), t('add.categoryError'));
    }
  };

  const handleClearCategoryRatio = async (category: Category) => {
    try {
      await repos.categories.update(category.id, { defaultTaskRatio: null });
      setRatioCategoryId(null);
      await loadCategories();
    } catch {
      Alert.alert(t('state.error'), t('add.categoryError'));
    }
  };

  // ── Task submit ────────────────────────────────────────────

  const resetTaskForm = () => {
    setTaskForm((prev) => ({
      label: '',
      value: '',
      performedByMemberId: prev.performedByMemberId,
      beneficiaryMemberIds: prev.beneficiaryMemberIds,
      categoryId: null,
      occurredAt: todayLocal(),
      persistentTaskId: null,
      note: '',
      attachments: [],
    }));
    setTaskSplitChoice('equal');
    setTaskWeightsRaw({});
  };

  const submitTask = async () => {
    if (!currentHouseholdId || isSubmitting) return;
    const value = parsePositiveNumber(taskForm.value);
    if (value === null) {
      Alert.alert(t('state.error'), t('add.errorValue'));
      return;
    }
    if (effectiveSplitChoice === 'custom' && customTaskWeights === null) {
      Alert.alert(t('state.error'), t('add.taskSplitMissingWeight'));
      return;
    }

    setIsSubmitting(true);
    try {
      const built = buildTaskDraft({
        householdId: currentHouseholdId,
        label: taskForm.label,
        value,
        unit: isEditing ? taskEditUnit ?? householdUnit : householdUnit,
        performedByMemberId: taskForm.performedByMemberId,
        beneficiaryMemberIds:
          taskForm.beneficiaryMemberIds.length > 0
            ? taskForm.beneficiaryMemberIds
            : members.map((m) => m.id),
        occurredAt: taskForm.occurredAt.toISOString(),
        createdBy: currentUser?.userId || '',
        persistentTaskId: taskForm.persistentTaskId,
        category: selectedTaskCategory,
        splitChoice: effectiveSplitChoice,
        customWeights: effectiveSplitChoice === 'custom' ? customTaskWeights : null,
        note: taskForm.note,
        attachments: taskForm.attachments,
      });
      if (!built.ok) {
        Alert.alert(t('state.error'), built.error === 'value-invalid' ? t('add.errorValue') : t('add.errorTask'));
        return;
      }

      if (isEditing && editEntryId) {
        await repos.contributions.update(
          editEntryId,
          taskUpdatePayload(built.draft, currentUser?.userId || ''),
        );
        emitDataChange('contribution', currentHouseholdId);
        router.back();
        return;
      }

      const created = await repos.contributions.create(built.draft);
      emitDataChange('contribution', currentHouseholdId);
      setLastCreated({
        kind: 'task',
        message: t('share.taskLine', {
          label: created.label,
          value: created.value,
          unit: created.unit === 'minutes' ? t('unit.minutesShort') : t('unit.pointsShort'),
          member: memberName(created.performedByMemberId),
          date: formatDateShort(created.occurredAt),
        }),
      });
      resetTaskForm();
    } catch {
      Alert.alert(t('state.error'), isEditing ? t('add.errorEdit') : t('add.errorTask'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Expense submit ─────────────────────────────────────────

  const resetExpenseForm = () => {
    setExpenseForm((prev) => ({
      title: '',
      amountRaw: '',
      currency: prev.currency,
      paidByMemberId: prev.paidByMemberId,
      participantMemberIds: prev.participantMemberIds,
      splitMode: 'equal',
      customShares: {},
      categoryId: null,
      occurredAt: todayLocal(),
      note: '',
      attachments: [],
    }));
  };

  const submitExpense = async () => {
    if (!currentHouseholdId || isSubmitting) return;
    if (parsedAmountMinor === null) {
      Alert.alert(t('state.error'), t('add.errorAmount'));
      return;
    }
    if (expenseForm.splitMode === 'custom' && !expenseCustomValid) {
      Alert.alert(t('state.error'), t('add.errorSplit'));
      return;
    }

    setIsSubmitting(true);
    try {
      const built = buildExpenseDraft({
        householdId: currentHouseholdId,
        title: expenseForm.title,
        amountMinor: parsedAmountMinor,
        currency: expenseForm.currency,
        paidByMemberId: expenseForm.paidByMemberId,
        participantMemberIds:
          expenseForm.participantMemberIds.length > 0
            ? expenseForm.participantMemberIds
            : members.map((m) => m.id),
        splitMode: expenseForm.splitMode,
        customShares: expenseForm.splitMode === 'custom' ? expenseCustomShares : null,
        occurredAt: expenseForm.occurredAt.toISOString(),
        createdBy: currentUser?.userId || '',
        category: categories.find((c) => c.id === expenseForm.categoryId) ?? null,
        note: expenseForm.note,
        attachments: expenseForm.attachments,
      });
      if (!built.ok) {
        Alert.alert(t('state.error'), built.error === 'amount-invalid' ? t('add.errorAmount') : t('add.errorExpense'));
        return;
      }

      if (isEditing && editEntryId) {
        await repos.expenses.update(
          editEntryId,
          expenseUpdatePayload(built.draft, currentUser?.userId || ''),
        );
        emitDataChange('expense', currentHouseholdId);
        router.back();
        return;
      }

      const created = await repos.expenses.create(built.draft);
      emitDataChange('expense', currentHouseholdId);
      setLastCreated({
        kind: 'expense',
        message: t('share.expenseLine', {
          title: created.title,
          amount: formatAmountMinor(created.amountMinor, created.currency),
          member: memberName(created.paidByMemberId),
          date: formatDateShort(created.occurredAt),
        }),
      });
      resetExpenseForm();
    } catch {
      Alert.alert(t('state.error'), isEditing ? t('add.errorEdit') : t('add.errorExpense'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Interactions ───────────────────────────────────────────

  const toggleBeneficiary = (memberId: string) => {
    setTaskForm((prev) => {
      const ids = prev.beneficiaryMemberIds.includes(memberId)
        ? prev.beneficiaryMemberIds.filter((id) => id !== memberId)
        : [...prev.beneficiaryMemberIds, memberId];
      return { ...prev, beneficiaryMemberIds: ids };
    });
  };

  const toggleParticipant = (memberId: string) => {
    setExpenseForm((prev) => {
      const ids = prev.participantMemberIds.includes(memberId)
        ? prev.participantMemberIds.filter((id) => id !== memberId)
        : [...prev.participantMemberIds, memberId];
      return { ...prev, participantMemberIds: ids };
    });
  };

  const selectTaskCategory = (categoryId: string | null) => {
    setTaskForm((prev) => ({ ...prev, categoryId }));
    const category = categoryId ? categories.find((c) => c.id === categoryId) : null;
    const hasRatio = !!(category?.defaultTaskRatio && category.defaultTaskRatio.length > 0);
    setTaskSplitChoice((prev) => {
      if (prev === 'custom') return prev;
      return hasRatio ? 'category' : 'equal';
    });
  };

  const pickDateTime = (current: Date, onPick: (date: Date) => void) => {
    Alert.alert(t('add.dateTime'), formatDateTimeShort(current), [
      { text: t('add.dateNow'), onPress: () => onPick(new Date()) },
      { text: t('add.dateHourAgo'), onPress: () => onPick(new Date(Date.now() - 3600000)) },
      {
        text: t('add.dateYesterday'),
        onPress: () => {
          const d = new Date();
          d.setDate(d.getDate() - 1);
          onPick(d);
        },
      },
      { text: t('action.cancel'), style: 'cancel' },
    ]);
  };

  // A stored task keeps its own unit: editing it must never relabel minutes as
  // points (or the reverse) just because the group later changed its unit.
  const activeTaskUnit = isEditing ? taskEditUnit ?? householdUnit : householdUnit;
  const unitLabel = activeTaskUnit === 'minutes' ? t('unit.minutesShort') : t('unit.pointsShort');

  // ── Render helpers ─────────────────────────────────────────

  const renderCategoryChips = (
    selectedId: string | null,
    onSelect: (id: string | null) => void,
  ) => (
    <View style={styles.chipRow}>
      {categoryOptions.map((option) => {
        const selected = selectedId === option.id;
        return (
          <TouchableOpacity
            key={option.id ?? 'none'}
            style={[styles.memberChip, selected && styles.memberChipActive]}
            onPress={() => onSelect(option.id)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Text variant="caption" color={selected ? colors.textOnPrimary : colors.textSecondary}>
              {option.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderPhotoField = (
    attachments: Attachment[],
    onChange: (next: Attachment[]) => void,
  ) => (
    <View style={styles.inputGroup}>
      <Text variant="caption">{t('add.photoOptional')}</Text>
      {attachments.map((attachment) => (
        <View key={attachment.id} style={styles.shareRow}>
          <Text variant="body" style={styles.shareName}>
            {t('add.photoAttached')}
          </Text>
          <TouchableOpacity
            onPress={() => onChange(removePhoto(attachments, attachment.id))}
            style={styles.actionButton}
          >
            <Text variant="caption" color={colors.balanceNegative}>
              {t('add.photoRemove')}
            </Text>
          </TouchableOpacity>
        </View>
      ))}
      {attachmentsAvailable ? (
        <Button
          title={t('add.photoAdd')}
          variant="secondary"
          size="small"
          onPress={() => addPhoto((attachment) => onChange([...attachments, attachment]))}
          style={styles.photoButton}
        />
      ) : (
        <Text variant="caption" color={colors.textMuted} style={styles.hint}>
          {t('add.photoUnavailable')}
        </Text>
      )}
    </View>
  );

  const renderCategoryManager = () => (
    <View style={styles.managerSection}>
      <Text variant="caption">{t('add.categoryCreate')}</Text>
      <TextInput
        style={styles.input}
        value={categoryDraft.name}
        onChangeText={(value) => setCategoryDraft((prev) => ({ ...prev, name: value }))}
        placeholder={t('add.categoryNamePlaceholder')}
        placeholderTextColor={colors.textMuted}
      />
      <TouchableOpacity
        style={styles.managerRow}
        onPress={() =>
          setCategoryDraft((prev) => ({ ...prev, ratioEnabled: !prev.ratioEnabled }))
        }
        accessibilityRole="button"
        accessibilityState={{ selected: categoryDraft.ratioEnabled }}
      >
        <Text variant="caption">
          {categoryDraft.ratioEnabled ? '✓ ' : ''}
          {t('add.categoryRatioEnabled')}
        </Text>
      </TouchableOpacity>
      {categoryDraft.ratioEnabled &&
        members.map((member) => (
          <View key={member.id} style={styles.shareRow}>
            <Text variant="caption" style={styles.shareName}>
              {t('add.categoryWeightFor', { name: member.name })}
            </Text>
            <TextInput
              style={[styles.input, styles.shareInput]}
              value={categoryDraft.weights[member.id] ?? '1'}
              onChangeText={(value) =>
                setCategoryDraft((prev) => ({
                  ...prev,
                  weights: { ...prev.weights, [member.id]: value },
                }))
              }
              keyboardType="numeric"
              placeholder="1"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        ))}
      <Button
        title={t('add.categoryCreateAction')}
        variant="secondary"
        size="small"
        onPress={handleCreateCategory}
        disabled={!categoryDraft.name.trim()}
        style={styles.managerAction}
      />

      {categories.length === 0 ? (
        <Text variant="caption" color={colors.textMuted} style={styles.hint}>
          {t('add.categoryRatioHint')}
        </Text>
      ) : (
        categories.map((category) => (
          <View key={category.id} style={styles.categoryRow}>
            <View style={styles.categoryInfo}>
              {editingCategoryId === category.id ? (
                <TextInput
                  style={styles.input}
                  value={editingCategoryName}
                  onChangeText={setEditingCategoryName}
                  placeholder={t('add.categoryNamePlaceholder')}
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                />
              ) : (
                <Text variant="body">{category.name}</Text>
              )}
              <Text variant="caption" color={colors.textSecondary}>
                {category.defaultTaskRatio && category.defaultTaskRatio.length > 0
                  ? t('add.categoryRatio')
                  : t('add.categoryRatioEqual')}
              </Text>
            </View>
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() =>
                  editingCategoryId === category.id
                    ? handleRenameCategory(category)
                    : startRenameCategory(category)
                }
              >
                <Text variant="caption" color={colors.textSecondary}>
                  {editingCategoryId === category.id ? t('action.save') : t('add.categoryRename')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => toggleRatioEditor(category)}
              >
                <Text variant="caption" color={colors.textSecondary}>
                  {t('add.categoryRatio')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => handleDeleteCategory(category)}
              >
                <Text variant="caption" color={colors.balanceNegative}>
                  {t('add.categoryDelete')}
                </Text>
              </TouchableOpacity>
            </View>

            {ratioCategoryId === category.id && (
              <View style={styles.ratioEditor}>
                <Text variant="caption" color={colors.textSecondary} style={styles.hint}>
                  {t('add.categoryRatioHint')}
                </Text>
                {members.map((member) => (
                  <View key={member.id} style={styles.shareRow}>
                    <Text variant="caption" style={styles.shareName}>
                      {t('add.categoryWeightFor', { name: member.name })}
                    </Text>
                    <TextInput
                      style={[styles.input, styles.shareInput]}
                      value={categoryRatioWeights[member.id] ?? '1'}
                      onChangeText={(value) =>
                        setCategoryRatioWeights((prev) => ({ ...prev, [member.id]: value }))
                      }
                      keyboardType="numeric"
                      placeholder="1"
                      placeholderTextColor={colors.textMuted}
                    />
                  </View>
                ))}
                <View style={styles.actionsRow}>
                  <Button
                    title={t('action.save')}
                    variant="secondary"
                    size="small"
                    onPress={() => handleSaveCategoryRatio(category)}
                  />
                  <Button
                    title={t('add.categoryRatioEqual')}
                    variant="ghost"
                    size="small"
                    onPress={() => handleClearCategoryRatio(category)}
                  />
                </View>
              </View>
            )}
          </View>
        ))
      )}
    </View>
  );

  // ── Render ─────────────────────────────────────────────────

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text variant="screenTitle">
          {isEditing ? t('add.editBanner') : t('add.title')}
        </Text>
      </View>

      {/* Mode switch (hidden while editing: the entry kind is fixed) */}
      {!isEditing && (
        <View style={styles.modeSwitch}>
          <TouchableOpacity
            style={[styles.modeButton, mode === 'task' && styles.modeButtonActive]}
            onPress={() => setMode('task')}
          >
            <Text
              variant="tabLabel"
              color={mode === 'task' ? colors.textOnPrimary : colors.textSecondary}
            >
              {t('add.modeTask')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeButton, mode === 'expense' && styles.modeButtonActive]}
            onPress={() => setMode('expense')}
          >
            <Text
              variant="tabLabel"
              color={mode === 'expense' ? colors.textOnPrimary : colors.textSecondary}
            >
              {t('add.modeExpense')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Task form ────────────────────────────── */}
      {mode === 'task' && (
        <Card style={styles.formCard}>
          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.label')}</Text>
            <TextInput
              style={styles.input}
              value={taskForm.label}
              onChangeText={(value) => setTaskForm((prev) => ({ ...prev, label: value }))}
              placeholder={t('add.labelPlaceholder')}
              placeholderTextColor={colors.textMuted}
            />
          </View>

          {persistentTasks.length > 0 && (
            <View style={styles.inputGroup}>
              <Text variant="caption">{t('add.shortcuts')}</Text>
              <View style={styles.chipRow}>
                {persistentTasks.map((pt) => {
                  const selected = taskForm.persistentTaskId === pt.id;
                  return (
                    <TouchableOpacity
                      key={pt.id}
                      style={[styles.memberChip, selected && styles.memberChipActive]}
                      onPress={() => {
                        if (selected) {
                          setTaskForm((prev) => ({ ...prev, persistentTaskId: null }));
                        } else {
                          setTaskForm((prev) => ({
                            ...prev,
                            persistentTaskId: pt.id,
                            label: pt.name,
                            value: pt.defaultValue.toString(),
                            beneficiaryMemberIds:
                              pt.defaultBeneficiaryMemberIds &&
                              pt.defaultBeneficiaryMemberIds.length > 0
                                ? pt.defaultBeneficiaryMemberIds
                                : prev.beneficiaryMemberIds,
                          }));
                        }
                      }}
                    >
                      <Text
                        variant="caption"
                        color={selected ? colors.textOnPrimary : colors.textSecondary}
                      >
                        {pt.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.value', { unit: unitLabel })}</Text>
            <TextInput
              style={styles.input}
              value={taskForm.value}
              onChangeText={(value) => setTaskForm((prev) => ({ ...prev, value }))}
              placeholder={activeTaskUnit === 'minutes' ? '15' : '3'}
              placeholderTextColor={colors.textMuted}
              keyboardType="numeric"
            />
          </View>

          {/* Category */}
          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.category')}</Text>
            {renderCategoryChips(taskForm.categoryId, selectTaskCategory)}
          </View>

          {/* Split */}
          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.split')}</Text>
            <View style={styles.splitRow}>
              <TouchableOpacity
                style={[styles.splitButton, effectiveSplitChoice === 'equal' && styles.splitButtonActive]}
                onPress={() => setTaskSplitChoice('equal')}
              >
                <Text
                  variant="caption"
                  color={effectiveSplitChoice === 'equal' ? colors.textOnPrimary : colors.textSecondary}
                >
                  {t('add.splitEqual')}
                </Text>
              </TouchableOpacity>
              {taskCategoryHasRatio && (
                <TouchableOpacity
                  style={[
                    styles.splitButton,
                    effectiveSplitChoice === 'category' && styles.splitButtonActive,
                  ]}
                  onPress={() => setTaskSplitChoice('category')}
                >
                  <Text
                    variant="caption"
                    color={
                      effectiveSplitChoice === 'category'
                        ? colors.textOnPrimary
                        : colors.textSecondary
                    }
                  >
                    {t('add.splitCategory')}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.splitButton, effectiveSplitChoice === 'custom' && styles.splitButtonActive]}
                onPress={() => setTaskSplitChoice('custom')}
              >
                <Text
                  variant="caption"
                  color={effectiveSplitChoice === 'custom' ? colors.textOnPrimary : colors.textSecondary}
                >
                  {t('add.splitCustom')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Custom weights */}
          {effectiveSplitChoice === 'custom' && (
            <View style={styles.inputGroup}>
              <Text variant="caption">{t('add.weights')}</Text>
              {taskForm.beneficiaryMemberIds.length === 0 ? (
                <Text variant="caption" color={colors.balanceNegative} style={styles.hint}>
                  {t('add.taskSplitMissingWeight')}
                </Text>
              ) : (
                taskForm.beneficiaryMemberIds.map((memberId) => (
                  <View key={memberId} style={styles.shareRow}>
                    <Text variant="body" style={styles.shareName}>
                      {memberName(memberId)}
                    </Text>
                    <TextInput
                      style={[styles.input, styles.shareInput]}
                      value={taskWeightRaw[memberId] ?? '1'}
                      onChangeText={(value) =>
                        setTaskWeightsRaw((prev) => ({ ...prev, [memberId]: value }))
                      }
                      keyboardType="numeric"
                      placeholder="1"
                      placeholderTextColor={colors.textMuted}
                    />
                  </View>
                ))
              )}
              {taskForm.beneficiaryMemberIds.length > 0 && customTaskWeights === null && (
                <Text variant="caption" color={colors.balanceNegative} style={styles.hint}>
                  {t('add.taskSplitMissingWeight')}
                </Text>
              )}
            </View>
          )}

          {/* Performed by */}
          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.performedBy')}</Text>
            <View style={styles.chipRow}>
              {members.map((m) => {
                const selected = taskForm.performedByMemberId === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.memberChip, selected && styles.memberChipActive]}
                    onPress={() => setTaskForm((prev) => ({ ...prev, performedByMemberId: m.id }))}
                  >
                    <Text variant="caption" color={selected ? colors.textOnPrimary : colors.textSecondary}>
                      {m.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Beneficiaries */}
          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.beneficiaries')}</Text>
            <View style={styles.chipRow}>
              {members.map((m) => {
                const selected = taskForm.beneficiaryMemberIds.includes(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.memberChip, selected && styles.memberChipActive]}
                    onPress={() => toggleBeneficiary(m.id)}
                  >
                    <Text variant="caption" color={selected ? colors.textOnPrimary : colors.textSecondary}>
                      {m.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Note */}
          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.noteOptional')}</Text>
            <TextInput
              style={styles.input}
              value={taskForm.note}
              onChangeText={(value) => setTaskForm((prev) => ({ ...prev, note: value }))}
              placeholder={t('add.notePlaceholder')}
              placeholderTextColor={colors.textMuted}
              multiline
            />
          </View>

          {renderPhotoField(taskForm.attachments, (next) =>
            setTaskForm((prev) => ({ ...prev, attachments: next })),
          )}

          {/* Date / Time */}
          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.dateTime')}</Text>
            <TouchableOpacity
              style={styles.dateTimeButton}
              onPress={() =>
                pickDateTime(taskForm.occurredAt, (date) =>
                  setTaskForm((prev) => ({ ...prev, occurredAt: date })),
                )
              }
            >
              <Text variant="body">{formatDateTimeShort(taskForm.occurredAt)}</Text>
            </TouchableOpacity>
          </View>

          <Button
            title={isEditing ? t('add.update') : t('add.addTask')}
            variant="primary"
            onPress={submitTask}
            disabled={
              !taskForm.label.trim() ||
              !taskForm.value ||
              isSubmitting ||
              (effectiveSplitChoice === 'custom' && customTaskWeights === null)
            }
            loading={isSubmitting}
            style={styles.submitButton}
          />

          <TouchableOpacity
            style={styles.manageToggle}
            onPress={() => setCategoriesOpen((prev) => !prev)}
            accessibilityRole="button"
            accessibilityState={{ expanded: categoriesOpen }}
          >
            <Text variant="caption" color={colors.textSecondary}>
              {t('add.categoryManage')}
            </Text>
          </TouchableOpacity>

          {categoriesOpen && renderCategoryManager()}
        </Card>
      )}

      {/* ── Expense form ─────────────────────────────────── */}
      {mode === 'expense' && (
        <Card style={styles.formCard}>
          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.titleLabel')}</Text>
            <TextInput
              style={styles.input}
              value={expenseForm.title}
              onChangeText={(value) => setExpenseForm((prev) => ({ ...prev, title: value }))}
              placeholder={t('add.titlePlaceholder')}
              placeholderTextColor={colors.textMuted}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.amount')}</Text>
            <View style={styles.amountRow}>
              <TextInput
                style={[styles.input, styles.amountInput]}
                value={expenseForm.amountRaw}
                onChangeText={(value) => setExpenseForm((prev) => ({ ...prev, amountRaw: value }))}
                placeholder="42.50"
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
              />
              <TextInput
                style={[styles.input, styles.currencyInput]}
                value={expenseForm.currency}
                onChangeText={(value) =>
                  setExpenseForm((prev) => ({ ...prev, currency: value.toUpperCase().slice(0, 3) }))
                }
                placeholder="CHF"
                placeholderTextColor={colors.textMuted}
                maxLength={3}
                autoCapitalize="characters"
              />
            </View>
          </View>

          {/* Category */}
          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.category')}</Text>
            {renderCategoryChips(expenseForm.categoryId, (id) =>
              setExpenseForm((prev) => ({ ...prev, categoryId: id })),
            )}
          </View>

          {/* Paid by */}
          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.paidBy')}</Text>
            <View style={styles.chipRow}>
              {members.map((m) => {
                const selected = expenseForm.paidByMemberId === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.memberChip, selected && styles.memberChipActive]}
                    onPress={() => setExpenseForm((prev) => ({ ...prev, paidByMemberId: m.id }))}
                  >
                    <Text variant="caption" color={selected ? colors.textOnPrimary : colors.textSecondary}>
                      {m.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Participants */}
          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.participants')}</Text>
            <View style={styles.chipRow}>
              {members.map((m) => {
                const selected = expenseForm.participantMemberIds.includes(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.memberChip, selected && styles.memberChipActive]}
                    onPress={() => toggleParticipant(m.id)}
                  >
                    <Text variant="caption" color={selected ? colors.textOnPrimary : colors.textSecondary}>
                      {m.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Split mode */}
          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.split')}</Text>
            <View style={styles.splitRow}>
              <TouchableOpacity
                style={[styles.splitButton, expenseForm.splitMode === 'equal' && styles.splitButtonActive]}
                onPress={() => setExpenseForm((prev) => ({ ...prev, splitMode: 'equal' }))}
              >
                <Text
                  variant="caption"
                  color={expenseForm.splitMode === 'equal' ? colors.textOnPrimary : colors.textSecondary}
                >
                  {t('add.splitEqual')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.splitButton, expenseForm.splitMode === 'custom' && styles.splitButtonActive]}
                onPress={() => setExpenseForm((prev) => ({ ...prev, splitMode: 'custom' }))}
              >
                <Text
                  variant="caption"
                  color={expenseForm.splitMode === 'custom' ? colors.textOnPrimary : colors.textSecondary}
                >
                  {t('add.splitCustom')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Custom shares */}
          {expenseForm.splitMode === 'custom' && (
            <View style={styles.inputGroup}>
              <Text variant="caption">{t('add.customShares')}</Text>
              {expenseForm.participantMemberIds.map((memberId) => (
                <View key={memberId} style={styles.shareRow}>
                  <Text variant="body" style={styles.shareName}>
                    {memberName(memberId)}
                  </Text>
                  <TextInput
                    style={[styles.input, styles.shareInput]}
                    value={expenseForm.customShares[memberId] || ''}
                    onChangeText={(value) =>
                      setExpenseForm((prev) => ({
                        ...prev,
                        customShares: { ...prev.customShares, [memberId]: value },
                      }))
                    }
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
              ))}
              {!expenseCustomValid && parsedAmountMinor !== null && (
                <Text variant="caption" color={colors.balanceNegative} style={styles.hint}>
                  {t('add.customSplitMismatch', {
                    shares: (expenseCustomTotal / 100).toFixed(2),
                    amount: (parsedAmountMinor / 100).toFixed(2),
                  })}
                </Text>
              )}
            </View>
          )}

          {/* Note */}
          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.noteOptional')}</Text>
            <TextInput
              style={styles.input}
              value={expenseForm.note}
              onChangeText={(value) => setExpenseForm((prev) => ({ ...prev, note: value }))}
              placeholder={t('add.notePlaceholder')}
              placeholderTextColor={colors.textMuted}
              multiline
            />
          </View>

          {renderPhotoField(expenseForm.attachments, (next) =>
            setExpenseForm((prev) => ({ ...prev, attachments: next })),
          )}

          {/* Date / Time */}
          <View style={styles.inputGroup}>
            <Text variant="caption">{t('add.dateTime')}</Text>
            <TouchableOpacity
              style={styles.dateTimeButton}
              onPress={() =>
                pickDateTime(expenseForm.occurredAt, (date) =>
                  setExpenseForm((prev) => ({ ...prev, occurredAt: date })),
                )
              }
            >
              <Text variant="body">{formatDateTimeShort(expenseForm.occurredAt)}</Text>
            </TouchableOpacity>
          </View>

          <Button
            title={isEditing ? t('add.update') : t('add.addExpense')}
            variant="primary"
            onPress={submitExpense}
            disabled={
              !expenseForm.title.trim() ||
              !expenseForm.amountRaw ||
              isSubmitting ||
              (expenseForm.splitMode === 'custom' && !expenseCustomValid)
            }
            loading={isSubmitting}
            style={styles.submitButton}
          />

          <TouchableOpacity
            style={styles.manageToggle}
            onPress={() => setCategoriesOpen((prev) => !prev)}
            accessibilityRole="button"
            accessibilityState={{ expanded: categoriesOpen }}
          >
            <Text variant="caption" color={colors.textSecondary}>
              {t('add.categoryManage')}
            </Text>
          </TouchableOpacity>

          {categoriesOpen && renderCategoryManager()}
        </Card>
      )}

      {/* ── Last created entry: share through the native sheet ── */}
      {lastCreated && (
        <Card style={styles.lastCreatedCard}>
          <Text variant="body">
            {lastCreated.kind === 'task' ? t('add.addedTask') : t('add.addedExpense')}
          </Text>
          <View style={styles.actionsRow}>
            <Button
              title={t('add.shareLast')}
              variant="secondary"
              size="small"
              onPress={() => services.share.share({ message: lastCreated.message })}
            />
            <Button
              title={t('action.close')}
              variant="ghost"
              size="small"
              onPress={() => setLastCreated(null)}
            />
          </View>
        </Card>
      )}

      {/* ── Members (hidden while editing a single entry) ────── */}
      {!isEditing && (
      <Card style={styles.membersCard}>
        <Text variant="sectionTitle" style={styles.membersTitle}>
          {t('add.members')}
        </Text>
        <Text variant="caption" color={colors.textSecondary} style={styles.hint}>
          {t('add.membersHint')}
        </Text>

        {members.map((member) => (
          <View key={member.id} style={styles.memberLine}>
            <Text variant="body" style={styles.shareName}>
              {member.name}
            </Text>
            <Text variant="caption" color={colors.textSecondary}>
              {isLinkedMember(member) ? t('add.linkedMember') : t('add.namedMember')}
            </Text>
          </View>
        ))}

        <View style={styles.memberAddRow}>
          <TextInput
            style={[styles.input, styles.memberAddInput]}
            value={newMemberName}
            onChangeText={setNewMemberName}
            placeholder={t('add.addMemberPlaceholder')}
            placeholderTextColor={colors.textMuted}
          />
          <Button
            title={t('action.add')}
            variant="secondary"
            size="small"
            onPress={handleAddMember}
            disabled={!newMemberName.trim() || isAddingMember}
            loading={isAddingMember}
          />
        </View>

        <Button
          title={t('add.inviteLink')}
          variant="ghost"
          size="small"
          onPress={() => router.push('/invite')}
          style={styles.inviteButton}
        />
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
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
    paddingHorizontal: spacing.xs,
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
  manageToggle: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
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
  hint: {
    marginTop: spacing.xs,
  },
  photoButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
  },
  managerSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  managerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  managerAction: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
  },
  categoryRow: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  categoryInfo: {
    marginBottom: spacing.xs,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  ratioEditor: {
    marginTop: spacing.sm,
  },
  lastCreatedCard: {
    marginBottom: spacing.lg,
  },
  membersCard: {
    marginBottom: spacing.lg,
  },
  membersTitle: {
    marginBottom: spacing.xs,
  },
  memberLine: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  memberAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  memberAddInput: {
    flex: 1,
    marginTop: 0,
  },
  inviteButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
  },
});
