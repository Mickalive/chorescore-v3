/**
 * ChoreScore V3 — Invitation Screen
 *
 * Create and share invitations for the current group.
 * Uses the existing invitation port (SystemShareGateway) to open
 * the native share sheet with the invite link.
 *
 * Free for all. No premium gating. No plan limits.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  ScrollView,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '../src/ui/components/ScreenContainer';
import { Text } from '../src/ui/components/Text';
import { Button } from '../src/ui/components/Button';
import { Card } from '../src/ui/components/Card';
import { colors, spacing, borderRadius } from '../src/ui/design-system/theme';
import { useApp } from '../src/features/app/AppContext';
import { useI18n } from '../src/i18n';
import { Invitation } from '../src/domain/entities';
import { createInvitation } from '../src/domain/services/invitationService';
import { LocalSystemShareAdapter } from '../src/infrastructure/local/LocalSystemShareAdapter';

const DEEP_LINK_BASE = 'https://chorescore.app/join';

export default function InviteScreen() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const { currentHouseholdId, currentUser, repos, services } = useApp();
  const [email, setEmail] = useState('');
  const [existingInvitations, setExistingInvitations] = useState<Invitation[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadInvitations = useCallback(async () => {
    if (!currentHouseholdId) return;
    const invs = await repos.invitations.getByHousehold(currentHouseholdId);
    setExistingInvitations(invs.filter((i: Invitation) => i.status === 'pending'));
  }, [currentHouseholdId, repos]);

  useEffect(() => {
    loadInvitations();
  }, [loadInvitations]);

  const handleInvite = async () => {
    if (!currentHouseholdId || !currentUser || !email.trim()) return;
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedEmail.includes('@')) {
      Alert.alert(t('state.error'), t('invite.emailError'));
      return;
    }

    // Idempotency check: already has pending invitation for this email?
      const existing = existingInvitations.find(
        (i) => i.invitedEmail === trimmedEmail,
      );
      if (existing) {
        const link = `${DEEP_LINK_BASE}/${existing.linkToken}`;
        const shareAdapter = new LocalSystemShareAdapter();
        await shareAdapter.share({
          title: t('invite.linkTitle'),
          message: t('invite.linkMessage', { link }),
          url: link,
        });
        setEmail('');
        return;
      }

    setIsSubmitting(true);
    try {
      const household = await repos.households.getById(currentHouseholdId);
      if (!household) throw new Error(t('invite.groupNotFound'));

      const invData = createInvitation({
        household,
        invitedByUserId: currentUser.userId,
        invitedEmail: trimmedEmail,
      });

      const created = await repos.invitations.create(invData);

      // Share via system share sheet
      const link = `${DEEP_LINK_BASE}/${created.linkToken}`;
      const shareAdapter = new LocalSystemShareAdapter();
      await shareAdapter.share({
        title: t('invite.shareTitle', { group: household.name }),
        message: t('invite.shareMessage', { group: household.name, link }),
        url: link,
      });

      setEmail('');
      await loadInvitations();
    } catch {
      Alert.alert(t('state.error'), t('invite.createError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleShareLink = async (token: string) => {
    const link = `${DEEP_LINK_BASE}/${token}`;
    const shareAdapter = new LocalSystemShareAdapter();
    await shareAdapter.share({
      title: t('invite.linkTitle'),
      message: t('invite.linkMessage', { link }),
      url: link,
    });
  };

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text variant="caption" color={colors.textSecondary}>
              {`< ${t('action.back')}`}
            </Text>
          </TouchableOpacity>
          <Text variant="screenTitle">{t('invite.title')}</Text>
        </View>

        <Card style={styles.card}>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder={t('invite.emailPlaceholder')}
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Button
              title={t('invite.invite')}
              variant="primary"
              size="small"
              onPress={handleInvite}
              disabled={!email.trim() || isSubmitting}
              loading={isSubmitting}
            />
          </View>
          <Text variant="caption" color={colors.textSecondary} style={styles.hint}>
            {t('invite.hint')}
          </Text>
        </Card>

        {existingInvitations.length > 0 && (
          <>
            <Text variant="sectionTitle" style={styles.sectionTitle}>
              {t('invite.pending')}
            </Text>
            {existingInvitations.map((inv) => (
              <Card key={inv.id} style={styles.inviteCard}>
                <View style={styles.inviteRow}>
                  <View style={styles.inviteInfo}>
                    <Text variant="body">{inv.invitedEmail}</Text>
                    <Text variant="caption" color={colors.textSecondary}>
                      {t('invite.createdOn', {
                        date: new Date(inv.createdAt).toLocaleDateString(
                          locale === 'fr' ? 'fr-FR' : 'en-US',
                        ),
                      })}
                    </Text>
                  </View>
                  <Button
                    title={t('invite.reshare')}
                    variant="ghost"
                    size="small"
                    onPress={() => handleShareLink(inv.linkToken)}
                  />
                </View>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    marginBottom: spacing.xl,
    gap: spacing.sm,
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
  hint: {
    marginTop: spacing.sm,
  },
  sectionTitle: {
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  inviteCard: {
    marginBottom: spacing.sm,
  },
  inviteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inviteInfo: {
    flex: 1,
  },
});
