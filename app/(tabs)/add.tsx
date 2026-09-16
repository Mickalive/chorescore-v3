/**
 * ChoreScore V3 — Add Tab
 *
 * Switch Contribution | Depense.
 * Contribution: libre, sans chrono, fait par/pour, valeur.
 * Depense: titre, montant, paye par/pour, split.
 * Historique compact en dessous.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { ScreenContainer } from '../../src/ui/components/ScreenContainer';
import { Text } from '../../src/ui/components/Text';
import { Button } from '../../src/ui/components/Button';
import { Card } from '../../src/ui/components/Card';
import { colors, spacing, borderRadius } from '../../src/ui/design-system/theme';
import { useApp } from '../../src/features/app/AppContext';
import { ContributionEntry, Member } from '../../src/domain/entities';

type EntryMode = 'contribution' | 'expense';

export default function AddScreen() {
  const { currentHouseholdId, repos } = useApp();
  const [mode, setMode] = useState<EntryMode>('contribution');
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [entries, setEntries] = useState<ContributionEntry[]>([]);

  const loadData = useCallback(async () => {
    if (!currentHouseholdId) return;
    const householdMembers = await repos.members.getByHousehold(currentHouseholdId);
    setMembers(householdMembers);
    const householdEntries = await repos.contributions.getByHousehold(currentHouseholdId);
    setEntries(householdEntries.slice(0, 20));
  }, [currentHouseholdId, repos]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSubmit = async () => {
    if (!currentHouseholdId || !label.trim() || !value) return;

    if (mode === 'contribution') {
      const numericValue = parseFloat(value);
      if (isNaN(numericValue) || numericValue <= 0) return;

      await repos.contributions.create({
        householdId: currentHouseholdId,
        label: label.trim(),
        performedByMemberId: members[0]?.id || '',
        beneficiaryMemberIds: members.map((m) => m.id),
        value: numericValue,
        unit: 'minutes',
        persistentTaskId: null,
        occurredAt: new Date().toISOString(),
        createdBy: members[0]?.userId || '',
      });
    }

    setLabel('');
    setValue('');
    loadData();
  };

  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text variant="screenTitle">Ajouter</Text>
      </View>

      {/* Mode switch */}
      <View style={styles.modeSwitch}>
        <TouchableOpacity
          style={[styles.modeButton, mode === 'contribution' && styles.modeButtonActive]}
          onPress={() => setMode('contribution')}
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
          onPress={() => setMode('expense')}
        >
          <Text
            variant="tabLabel"
            color={mode === 'expense' ? colors.textOnPrimary : colors.textSecondary}
          >
            Depense
          </Text>
        </TouchableOpacity>
      </View>

      {/* Form */}
      <Card style={styles.formCard}>
        <View style={styles.inputGroup}>
          <Text variant="caption">Libelle</Text>
          <TextInput
            style={styles.input}
            value={label}
            onChangeText={setLabel}
            placeholder="Ex: Vaisselle, Courses..."
            placeholderTextColor={colors.textMuted}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text variant="caption">
            {mode === 'contribution' ? 'Valeur (min)' : 'Montant (CHF)'}
          </Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={setValue}
            placeholder={mode === 'contribution' ? '15' : '42.50'}
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
          />
        </View>

        <Button
          title={mode === 'contribution' ? 'Ajouter contribution' : 'Ajouter depense'}
          variant="primary"
          onPress={handleSubmit}
          disabled={!label.trim() || !value}
          style={styles.submitButton}
        />
      </Card>

      {/* History */}
      <View style={styles.historySection}>
        <Text variant="sectionTitle" style={styles.historyTitle}>
          Activite recente
        </Text>
        {entries.length === 0 ? (
          <Text variant="body" style={styles.emptyText}>
            Aucune contribution pour l'instant.
          </Text>
        ) : (
          entries.map((entry) => (
            <View key={entry.id} style={styles.historyRow}>
              <Text variant="body" style={styles.historyLabel}>
                {entry.label}
              </Text>
              <Text variant="caption">
                {entry.value} {entry.unit === 'minutes' ? 'min' : 'pts'}
              </Text>
            </View>
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
  submitButton: {
    marginTop: spacing.sm,
  },
  historySection: {
    marginTop: spacing.md,
  },
  historyTitle: {
    marginBottom: spacing.md,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  historyLabel: {
    flex: 1,
    marginRight: spacing.md,
  },
  emptyText: {
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
});
