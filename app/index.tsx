/**
 * ChoreScore V4 — Root Index Screen (Groups)
 *
 * Social authentication only (Google / Apple / Facebook) behind honest
 * ports/adapters. Once signed in, returns directly to the groups list.
 * No demo entry, no email/password, no plan badge, unlimited groups.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '../src/ui/components/ScreenContainer';
import { Text } from '../src/ui/components/Text';
import { Card } from '../src/ui/components/Card';
import { Button } from '../src/ui/components/Button';
import { LoadingState, EmptyState, PersistenceBanner } from '../src/ui/components/States';
import { colors, spacing, borderRadius } from '../src/ui/design-system/theme';
import { useApp, SocialProvider } from '../src/features/app/AppContext';
import { useI18n } from '../src/i18n';
import { Household } from '../src/domain/entities';

const SOCIAL_PROVIDERS: SocialProvider[] = ['google', 'apple', 'facebook'];

const PROVIDER_TITLE_KEY: Record<SocialProvider, string> = {
  google: 'auth.continueGoogle',
  apple: 'auth.continueApple',
  facebook: 'auth.continueFacebook',
};

export default function HomeScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const {
    currentUser,
    isLoading,
    persistenceDegraded,
    signInWithProvider,
    households,
    loadHouseholds,
    createHousehold,
    setCurrentHouseholdId,
    getMembersForHousehold,
  } = useApp();
  const [signingInProvider, setSigningInProvider] = useState<SocialProvider | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [memberInput, setMemberInput] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [memberCounts, setMemberCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    if (currentUser) {
      await loadHouseholds();
    }
  }, [currentUser, loadHouseholds]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    if (households.length === 0) {
      setMemberCounts({});
      return;
    }
    Promise.all(
      households.map(async (group) => {
        try {
          const members = await getMembersForHousehold(group.id);
          return [group.id, members.length] as const;
        } catch {
          return [group.id, 0] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setMemberCounts(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [households, getMembersForHousehold]);

  const openHousehold = async (id: string) => {
    setCurrentHouseholdId(id);
    router.push('/add');
  };

  const handleCreateHousehold = async () => {
    if (!newGroupName.trim()) return;
    try {
      await createHousehold(newGroupName.trim(), memberNames);
      setNewGroupName('');
      setMemberNames([]);
      setMemberInput('');
      setShowCreate(false);
    } catch {
      Alert.alert(t('state.error'), t('groups.createError'));
    }
  };

  const handleAddMemberName = () => {
    const name = memberInput.trim();
    if (!name) return;
    setMemberNames((current) => [...current, name]);
    setMemberInput('');
  };

  const handleRemoveMemberName = (index: number) => {
    setMemberNames((current) => current.filter((_, i) => i !== index));
  };

  const handleCloseCreate = () => {
    setShowCreate(false);
    setNewGroupName('');
    setMemberNames([]);
    setMemberInput('');
  };

  const handleProviderSignIn = async (provider: SocialProvider) => {
    setSigningInProvider(provider);
    try {
      const ok = await signInWithProvider(provider);
      if (!ok) {
        Alert.alert(t('state.error'), t('auth.providerUnavailable'));
      }
    } finally {
      setSigningInProvider(null);
    }
  };

  if (isLoading) {
    return (
      <ScreenContainer edges={['top', 'bottom']}>
        <LoadingState message={t('state.loading')} />
      </ScreenContainer>
    );
  }

  // Sign-in: honest social providers only. No demo, no email/password.
  if (!currentUser) {
    return (
      <ScreenContainer edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text variant="screenTitle">{t('app.name')}</Text>
          <Text variant="caption">{t('app.tagline')}</Text>
        </View>

        <View style={styles.signInContainer}>
          {SOCIAL_PROVIDERS.map((provider) => (
            <Button
              key={provider}
              title={signingInProvider === provider ? t('auth.signingIn') : t(PROVIDER_TITLE_KEY[provider])}
              variant={provider === 'google' ? 'primary' : 'secondary'}
              onPress={() => handleProviderSignIn(provider)}
              disabled={signingInProvider !== null}
              style={styles.fullWidth}
            />
          ))}
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text variant="screenTitle">{t('groups.title')}</Text>
      </View>

      <PersistenceBanner visible={persistenceDegraded} message={t('state.persistenceBody')} />

      <View style={styles.list}>
        {households.length === 0 ? (
          <EmptyState
            title={t('groups.emptyTitle')}
            body={t('groups.emptyBody')}
            actionLabel={t('groups.create')}
            onAction={() => setShowCreate(true)}
          />
        ) : (
          households.map((item: Household) => {
            const count = memberCounts[item.id] ?? null;
            return (
              <TouchableOpacity
                key={item.id}
                onPress={() => openHousehold(item.id)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('a11y.openGroup', { name: item.name })}
              >
                <Card variant="highlighted" style={styles.householdCard}>
                  <View style={styles.householdRow}>
                    <View style={styles.householdInfo}>
                      <Text variant="sectionTitle">{item.name}</Text>
                      <Text variant="caption">
                        {count === null
                          ? item.contributionUnit === 'minutes'
                            ? t('unit.minutes')
                            : t('unit.points')
                          : count === 1
                            ? t('groups.memberOne')
                            : t('groups.memberMany', { count })}
                      </Text>
                    </View>
                    <View style={styles.householdActions}>
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation?.();
                          setCurrentHouseholdId(item.id);
                          router.push('/group-options');
                        }}
                        style={styles.actionChip}
                        accessibilityRole="button"
                        accessibilityLabel={t('a11y.groupOptions', { name: item.name })}
                      >
                        <Text variant="caption" color={colors.textSecondary}>
                          {t('groups.options')}
                        </Text>
                      </TouchableOpacity>
                      <Text variant="caption" style={styles.chevron}>{'>'}</Text>
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      {showCreate ? (
        <View style={styles.createForm}>
          <View style={styles.inputGroup}>
            <Text variant="caption">{t('groups.nameLabel')}</Text>
            <TextInput
              testID="groups.nameInput"
              style={styles.input}
              value={newGroupName}
              onChangeText={setNewGroupName}
              placeholder={t('groups.namePlaceholder')}
              placeholderTextColor={colors.textMuted}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text variant="caption">{t('groups.membersLabel')}</Text>
            <View style={styles.memberInputRow}>
              <TextInput
                testID="groups.memberInput"
                style={[styles.input, styles.memberInput]}
                value={memberInput}
                onChangeText={setMemberInput}
                placeholder={t('groups.memberNamePlaceholder')}
                placeholderTextColor={colors.textMuted}
                onSubmitEditing={handleAddMemberName}
                returnKeyType="done"
              />
              <Button
                title={t('action.add')}
                variant="secondary"
                size="small"
                onPress={handleAddMemberName}
                disabled={!memberInput.trim()}
              />
            </View>
            {memberNames.length > 0 && (
              <View style={styles.memberChips}>
                {memberNames.map((memberName, index) => (
                  <TouchableOpacity
                    key={`${memberName}-${index}`}
                    onPress={() => handleRemoveMemberName(index)}
                    style={styles.memberChip}
                    accessibilityRole="button"
                    accessibilityLabel={t('groups.removeMember', { name: memberName })}
                  >
                    <Text variant="caption">{memberName}</Text>
                    <Text variant="caption" color={colors.textMuted}>{'  ×'}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <Text variant="caption" color={colors.textSecondary} style={styles.memberHelp}>
              {t('groups.membersHelp')}
            </Text>
          </View>

          <View style={styles.createActions}>
            <Button
              title={t('action.create')}
              variant="primary"
              onPress={handleCreateHousehold}
              disabled={!newGroupName.trim()}
            />
            <Button
              title={t('action.cancel')}
              variant="ghost"
              onPress={handleCloseCreate}
              size="small"
            />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button
            title={t('groups.create')}
            variant="primary"
            onPress={() => setShowCreate(true)}
            testID="groups.createButton"
          />
        </View>
      )}

      <TouchableOpacity
        onPress={() => router.push('/general-options')}
        style={styles.generalOptions}
        accessibilityRole="button"
      >
        <Text variant="caption" color={colors.textSecondary}>
          {t('groups.generalOptions')}
        </Text>
      </TouchableOpacity>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.xl,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  signInContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  memberInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  memberInput: {
    flex: 1,
  },
  memberChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  memberChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  memberHelp: {
    marginTop: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
    fontSize: 16,
    color: colors.text,
  },
  fullWidth: {
    width: '100%',
  },
  list: {
    gap: spacing.md,
  },
  householdCard: {
    marginBottom: spacing.sm,
  },
  householdRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  householdInfo: {
    flex: 1,
  },
  householdActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceAlt,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 18,
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
  actions: {
    marginTop: spacing.xl,
    alignItems: 'center',
  },
  createForm: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  createActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  generalOptions: {
    marginTop: spacing.xxl,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});
