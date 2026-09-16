/**
 * ChoreScore V3 — A faire Tab
 *
 * Todo list. Free for all. No premium gating.
 * V3: No chrono. Completion creates a ContributionEntry atomically.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, TextInput } from 'react-native';
import { ScreenContainer } from '../../src/ui/components/ScreenContainer';
import { Text } from '../../src/ui/components/Text';
import { Button } from '../../src/ui/components/Button';
import { Card } from '../../src/ui/components/Card';
import { colors, spacing, borderRadius } from '../../src/ui/design-system/theme';
import { useApp } from '../../src/features/app/AppContext';
import { TodoItem, Member } from '../../src/domain/entities';

export default function TodosScreen() {
  const { currentHouseholdId, repos } = useApp();
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const loadTodos = useCallback(async () => {
    if (!currentHouseholdId) return;
    const householdMembers = await repos.members.getByHousehold(currentHouseholdId);
    setMembers(householdMembers);
    const householdTodos = await repos.todos.getByHousehold(currentHouseholdId);
    setTodos(householdTodos.filter((t) => t.status !== 'completed'));
  }, [currentHouseholdId, repos]);

  useEffect(() => {
    loadTodos();
  }, [loadTodos]);

  const handleCreate = async () => {
    if (!currentHouseholdId || !newTitle.trim()) return;
    await repos.todos.create({
      householdId: currentHouseholdId,
      title: newTitle.trim(),
      assigneeMemberId: null,
      beneficiaryMemberIds: members.map((m) => m.id),
      dueAt: null,
      reminderAt: null,
      notes: '',
      persistentTaskId: null,
      status: 'todo',
    });
    setNewTitle('');
    setShowCreate(false);
    loadTodos();
  };

  const handleComplete = async (todo: TodoItem) => {
    if (!currentHouseholdId) return;

    // Mark todo as completed
    await repos.todos.update(todo.id, {
      status: 'completed',
      completedAt: new Date().toISOString(),
    });

    // Create contribution entry atomically
    await repos.contributions.create({
      householdId: currentHouseholdId,
      label: todo.title,
      performedByMemberId: todo.assigneeMemberId || members[0]?.id || '',
      beneficiaryMemberIds: todo.beneficiaryMemberIds.length > 0 ? todo.beneficiaryMemberIds : members.map((m) => m.id),
      value: 15, // Default value; V3-05 will add confirmation dialog
      unit: 'minutes',
      persistentTaskId: todo.persistentTaskId,
      occurredAt: new Date().toISOString(),
      createdBy: todo.assigneeMemberId || members[0]?.userId || '',
    });

    loadTodos();
  };

  const getAssigneeName = (memberId: string | null) => {
    if (!memberId) return 'Non assigne';
    return members.find((m) => m.id === memberId)?.name || 'Inconnu';
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text variant="screenTitle">A faire</Text>
      </View>

      {/* Create form */}
      {showCreate ? (
        <Card style={styles.createForm}>
          <View style={styles.inputGroup}>
            <Text variant="caption">Titre</Text>
            <TextInput
              style={styles.input}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Nouvelle tache..."
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={styles.createActions}>
            <Button
              title="Ajouter"
              variant="primary"
              onPress={handleCreate}
              disabled={!newTitle.trim()}
            />
            <Button
              title="Annuler"
              variant="ghost"
              onPress={() => {
                setShowCreate(false);
                setNewTitle('');
              }}
              size="small"
            />
          </View>
        </Card>
      ) : (
        <View style={styles.actions}>
          <Button
            title="Nouvelle tache"
            variant="primary"
            onPress={() => setShowCreate(true)}
          />
        </View>
      )}

      {/* Todo list */}
      <View style={styles.todoList}>
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
          todos.map((todo) => (
            <Card key={todo.id} style={styles.todoCard}>
              <View style={styles.todoRow}>
                <View style={styles.todoInfo}>
                  <Text variant="bodyBold">{todo.title}</Text>
                  <Text variant="caption">
                    {getAssigneeName(todo.assigneeMemberId)}
                  </Text>
                </View>
                <Button
                  title="Terminer"
                  variant="secondary"
                  onPress={() => handleComplete(todo)}
                  size="small"
                />
              </View>
            </Card>
          ))
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.lg,
  },
  createForm: {
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
  createActions: {
    flexDirection: 'row',
    gap: spacing.md,
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
    alignItems: 'center',
  },
  todoInfo: {
    flex: 1,
    marginRight: spacing.md,
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
});
