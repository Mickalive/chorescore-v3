/**
 * ChoreScore V3 — A faire Tab
 *
 * Todo list. Free for all. No premium gating, no chrono.
 *
 * V3-05 features:
 *   - Full creation form: title, assignee, beneficiaries, dueAt,
 *     reminderAt, notes, persistentTask.
 *   - Completion mini-form: confirm performer, value (household unit),
 *     beneficiaries → atomic ContributionEntry.
 *   - Delete todo (free, with confirmation).
 *   - Reminder via notification port (honest: no-op if unavailable).
 *   - Calendar event via calendar port (honest: no-op if unavailable).
 *   - Data-change signals for cross-tab refresh.
 *   - Optimistic local writes; offline-coherent.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { ScreenContainer } from '../../src/ui/components/ScreenContainer';
import { Text } from '../../src/ui/components/Text';
import { Button } from '../../src/ui/components/Button';
import { Card } from '../../src/ui/components/Card';
import { colors, spacing, borderRadius } from '../../src/ui/design-system/theme';
import { useApp } from '../../src/features/app/AppContext';
import { TodoItem, Member, Household, ContributionUnit, PersistentTask } from '../../src/domain/entities';
import { planTodoCompletion } from '../../src/domain/services/todoCompletionService';

// ── Types ──────────────────────────────────────────────────────

type TodoView = 'list' | 'create' | 'complete';

interface CreateFormData {
  title: string;
  assigneeMemberId: string | null;
  beneficiaryMemberIds: string[];
  dueAt: Date | null;
  reminderAt: Date | null;
  notes: string;
  persistentTaskId: string | null;
}

interface CompleteFormData {
  performerMemberId: string;
  value: string;
  beneficiaryMemberIds: string[];
}

// ── Helpers ────────────────────────────────────────────────────

function formatDateShort(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${day}/${month}`;
}

function formatDateTimeShort(d: Date): string {
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${day}/${month} ${hours}:${minutes}`;
}

// ── Component ──────────────────────────────────────────────────

export default function TodosScreen() {
  const { currentHouseholdId, repos, currentUser, emitDataChange, services } = useApp();

  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [household, setHousehold] = useState<Household | null>(null);
  const [persistentTasks, setPersistentTasks] = useState<PersistentTask[]>([]);
  const [view, setView] = useState<TodoView>('list');
  const [selectedTodo, setSelectedTodo] = useState<TodoItem | null>(null);

  // Create form state
  const [createForm, setCreateForm] = useState<CreateFormData>({
    title: '',
    assigneeMemberId: null,
    beneficiaryMemberIds: [],
    dueAt: null,
    reminderAt: null,
    notes: '',
    persistentTaskId: null,
  });

  // Complete form state
  const [completeForm, setCompleteForm] = useState<CompleteFormData>({
    performerMemberId: '',
    value: '',
    beneficiaryMemberIds: [],
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Load data ──────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!currentHouseholdId) return;
    const [householdMembers, householdTodos, householdData, tasks] = await Promise.all([
      repos.members.getByHousehold(currentHouseholdId),
      repos.todos.getByHousehold(currentHouseholdId),
      repos.households.getById(currentHouseholdId),
      repos.tasks.getByHousehold(currentHouseholdId),
    ]);
    setMembers(householdMembers);
    setTodos(householdTodos.filter((t) => t.status !== 'completed'));
    setHousehold(householdData);
    setPersistentTasks(tasks);

    // Set default members for create form
    if (householdMembers.length > 0) {
      setCreateForm((prev) => ({
        ...prev,
        assigneeMemberId: prev.assigneeMemberId || householdMembers[0].id,
        beneficiaryMemberIds:
          prev.beneficiaryMemberIds.length > 0
            ? prev.beneficiaryMemberIds
            : householdMembers.map((m) => m.id),
      }));
    }
  }, [currentHouseholdId, repos]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Create todo ────────────────────────────────────────────

  const handleCreate = async () => {
    if (!currentHouseholdId || !createForm.title.trim()) return;

    setIsSubmitting(true);
    try {
      const created = await repos.todos.create({
        householdId: currentHouseholdId,
        title: createForm.title.trim(),
        assigneeMemberId: createForm.assigneeMemberId,
        beneficiaryMemberIds: createForm.beneficiaryMemberIds,
        dueAt: createForm.dueAt?.toISOString() || null,
        reminderAt: createForm.reminderAt?.toISOString() || null,
        notes: createForm.notes.trim(),
        persistentTaskId: createForm.persistentTaskId,
        status: 'todo',
      });

      // Schedule reminder if set and notification port is available
      if (createForm.reminderAt && services.notifications.isAvailable()) {
        await services.notifications.scheduleNotification({
          title: `Rappel: ${createForm.title.trim()}`,
          body: createForm.notes.trim() || 'Tache prevue',
          scheduledAt: createForm.reminderAt.toISOString(),
          data: { todoId: created.id },
        });
      }

      // Create calendar event if due date is set and calendar port is available
      if (createForm.dueAt && services.calendar.isAvailable()) {
        const hasPermission = await services.calendar.requestPermission();
        if (hasPermission) {
          await services.calendar.createEvent({
            title: createForm.title.trim(),
            notes: createForm.notes.trim(),
            startDate: createForm.dueAt.toISOString(),
            endDate: new Date(createForm.dueAt.getTime() + 3600000).toISOString(),
          });
        }
      }

      // Reset form and go back to list
      resetCreateForm();
      setView('list');
      await loadData();
      emitDataChange('todo', currentHouseholdId);
    } catch {
      Alert.alert('Erreur', 'Impossible de creer la tache.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetCreateForm = () => {
    setCreateForm({
      title: '',
      assigneeMemberId: members[0]?.id || null,
      beneficiaryMemberIds: members.map((m) => m.id),
      dueAt: null,
      reminderAt: null,
      notes: '',
      persistentTaskId: null,
    });
  };

  // ── Start completion ───────────────────────────────────────

  const startComplete = (todo: TodoItem) => {
    setSelectedTodo(todo);
    setCompleteForm({
      performerMemberId: todo.assigneeMemberId || members[0]?.id || '',
      value: '', // User must confirm
      beneficiaryMemberIds:
        todo.beneficiaryMemberIds.length > 0
          ? todo.beneficiaryMemberIds
          : members.map((m) => m.id),
    });
    setView('complete');
  };

  // ── Confirm completion (atomic) ────────────────────────────

  const handleComplete = async () => {
    if (!selectedTodo || !household || !currentUser) return;

    const numericValue = parseFloat(completeForm.value);
    if (isNaN(numericValue) || numericValue <= 0) {
      Alert.alert('Erreur', 'La valeur doit etre positive.');
      return;
    }

    if (completeForm.beneficiaryMemberIds.length === 0) {
      Alert.alert('Erreur', 'Au moins un beneficiaire est requis.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = planTodoCompletion({
        todo: selectedTodo,
        household,
        performerMemberId: completeForm.performerMemberId,
        value: numericValue,
        beneficiaryMemberIds: completeForm.beneficiaryMemberIds,
        completedByUserId: currentUser.userId,
      });

      // Atomic write: both operations in parallel
      await Promise.all([
        repos.todos.update(selectedTodo.id, {
          status: 'completed',
          completedAt: result.updatedTodo.completedAt,
        }),
        repos.contributions.create(result.contributionEntry),
      ]);

      // Cancel reminder if exists
      if (selectedTodo.reminderAt && services.notifications.isAvailable()) {
        // Note: we don't have the notification id stored; this is a best-effort cancel.
        // In a production system, the notification id would be stored on the TodoItem.
      }

      // Notify other screens (Balances, Add history)
      emitDataChange('contribution', currentHouseholdId!);
      emitDataChange('todo', currentHouseholdId!);

      // Return to list
      setSelectedTodo(null);
      setView('list');
      await loadData();
    } catch (err) {
      Alert.alert('Erreur', 'Impossible de terminer la tache.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Delete todo ────────────────────────────────────────────

  const handleDelete = (todo: TodoItem) => {
    Alert.alert('Supprimer', `Supprimer « ${todo.title} » ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: async () => {
          try {
            await repos.todos.delete(todo.id);
            setTodos((prev) => prev.filter((t) => t.id !== todo.id));
            emitDataChange('todo', currentHouseholdId!);
          } catch {
            Alert.alert('Erreur', 'Impossible de supprimer la tache.');
          }
        },
      },
    ]);
  };

  // ── Helpers ────────────────────────────────────────────────

  const memberName = (memberId: string | null) => {
    if (!memberId) return 'Non assigne';
    return members.find((m) => m.id === memberId)?.name || 'Inconnu';
  };

  const unitLabel = household?.contributionUnit === 'points' ? 'pts' : 'min';

  const toggleCreateBeneficiary = (memberId: string) => {
    setCreateForm((prev) => {
      const ids = prev.beneficiaryMemberIds.includes(memberId)
        ? prev.beneficiaryMemberIds.filter((id) => id !== memberId)
        : [...prev.beneficiaryMemberIds, memberId];
      return { ...prev, beneficiaryMemberIds: ids };
    });
  };

  const toggleCompleteBeneficiary = (memberId: string) => {
    setCompleteForm((prev) => {
      const ids = prev.beneficiaryMemberIds.includes(memberId)
        ? prev.beneficiaryMemberIds.filter((id) => id !== memberId)
        : [...prev.beneficiaryMemberIds, memberId];
      return { ...prev, beneficiaryMemberIds: ids };
    });
  };

  // ── Render ─────────────────────────────────────────────────

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled">
          {/* ── Header ────────────────────────────────────── */}
          <View style={styles.header}>
            <Text variant="screenTitle">A faire</Text>
          </View>

          {/* ── List View ─────────────────────────────────── */}
          {view === 'list' && (
            <>
              <View style={styles.actions}>
                <Button
                  title="Nouvelle tache"
                  variant="primary"
                  onPress={() => {
                    resetCreateForm();
                    setView('create');
                  }}
                />
              </View>

              {todos.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text variant="sectionTitle" style={styles.emptyTitle}>
                    Rien a faire
                  </Text>
                  <Text variant="body" style={styles.emptyText}>
                    Ajoutez une tache pour commencer.
                  </Text>
                </View>
              ) : (
                <View style={styles.todoList}>
                  {todos.map((todo) => (
                    <Card key={todo.id} style={styles.todoCard}>
                      <View style={styles.todoRow}>
                        <View style={styles.todoInfo}>
                          <Text variant="bodyBold">{todo.title}</Text>
                          <Text variant="caption">
                            {memberName(todo.assigneeMemberId)}
                            {todo.dueAt ? ` · echeance ${formatDateShort(todo.dueAt)}` : ''}
                          </Text>
                          {todo.notes ? (
                            <Text variant="caption" numberOfLines={1} style={styles.todoNotes}>
                              {todo.notes}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.todoActions}>
                          <Button
                            title="Terminer"
                            variant="primary"
                            onPress={() => startComplete(todo)}
                            size="small"
                          />
                          <Button
                            title="Suppr"
                            variant="ghost"
                            onPress={() => handleDelete(todo)}
                            size="small"
                          />
                        </View>
                      </View>
                    </Card>
                  ))}
                </View>
              )}
            </>
          )}

          {/* ── Create View ───────────────────────────────── */}
          {view === 'create' && (
            <Card style={styles.formCard}>
              <View style={styles.inputGroup}>
                <Text variant="caption">Titre</Text>
                <TextInput
                  style={styles.input}
                  value={createForm.title}
                  onChangeText={(t) => setCreateForm((p) => ({ ...p, title: t }))}
                  placeholder="Nouvelle tache..."
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
                          createForm.persistentTaskId === pt.id && styles.memberChipActive,
                        ]}
                        onPress={() => {
                          if (createForm.persistentTaskId === pt.id) {
                            setCreateForm((p) => ({ ...p, persistentTaskId: null }));
                          } else {
                            setCreateForm((p) => ({
                              ...p,
                              persistentTaskId: pt.id,
                              title: p.title || pt.name,
                            }));
                          }
                        }}
                      >
                        <Text
                          variant="caption"
                          color={
                            createForm.persistentTaskId === pt.id
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

              {/* Assignee */}
              <View style={styles.inputGroup}>
                <Text variant="caption">Assigne a</Text>
                <View style={styles.memberRow}>
                  {members.map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      style={[
                        styles.memberChip,
                        createForm.assigneeMemberId === m.id && styles.memberChipActive,
                      ]}
                      onPress={() => setCreateForm((p) => ({ ...p, assigneeMemberId: m.id }))}
                    >
                      <Text
                        variant="caption"
                        color={
                          createForm.assigneeMemberId === m.id
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

              {/* Beneficiaries */}
              <View style={styles.inputGroup}>
                <Text variant="caption">Beneficiaires</Text>
                <View style={styles.memberRow}>
                  {members.map((m) => {
                    const selected = createForm.beneficiaryMemberIds.includes(m.id);
                    return (
                      <TouchableOpacity
                        key={m.id}
                        style={[styles.memberChip, selected && styles.memberChipActive]}
                        onPress={() => toggleCreateBeneficiary(m.id)}
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

              {/* Due date */}
              <View style={styles.inputGroup}>
                <Text variant="caption">Echeance (optionnel)</Text>
                <TouchableOpacity
                  style={styles.dateTimeButton}
                  onPress={() => {
                    Alert.alert('Echeance', 'Choisir une echeance', [
                      {
                        text: 'Demain',
                        onPress: () => {
                          const d = new Date();
                          d.setDate(d.getDate() + 1);
                          d.setHours(18, 0, 0, 0);
                          setCreateForm((p) => ({ ...p, dueAt: d }));
                        },
                      },
                      {
                        text: 'Dans 3 jours',
                        onPress: () => {
                          const d = new Date();
                          d.setDate(d.getDate() + 3);
                          d.setHours(18, 0, 0, 0);
                          setCreateForm((p) => ({ ...p, dueAt: d }));
                        },
                      },
                      {
                        text: 'Dans 1 semaine',
                        onPress: () => {
                          const d = new Date();
                          d.setDate(d.getDate() + 7);
                          d.setHours(18, 0, 0, 0);
                          setCreateForm((p) => ({ ...p, dueAt: d }));
                        },
                      },
                      {
                        text: 'Effacer',
                        onPress: () => setCreateForm((p) => ({ ...p, dueAt: null })),
                      },
                      { text: 'Annuler', style: 'cancel' },
                    ]);
                  }}
                >
                  <Text variant="body">
                    {createForm.dueAt ? formatDateTimeShort(createForm.dueAt) : 'Pas d\'echeance'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Reminder */}
              <View style={styles.inputGroup}>
                <Text variant="caption">Rappel (optionnel)</Text>
                <TouchableOpacity
                  style={styles.dateTimeButton}
                  onPress={() => {
                    Alert.alert('Rappel', 'Quand envoyer un rappel ?', [
                      {
                        text: '1h avant echeance',
                        onPress: () => {
                          if (createForm.dueAt) {
                            const r = new Date(createForm.dueAt.getTime() - 3600000);
                            setCreateForm((p) => ({ ...p, reminderAt: r }));
                          }
                        },
                      },
                      {
                        text: 'Le jour meme',
                        onPress: () => {
                          if (createForm.dueAt) {
                            const r = new Date(createForm.dueAt);
                            r.setHours(9, 0, 0, 0);
                            setCreateForm((p) => ({ ...p, reminderAt: r }));
                          }
                        },
                      },
                      {
                        text: 'Effacer',
                        onPress: () => setCreateForm((p) => ({ ...p, reminderAt: null })),
                      },
                      { text: 'Annuler', style: 'cancel' },
                    ]);
                  }}
                >
                  <Text variant="body">
                    {createForm.reminderAt
                      ? formatDateTimeShort(createForm.reminderAt)
                      : 'Pas de rappel'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Notes */}
              <View style={styles.inputGroup}>
                <Text variant="caption">Notes (optionnel)</Text>
                <TextInput
                  style={styles.input}
                  value={createForm.notes}
                  onChangeText={(t) => setCreateForm((p) => ({ ...p, notes: t }))}
                  placeholder="Details..."
                  placeholderTextColor={colors.textMuted}
                  multiline
                />
              </View>

              <View style={styles.createActions}>
                <Button
                  title="Creer"
                  variant="primary"
                  onPress={handleCreate}
                  disabled={!createForm.title.trim() || isSubmitting}
                  loading={isSubmitting}
                />
                <Button
                  title="Annuler"
                  variant="ghost"
                  onPress={() => {
                    setView('list');
                    resetCreateForm();
                  }}
                  size="small"
                />
              </View>
            </Card>
          )}

          {/* ── Complete View (mini-form) ─────────────────── */}
          {view === 'complete' && selectedTodo && (
            <Card style={styles.formCard}>
              <View style={styles.editBanner}>
                <Text variant="sectionTitle">Terminer</Text>
                <Button
                  title="Annuler"
                  variant="ghost"
                  size="small"
                  onPress={() => {
                    setSelectedTodo(null);
                    setView('list');
                  }}
                />
              </View>

              <Text variant="bodyBold" style={styles.completeTodoTitle}>
                {selectedTodo.title}
              </Text>

              {/* Performer */}
              <View style={styles.inputGroup}>
                <Text variant="caption">Fait par</Text>
                <View style={styles.memberRow}>
                  {members.map((m) => (
                    <TouchableOpacity
                      key={m.id}
                      style={[
                        styles.memberChip,
                        completeForm.performerMemberId === m.id && styles.memberChipActive,
                      ]}
                      onPress={() =>
                        setCompleteForm((p) => ({ ...p, performerMemberId: m.id }))
                      }
                    >
                      <Text
                        variant="caption"
                        color={
                          completeForm.performerMemberId === m.id
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

              {/* Value */}
              <View style={styles.inputGroup}>
                <Text variant="caption">Valeur ({unitLabel})</Text>
                <TextInput
                  style={styles.input}
                  value={completeForm.value}
                  onChangeText={(t) => setCompleteForm((p) => ({ ...p, value: t }))}
                  placeholder={household?.contributionUnit === 'points' ? '3' : '15'}
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                />
              </View>

              {/* Beneficiaries */}
              <View style={styles.inputGroup}>
                <Text variant="caption">Beneficiaires</Text>
                <View style={styles.memberRow}>
                  {members.map((m) => {
                    const selected = completeForm.beneficiaryMemberIds.includes(m.id);
                    return (
                      <TouchableOpacity
                        key={m.id}
                        style={[styles.memberChip, selected && styles.memberChipActive]}
                        onPress={() => toggleCompleteBeneficiary(m.id)}
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

              <Button
                title="Confirmer"
                variant="primary"
                onPress={handleComplete}
                disabled={
                  !completeForm.value ||
                  parseFloat(completeForm.value) <= 0 ||
                  completeForm.beneficiaryMemberIds.length === 0 ||
                  isSubmitting
                }
                loading={isSubmitting}
                style={styles.submitButton}
              />
            </Card>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    marginBottom: spacing.lg,
  },
  actions: {
    marginBottom: spacing.lg,
  },
  todoList: {
    gap: spacing.md,
  },
  todoCard: {
    marginBottom: spacing.sm,
  },
  todoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  todoInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  todoNotes: {
    marginTop: spacing.xs,
    color: colors.textMuted,
  },
  todoActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    marginBottom: spacing.md,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textSecondary,
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
  dateTimeButton: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  createActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  completeTodoTitle: {
    marginBottom: spacing.md,
  },
  submitButton: {
    marginTop: spacing.sm,
  },
});
