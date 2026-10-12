/**
 * ChoreScore V4 — Invitation Screen
 *
 * Invitations are shared by link only, after the group exists. The link is
 * generated locally and opened in the native share sheet through the injected
 * SystemShareGateway port (no fake share).
 *
 * Free for all. No premium gating. No plan limits.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenContainer } from '../src/ui/components/ScreenContainer';
import { Text } from '../src/ui/components/Text';
import { Button } from '../src/ui/components/Button';
import { Card } from '../src/ui/components/Card';
import { colors, spacing } from '../src/ui/design-system/theme';
import { useApp } from '../src/features/app/AppContext';
import { useI18n } from '../src/i18n';
import { Invitation, Member } from '../src/domain/entities';
import { createInvitation } from '../src/domain/services/invitationService';

const DEEP_LINK_BASE = 'https://chorescore.app/join';

export default function InviteScreen() {
  const router = useRouter();
  const { t, locale } = useI18n();
  const { currentHouseholdId, currentUser, repos, services } = useApp();
  const { memberId } = useLocalSearchParams<{ memberId?: string }>();
  const [existingInvitations, setExistingInvitations] = useState<Invitation[]>([]);
  const [targetMember, setTargetMember] = useState<Member | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadInvitations = useCallback(async () => {
    if (!currentHouseholdId) return;
    const invs = await repos.invitations.getByHousehold(currentHouseholdId);
    setExistingInvitations(invs.filter((i: Invitation) => i.status === 'pending'));
  }, [currentHouseholdId, repos]);

  useEffect(() => {
    loadInvitations();
  }, [loadInvitations]);

  // V4-09: a targeted invitation links an existing named member. Resolve the
  // member so the screen can show who is being invited and create the
  // invitation with the exact member id (never a name match).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!memberId || !currentHouseholdId) return;
      const member = await repos.members.getById(memberId);
      if (!cancelled) setTargetMember(member ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [memberId, currentHouseholdId, repos]);

  const shareLink = useCallback(async (token: string, groupName?: string) => {
    const link = `${DEEP_LINK_BASE}/${token}`;
    await services.share.share({
      title: groupName ? t('invite.shareTitle', { group: groupName }) : t('invite.linkTitle'),
      message: groupName
        ? t('invite.shareMessage', { group: groupName, link })
        : t('invite.linkMessage', { link }),
      url: link,
    });
  }, [services, t]);

  const handleCreateAndShare = async () => {
    if (!currentHouseholdId || !currentUser) return;
    setIsSubmitting(true);
    try {
      const household = await repos.households.getById(currentHouseholdId);
      if (!household) throw new Error(t('invite.groupNotFound'));

      // Reuse the current pending link so repeated taps never pile up
      // one-time invitations. The reuse is scoped to the SAME target: a
      // link-only invitation is only reused for the link-only screen, and a
      // targeted invitation is only reused for the exact same member — never
      // for a different member (V4-09: the link is by member id, not by name).
      const existing = existingInvitations.find(
        (inv) => (inv.targetMemberId ?? null) === (targetMember?.id ?? null),
      );
      if (existing) {
        await shareLink(existing.linkToken, household.name);
        return;
      }

      const invData = createInvitation({
        household,
        invitedByUserId: currentUser.userId,
        targetMemberId: targetMember?.id ?? null,
      });
      const created = await repos.invitations.create(invData);
      await shareLink(created.linkToken, household.name);
      await loadInvitations();
    } catch {
      Alert.alert(t('state.error'), t('invite.createError'));
    } finally {
      setIsSubmitting(false);
    }
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
          <Text variant="body" style={styles.hint}>
            {targetMember
              ? t('invite.targetedHint', { name: targetMember.name })
              : t('invite.linkOnlyHint')}
          </Text>
          <Button
            title={targetMember
              ? t('invite.createTargetedLink', { name: targetMember.name })
              : t('invite.createLink')}
            variant="primary"
            onPress={handleCreateAndShare}
            disabled={!currentHouseholdId || isSubmitting}
            loading={isSubmitting}
            style={styles.shareButton}
          />
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
                    <Text variant="body">
                      {inv.invitedEmail || t('invite.linkLabel')}
                    </Text>
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
                    onPress={() => shareLink(inv.linkToken)}
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
  hint: {
    marginBottom: spacing.md,
  },
  shareButton: {
    width: '100%',
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
