/**
 * ChoreScore V4 — Legal documents
 *
 * Reachable from General options → Legal. Renders the terms of use, the
 * privacy policy or the legal notice from the FR/EN catalog. No network
 * access, no hardcoded French, no external browser dependency: the document
 * is shown in-app so every build exposes real legal content.
 */

import React from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenContainer } from '../src/ui/components/ScreenContainer';
import { Text } from '../src/ui/components/Text';
import { Card } from '../src/ui/components/Card';
import { colors, spacing } from '../src/ui/design-system/theme';
import { useI18n } from '../src/i18n';

type LegalDoc = 'terms' | 'privacy' | 'notice';

const DOC_KEYS: Record<LegalDoc, { title: string; body: string }> = {
  terms: { title: 'legal.terms', body: 'legal.termsBody' },
  privacy: { title: 'legal.privacy', body: 'legal.privacyBody' },
  notice: { title: 'legal.notice', body: 'legal.noticeBody' },
};

function isLegalDoc(value: string | undefined): value is LegalDoc {
  return value === 'terms' || value === 'privacy' || value === 'notice';
}

export default function LegalScreen() {
  const router = useRouter();
  const { doc } = useLocalSearchParams<{ doc?: string }>();
  const { t } = useI18n();
  const selected: LegalDoc | null = isLegalDoc(doc) ? doc : null;

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button">
          <Text variant="caption" color={colors.textSecondary}>
            {'‹ '}
            {t('action.back')}
          </Text>
        </TouchableOpacity>
        <Text variant="screenTitle" style={styles.title} accessibilityRole="header">
          {selected ? t(DOC_KEYS[selected].title) : t('legal.title')}
        </Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {selected ? (
          <Card style={styles.card}>
            <Text variant="caption" color={colors.textMuted} style={styles.updated}>
              {t('legal.updated')}
            </Text>
            <Text variant="body" style={styles.body}>
              {t(DOC_KEYS[selected].body)}
            </Text>
          </Card>
        ) : (
          <Card style={styles.card}>
            <Text variant="bodyBold" accessibilityRole="header">
              {t('legal.notFoundTitle')}
            </Text>
            <Text variant="caption" style={styles.body}>
              {t('legal.notFoundBody')}
            </Text>
          </Card>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: spacing.lg,
  },
  title: {
    marginTop: spacing.md,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xxl,
  },
  card: {
    paddingVertical: spacing.lg,
  },
  updated: {
    marginBottom: spacing.md,
  },
  body: {
    marginTop: spacing.xs,
    lineHeight: 22,
  },
});
