/**
 * ChoreScore V3 — Group Options Screen
 *
 * Reachable from the group root (per constitution §3: "Options restent
 * hors de la navigation principale").
 *
 * Exposes:
 *   - Contribution unit toggle (Minutes|Points) with provenance warning
 *   - Compensation toggle + group-defined rate
 *   - Household name edit
 *
 * Free for all. No premium gating. No plan limits.
 * Historical entries keep their provenance/unit — no silent conversion.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '../src/ui/components/ScreenContainer';
import { Text } from '../src/ui/components/Text';
import { Button } from '../src/ui/components/Button';
import { Card } from '../src/ui/components/Card';
import { colors, spacing, borderRadius } from '../src/ui/design-system/theme';
import { useApp } from '../src/features/app/AppContext';
import { useI18n } from '../src/i18n';
import { Household, ContributionUnit } from '../src/domain/entities';
import { planUnitChange, validateUnitChange } from '../src/domain/services/unitChangeService';

export default function GroupOptionsScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { currentHouseholdId, repos, emitDataChange } = useApp();
  const [household, setHousehold] = useState<Household | null>(null);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<ContributionUnit>('minutes');
  const [compensationEnabled, setCompensationEnabled] = useState(false);
  const [rateContributionValue, setRateContributionValue] = useState('');
  const [rateMoneyAmount, setRateMoneyAmount] = useState('');
  const [rateCurrency, setRateCurrency] = useState('CHF');
  const [isSaving, setIsSaving] = useState(false);

  const loadHousehold = useCallback(async () => {
    if (!currentHouseholdId) return;
    const hh = await repos.households.getById(currentHouseholdId);
    if (hh) {
      setHousehold(hh);
      setName(hh.name);
      setUnit(hh.contributionUnit);
      setCompensationEnabled(hh.crossLedgerCompensationEnabled);
      if (hh.contributionToMoneyRate) {
        setRateContributionValue(hh.contributionToMoneyRate.contributionValue.toString());
        setRateMoneyAmount((hh.contributionToMoneyRate.moneyAmountMinor / 100).toFixed(2));
        setRateCurrency(hh.contributionToMoneyRate.currency);
      }
    }
  }, [currentHouseholdId, repos]);

  useEffect(() => {
    loadHousehold();
  }, [loadHousehold]);

  const handleSaveName = async () => {
    if (!currentHouseholdId || !name.trim() || !household) return;
    if (name.trim() === household.name) return;
    setIsSaving(true);
    try {
      await repos.households.update(currentHouseholdId, { name: name.trim() });
      setHousehold({ ...household, name: name.trim() });
      emitDataChange('household', currentHouseholdId);
    } catch {
      Alert.alert(t('state.error'), t('groupOptions.nameError'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleUnitChange = async (newUnit: ContributionUnit) => {
    if (!currentHouseholdId || !household) return;
    if (newUnit === unit) return;

    Alert.alert(
      t('groupOptions.unitChangeTitle'),
      t('groupOptions.unitChangeConfirm', {
        unit: newUnit === 'minutes' ? t('unit.minutes') : t('unit.points'),
      }),
      [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t('action.confirm'),
          onPress: async () => {
            setIsSaving(true);
            try {
              const result = planUnitChange(household, newUnit);
              await repos.households.update(currentHouseholdId, {
                contributionUnit: newUnit,
              });
              setUnit(newUnit);
              setHousehold(result.updatedHousehold);
              emitDataChange('household', currentHouseholdId);
            } catch {
              Alert.alert(t('state.error'), t('groupOptions.unitChangeError'));
            } finally {
              setIsSaving(false);
            }
          },
        },
      ],
    );
  };

  const handleSaveCompensation = async () => {
    if (!currentHouseholdId || !household) return;
    setIsSaving(true);
    try {
      const updates: Partial<Household> = {
        crossLedgerCompensationEnabled: compensationEnabled,
      };

      if (compensationEnabled) {
        const contribVal = parseFloat(rateContributionValue);
        const moneyMinor = Math.round(parseFloat(rateMoneyAmount) * 100);
        if (isNaN(contribVal) || contribVal <= 0 || isNaN(moneyMinor) || moneyMinor <= 0) {
          Alert.alert(t('state.error'), t('groupOptions.rateError'));
          setIsSaving(false);
          return;
        }
        updates.contributionToMoneyRate = {
          contributionValue: contribVal,
          contributionUnit: unit,
          moneyAmountMinor: moneyMinor,
          currency: rateCurrency.toUpperCase() || 'CHF',
        };
      } else {
        updates.contributionToMoneyRate = null;
      }

      await repos.households.update(currentHouseholdId, updates);
      setHousehold({ ...household, ...updates });
      emitDataChange('household', currentHouseholdId);
      Alert.alert(t('action.ok'), t('groupOptions.saved'));
    } catch {
      Alert.alert(t('state.error'), t('groupOptions.saveError'));
    } finally {
      setIsSaving(false);
    }
  };

  if (!household) {
    return (
      <ScreenContainer edges={['top', 'bottom']}>
        <View style={styles.loadingContainer}>
          <Text variant="body">{t('state.loading')}</Text>
        </View>
      </ScreenContainer>
    );
  }

  const unitLabel = unit === 'minutes' ? t('unit.minutesShort') : t('unit.pointsShort');

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text variant="caption" color={colors.textSecondary}>
              {'< '}
              {t('action.back')}
            </Text>
          </TouchableOpacity>
          <Text variant="screenTitle">{t('groupOptions.title')}</Text>
        </View>

        {/* Group Name */}
        <Text variant="sectionTitle" style={styles.sectionTitle}>
          {t('groupOptions.name')}
        </Text>
        <Card style={styles.card}>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={t('groupOptions.namePlaceholder')}
              placeholderTextColor={colors.textMuted}
            />
            <Button
              title={t('action.ok')}
              variant="primary"
              size="small"
              onPress={handleSaveName}
              disabled={!name.trim() || name.trim() === household.name || isSaving}
            />
          </View>
        </Card>

        {/* Task unit */}
        <Text variant="sectionTitle" style={styles.sectionTitle}>
          {t('groupOptions.unit')}
        </Text>
        <Card style={styles.card}>
          <View style={styles.unitToggle}>
            <TouchableOpacity
              style={[styles.unitButton, unit === 'minutes' && styles.unitButtonActive]}
              onPress={() => handleUnitChange('minutes')}
            >
              <Text
                variant="tabLabel"
                color={unit === 'minutes' ? colors.textOnPrimary : colors.textSecondary}
              >
                {t('unit.minutes')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.unitButton, unit === 'points' && styles.unitButtonActive]}
              onPress={() => handleUnitChange('points')}
            >
              <Text
                variant="tabLabel"
                color={unit === 'points' ? colors.textOnPrimary : colors.textSecondary}
              >
                {t('unit.points')}
              </Text>
            </TouchableOpacity>
          </View>
          <Text variant="caption" color={colors.textSecondary} style={styles.provenanceWarning}>
            {t('groupOptions.unitProvenance')}
          </Text>
        </Card>

        {/* Cross-Ledger Compensation */}
        <Text variant="sectionTitle" style={styles.sectionTitle}>
          {t('groupOptions.compensation')}
        </Text>
        <Card style={styles.card}>
          <View style={styles.toggleRow}>
            <Text variant="body" style={{ flex: 1 }}>
              {t('groupOptions.compensationToggle')}
            </Text>
            <TouchableOpacity
              style={[styles.toggle, compensationEnabled && styles.toggleActive]}
              onPress={() => setCompensationEnabled(!compensationEnabled)}
            >
              <View style={[styles.toggleKnob, compensationEnabled && styles.toggleKnobActive]} />
            </TouchableOpacity>
          </View>

          {compensationEnabled && (
            <View style={styles.rateSection}>
              <Text variant="caption" color={colors.textSecondary} style={{ marginBottom: spacing.sm }}>
                {t('groupOptions.rateDefined')}
              </Text>
              <View style={styles.rateRow}>
                <TextInput
                  style={[styles.input, styles.rateInput]}
                  value={rateContributionValue}
                  onChangeText={setRateContributionValue}
                  placeholder="10"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                />
                <Text variant="body" style={styles.rateLabel}>{unitLabel}</Text>
                <Text variant="body" style={styles.rateEquals}>=</Text>
                <TextInput
                  style={[styles.input, styles.rateInput]}
                  value={rateMoneyAmount}
                  onChangeText={setRateMoneyAmount}
                  placeholder="15.00"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                />
                <TextInput
                  style={[styles.input, styles.currencyInput]}
                  value={rateCurrency}
                  onChangeText={(value) => setRateCurrency(value.toUpperCase().slice(0, 3))}
                  placeholder="CHF"
                  placeholderTextColor={colors.textMuted}
                  maxLength={3}
                  autoCapitalize="characters"
                />
              </View>
            </View>
          )}

          <Button
            title={t('action.save')}
            variant="primary"
            size="small"
            onPress={handleSaveCompensation}
            disabled={isSaving}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  sectionTitle: {
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  card: {
    marginBottom: spacing.md,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.sm,
    padding: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  unitToggle: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.md,
    padding: 2,
    marginBottom: spacing.sm,
  },
  unitButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
  },
  unitButtonActive: {
    backgroundColor: colors.primary,
  },
  provenanceWarning: {
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    padding: 2,
  },
  toggleActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  toggleKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.textMuted,
  },
  toggleKnobActive: {
    backgroundColor: colors.textOnPrimary,
    alignSelf: 'flex-end',
  },
  rateSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rateInput: {
    width: 70,
    textAlign: 'center',
  },
  rateLabel: {
    color: colors.textSecondary,
  },
  rateEquals: {
    color: colors.textSecondary,
  },
  currencyInput: {
    width: 60,
    textAlign: 'center',
  },
});
