/**
 * ChoreScore V3 — Root Index Screen (Groups)
 *
 * Shows the list of groups the user belongs to.
 * V3: No plan badges, no restrictions, unlimited groups.
 * Dense, transactional, premium V3 aesthetic.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, TouchableOpacity, Alert, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '../src/ui/components/ScreenContainer';
import { Text } from '../src/ui/components/Text';
import { Card } from '../src/ui/components/Card';
import { Button } from '../src/ui/components/Button';
import { colors, spacing, borderRadius } from '../src/ui/design-system/theme';
import { useApp } from '../src/features/app/AppContext';
import { Household } from '../src/domain/entities';

export default function HomeScreen() {
  const router = useRouter();
  const { currentUser, isLoading, signIn, households, loadHouseholds, createHousehold, setCurrentHouseholdId } = useApp();
  const [showSignIn, setShowSignIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    if (currentUser) {
      await loadHouseholds();
    }
  }, [currentUser, loadHouseholds]);

  useEffect(() => {
    load();
  }, [load]);

  const openHousehold = async (id: string) => {
    setCurrentHouseholdId(id);
    router.push('/(tabs)');
  };

  const handleCreateHousehold = async () => {
    if (!newGroupName.trim()) return;
    try {
      await createHousehold(newGroupName.trim());
      setNewGroupName('');
      setShowCreate(false);
    } catch {
      Alert.alert('Erreur', 'Impossible de créer le groupe.');
    }
  };

  const handleSignIn = async () => {
    if (!email || !password) return;
    await signIn(email, password);
    setShowSignIn(false);
  };

  const handleDemoSignIn = async () => {
    await signIn('demo@chorescore.app', 'demo-password');
  };

  // Loading state
  if (isLoading) {
    return (
      <ScreenContainer>
        <View style={styles.loadingContainer}>
          <Text variant="body">Chargement...</Text>
        </View>
      </ScreenContainer>
    );
  }

  // Sign-in screen
  if (!currentUser) {
    return (
      <ScreenContainer>
        <View style={styles.header}>
          <Text variant="screenTitle">ChoreScore</Text>
          <Text variant="caption">Equilibrer ce que le groupe paie et fait</Text>
        </View>

        {!showSignIn ? (
          <View style={styles.signInContainer}>
            <Button
              title="Demarrer (demo)"
              variant="primary"
              onPress={handleDemoSignIn}
              style={styles.fullWidth}
            />
            <Button
              title="Se connecter"
              variant="secondary"
              onPress={() => setShowSignIn(true)}
              style={styles.fullWidth}
            />
          </View>
        ) : (
          <View style={styles.signInForm}>
            <Text variant="sectionTitle" style={styles.formTitle}>
              Connexion
            </Text>

            <View style={styles.inputGroup}>
              <Text variant="caption">Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="votre@email.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text variant="caption">Mot de passe</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Mot de passe"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
              />
            </View>

            <Button
              title="Se connecter"
              variant="primary"
              onPress={handleSignIn}
              style={styles.fullWidth}
            />

            <Button
              title="Retour"
              variant="ghost"
              onPress={() => setShowSignIn(false)}
              size="small"
            />
          </View>
        )}
      </ScreenContainer>
    );
  }

  // Groups list
  return (
    <ScreenContainer>
      <View style={styles.header}>
        <Text variant="screenTitle">Groupes</Text>
      </View>

      <View style={styles.list}>
        {households.length === 0 ? (
          <View style={styles.emptyState}>
            <Text variant="sectionTitle" style={styles.emptyTitle}>
              Aucun groupe
            </Text>
            <Text variant="body" style={styles.emptyText}>
              Creez un groupe pour commencer a partager depenses et contributions.
            </Text>
          </View>
        ) : (
          households.map((item: Household) => (
            <TouchableOpacity
              key={item.id}
              onPress={() => openHousehold(item.id)}
              activeOpacity={0.7}
            >
              <Card variant="highlighted" style={styles.householdCard}>
                <View style={styles.householdRow}>
                  <View style={styles.householdInfo}>
                    <Text variant="sectionTitle">{item.name}</Text>
                    <Text variant="caption">
                      {item.contributionUnit === 'minutes' ? 'Minutes' : 'Points'}
                    </Text>
                  </View>
                  <Text variant="caption" style={styles.chevron}>{'>'}</Text>
                </View>
              </Card>
            </TouchableOpacity>
          ))
        )}
      </View>

      {showCreate ? (
        <View style={styles.createForm}>
          <View style={styles.inputGroup}>
            <Text variant="caption">Nom du groupe</Text>
            <TextInput
              style={styles.input}
              value={newGroupName}
              onChangeText={setNewGroupName}
              placeholder="Ex: Colocation, Famille..."
              placeholderTextColor={colors.textMuted}
            />
          </View>
          <View style={styles.createActions}>
            <Button
              title="Creer"
              variant="primary"
              onPress={handleCreateHousehold}
              disabled={!newGroupName.trim()}
            />
            <Button
              title="Annuler"
              variant="ghost"
              onPress={() => {
                setShowCreate(false);
                setNewGroupName('');
              }}
              size="small"
            />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button
            title="Creer un groupe"
            variant="primary"
            onPress={() => setShowCreate(true)}
          />
        </View>
      )}
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
  signInForm: {
    paddingVertical: spacing.xl,
  },
  formTitle: {
    marginBottom: spacing.xl,
  },
  inputGroup: {
    marginBottom: spacing.md,
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
});
