/**
 * ChoreScore V4 — General Options
 *
 * Reachable from the bottom of the Groups root. Gathers profile, language,
 * notifications, privacy/data and legal, plus sign out. No premium or
 * subscription surface.
 */

import React, { useEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, Switch, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '../src/ui/components/ScreenContainer';
import { Text } from '../src/ui/components/Text';
import { Card } from '../src/ui/components/Card';
import { Button } from '../src/ui/components/Button';
import { colors, spacing } from '../src/ui/design-system/theme';
import { useApp } from '../src/features/app/AppContext';
import { useI18n, SupportedLocale } from '../src/i18n';

const PRIVACY_CONSENT_KEY = 'chorescore.privacy.consent.v4';

function SettingRow({
  label,
  value,
  onPress,
  last,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
}) {
  const content = (
    <View style={[styles.row, last && styles.rowLast]}>
      <Text variant="body">{label}</Text>
      {value ? (
        <Text variant="caption" color={colors.textSecondary}>
          {value}
        </Text>
      ) : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button">
      {content}
    </TouchableOpacity>
  );
}

export default function GeneralOptionsScreen() {
  const router = useRouter();
  const { currentUser, signOut, services } = useApp();
  const { t, locale, setLocale } = useI18n();
  const [privacyConsent, setPrivacyConsent] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(PRIVACY_CONSENT_KEY)
      .then((value) => setPrivacyConsent(value === 'true'))
      .catch(() => {
        // Preference is best-effort.
      });
  }, []);

  const handleLocale = (next: SupportedLocale) => {
    setLocale(next);
  };

  const handleConsentChange = (next: boolean) => {
    setPrivacyConsent(next);
    AsyncStorage.setItem(PRIVACY_CONSENT_KEY, next ? 'true' : 'false').catch(() => {
      // Ignore persistence failure; the in-memory preference still applies.
    });
  };

  const handleLegal = () => {
    Alert.alert(t('options.legal'), t('options.legalUnavailable'));
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace('/');
  };

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text variant="caption" color={colors.textSecondary}>
            {'‹ '}
            {t('action.back')}
          </Text>
        </TouchableOpacity>
        <Text variant="screenTitle" style={styles.title}>
          {t('options.title')}
        </Text>
      </View>

      <Text variant="caption" style={styles.sectionLabel}>
        {t('options.profile')}
      </Text>
      <Card style={styles.card}>
        <SettingRow
          label={currentUser?.displayName ?? t('options.profileNotSignedIn')}
          value={currentUser?.email}
          last
        />
      </Card>

      <Text variant="caption" style={styles.sectionLabel}>
        {t('options.language')}
      </Text>
      <Card style={styles.card}>
        <TouchableOpacity
          onPress={() => handleLocale('fr')}
          accessibilityRole="button"
          accessibilityState={{ selected: locale === 'fr' }}
        >
          <View style={styles.row}>
            <Text variant="body">{t('options.languageFrench')}</Text>
            {locale === 'fr' ? <Text variant="body" color={colors.primary}>{'✓'}</Text> : null}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleLocale('en')}
          accessibilityRole="button"
          accessibilityState={{ selected: locale === 'en' }}
        >
          <View style={[styles.row, styles.rowLast]}>
            <Text variant="body">{t('options.languageEnglish')}</Text>
            {locale === 'en' ? <Text variant="body" color={colors.primary}>{'✓'}</Text> : null}
          </View>
        </TouchableOpacity>
      </Card>

      <Text variant="caption" style={styles.sectionLabel}>
        {t('options.notifications')}
      </Text>
      <Card style={styles.card}>
        <SettingRow
          label={
            services.notifications.isAvailable()
              ? t('options.notificationsAvailable')
              : t('options.notificationsUnavailable')
          }
          last
        />
      </Card>

      <Text variant="caption" style={styles.sectionLabel}>
        {t('options.privacy')}
      </Text>
      <Card style={styles.card}>
        <Text variant="bodyBold" style={styles.privacyTitle}>
          {t('options.privacyDataTitle')}
        </Text>
        <Text variant="caption" style={styles.privacyBody}>
          {t('options.privacyBody')}
        </Text>
        <View style={[styles.row, styles.rowLast, styles.consentRow]}>
          <Text variant="body" style={styles.consentLabel}>
            {t('options.privacyConsent')}
          </Text>
          <Switch
            value={privacyConsent}
            onValueChange={handleConsentChange}
            trackColor={{ false: colors.border, true: colors.primaryLight }}
            thumbColor={privacyConsent ? colors.primary : colors.surface}
          />
        </View>
      </Card>

      <Text variant="caption" style={styles.sectionLabel}>
        {t('options.legal')}
      </Text>
      <Card style={styles.card}>
        <SettingRow label={t('options.legalTerms')} onPress={handleLegal} />
        <SettingRow label={t('options.legalPrivacy')} onPress={handleLegal} />
        <SettingRow label={t('options.legalNotice')} onPress={handleLegal} last />
      </Card>

      <View style={styles.signOut}>
        <Button title={t('options.signOut')} variant="ghost" onPress={handleSignOut} />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.xl,
  },
  title: {
    marginTop: spacing.md,
  },
  sectionLabel: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  card: {
    paddingVertical: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    gap: spacing.md,
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  privacyTitle: {
    marginTop: spacing.md,
  },
  privacyBody: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  consentRow: {
    marginTop: spacing.xs,
  },
  consentLabel: {
    flex: 1,
  },
  signOut: {
    marginTop: spacing.xxl,
    alignItems: 'center',
  },
});
