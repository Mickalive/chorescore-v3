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
import { Invitation } from '../src/domain/entities';
import { createInvitation } from '../src/domain/services/invitationService';
import { LocalSystemShareAdapter } from '../src/infrastructure/local/LocalSystemShareAdapter';

const DEEP_LINK_BASE = 'https://chorescore.app/join';

export default function InviteScreen() {
  const router = useRouter();
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
      Alert.alert('Erreur', 'Adresse email invalide.');
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
        title: `Rejoindre ${currentHouseholdId}`,
        message: `Rejoins notre groupe sur ChoreScore : ${link}`,
        url: link,
      });
      setEmail('');
      return;
    }

    setIsSubmitting(true);
    try {
      const household = await repos.households.getById(currentHouseholdId);
      if (!household) throw new Error('Groupe introuvable');

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
        title: `Invitation a ${household.name}`,
        message: `Rejoins ${household.name} sur ChoreScore : ${link}`,
        url: link,
      });

      setEmail('');
      await loadInvitations();
    } catch {
      Alert.alert('Erreur', 'Impossible de creer l\'invitation.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleShareLink = async (token: string) => {
    const link = `${DEEP_LINK_BASE}/${token}`;
    const shareAdapter = new LocalSystemShareAdapter();
    await shareAdapter.share({
      title: 'Lien d\'invitation',
      message: `Rejoins notre groupe sur ChoreScore : ${link}`,
      url: link,
    });
  };

  return (
    <ScreenContainer>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text variant="caption" color={colors.textSecondary}>
              {'< Retour'}
            </Text>
          </TouchableOpacity>
          <Text variant="screenTitle">Inviter</Text>
        </View>

        <Card style={styles.card}>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="email@exemple.com"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Button
              title="Inviter"
              variant="primary"
              size="small"
              onPress={handleInvite}
              disabled={!email.trim() || isSubmitting}
              loading={isSubmitting}
            />
          </View>
          <Text variant="caption" color={colors.textSecondary} style={styles.hint}>
            Un lien d'invitation sera partage via la feuille de partage native.
          </Text>
        </Card>

        {existingInvitations.length > 0 && (
          <>
            <Text variant="sectionTitle" style={styles.sectionTitle}>
              En attente
            </Text>
            {existingInvitations.map((inv) => (
              <Card key={inv.id} style={styles.inviteCard}>
                <View style={styles.inviteRow}>
                  <View style={styles.inviteInfo}>
                    <Text variant="body">{inv.invitedEmail}</Text>
                    <Text variant="caption" color={colors.textSecondary}>
                      Cree le {new Date(inv.createdAt).toLocaleDateString('fr-FR')}
                    </Text>
                  </View>
                  <Button
                    title="Re-partager"
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
