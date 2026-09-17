/**
 * ChoreScore V3 — Join Group via Deep-Link
 *
 * Route: /join/:token
 *
 * Resolves an invitation by its link token and accepts it atomically
 * (creates both membership and member in a transaction).
 *
 * If the user is not signed in, they are prompted to sign in first.
 * If the invitation is expired, revoked, or the user is already a member,
 * an appropriate message is shown.
 *
 * Free for all. No premium gating. No plan limits.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenContainer } from '../../src/ui/components/ScreenContainer';
import { Text } from '../../src/ui/components/Text';
import { Button } from '../../src/ui/components/Button';
import { Card } from '../../src/ui/components/Card';
import { colors, spacing } from '../../src/ui/design-system/theme';
import { useApp } from '../../src/features/app/AppContext';
import {
  validateAcceptInvitation,
  planInvitationAcceptance,
} from '../../src/domain/services/invitationService';

type JoinStatus = 'loading' | 'ready' | 'accepting' | 'accepted' | 'error';

export default function JoinScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const { currentUser, repos, rawRepos, signIn } = useApp();

  const [status, setStatus] = useState<JoinStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [householdName, setHouseholdName] = useState('');

  const resolveInvitation = useCallback(async () => {
    if (!token) {
      setStatus('error');
      setErrorMessage('Lien d\'invitation invalide.');
      return;
    }

    try {
      // V3-06 REPAIR: Use rawRepos for invitation resolution. The join flow
      // requires reading the household and existing memberships BEFORE the
      // user is a member, so scoped repos would reject with CROSS_TENANT.
      // Token-based invitation lookups are invitation-authorized (anyone with
      // the token can resolve).
      const invitation = await rawRepos.invitations.getByLinkToken(token as string);
      if (!invitation) {
        setStatus('error');
        setErrorMessage('Invitation introuvable ou invalide.');
        return;
      }

      const household = await rawRepos.households.getById(invitation.householdId);
      if (!household) {
        setStatus('error');
        setErrorMessage('Groupe introuvable.');
        return;
      }

      setHouseholdName(household.name);

      // Check if user is signed in
      if (!currentUser) {
        setStatus('error');
        setErrorMessage('Connectez-vous pour accepter l\'invitation.');
        return;
      }

      // Validate acceptance using raw repos (user is not yet a member)
      const existingMemberships = await rawRepos.memberships.getByHousehold(invitation.householdId);
      try {
        validateAcceptInvitation(invitation, household, existingMemberships, currentUser.userId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invitation invalide.';
        setStatus('error');
        setErrorMessage(msg);
        return;
      }

      setStatus('ready');
    } catch {
      setStatus('error');
      setErrorMessage('Erreur lors de la verification de l\'invitation.');
    }
  }, [token, rawRepos, currentUser]);

  useEffect(() => {
    resolveInvitation();
  }, [resolveInvitation]);

  const handleAccept = async () => {
    if (!token || !currentUser) return;
    setStatus('accepting');

    try {
      // V3-06 REPAIR: Use rawRepos for the entire join flow. The user is
      // not yet a member of the household, so scoped repos would reject
      // all operations with CROSS_TENANT. Token-based invitation access
      // and membership creation are invitation-authorized.
      const invitation = await rawRepos.invitations.getByLinkToken(token as string);
      if (!invitation) {
        setStatus('error');
        setErrorMessage('Invitation introuvable.');
        return;
      }

      const household = await rawRepos.households.getById(invitation.householdId);
      if (!household) {
        setStatus('error');
        setErrorMessage('Groupe introuvable.');
        return;
      }

      // Plan the atomic membership + member creation
      const result = planInvitationAcceptance(invitation, currentUser.userId, currentUser.displayName);

      // Execute atomically in a transaction (using rawRepos for invitation-authorized writes)
      await rawRepos.withTransaction(async () => {
        await rawRepos.memberships.create({
          userId: result.membership.userId,
          householdId: result.membership.householdId,
          role: result.membership.role,
        });
        await rawRepos.members.create({
          householdId: result.member.householdId,
          name: result.member.name,
          userId: result.member.userId,
        });
        await rawRepos.invitations.updateStatus(invitation.id, 'accepted');
      });

      setStatus('accepted');
    } catch {
      setStatus('error');
      setErrorMessage('Erreur lors de l\'acceptation de l\'invitation.');
    }
  };

  const handleGoToGroup = () => {
    // Navigate to the root and the user can open the group
    router.replace('/');
  };

  return (
    <ScreenContainer>
      <View style={styles.container}>
        <Text variant="screenTitle" style={styles.title}>
          Rejoindre un groupe
        </Text>

        {status === 'loading' && (
          <Card style={styles.card}>
            <Text variant="body">Verification de l'invitation...</Text>
          </Card>
        )}

        {status === 'ready' && (
          <Card style={styles.card}>
            <Text variant="body" style={styles.message}>
              Vous etes invite a rejoindre <Text variant="bodyBold">{householdName}</Text>.
            </Text>
            <Button
              title="Rejoindre le groupe"
              variant="primary"
              onPress={handleAccept}
              style={styles.button}
            />
          </Card>
        )}

        {status === 'accepting' && (
          <Card style={styles.card}>
            <Text variant="body">Acceptation en cours...</Text>
          </Card>
        )}

        {status === 'accepted' && (
          <Card style={styles.card}>
            <Text variant="body" style={styles.successMessage}>
              Vous avez rejoint <Text variant="bodyBold">{householdName}</Text> !
            </Text>
            <Button
              title="Aller au groupe"
              variant="primary"
              onPress={handleGoToGroup}
              style={styles.button}
            />
          </Card>
        )}

        {status === 'error' && (
          <Card style={styles.card}>
            <Text variant="body" style={styles.errorMessage}>
              {errorMessage}
            </Text>
            <Button
              title="Retour"
              variant="secondary"
              onPress={() => router.replace('/')}
              style={styles.button}
            />
          </Card>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  title: {
    textAlign: 'center',
    marginBottom: spacing.xxl,
  },
  card: {
    padding: spacing.xl,
  },
  message: {
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  successMessage: {
    textAlign: 'center',
    marginBottom: spacing.xl,
    color: colors.balancePositive,
  },
  errorMessage: {
    textAlign: 'center',
    marginBottom: spacing.xl,
    color: colors.balanceNegative,
  },
  button: {
    marginTop: spacing.md,
  },
});
