/**
 * ChoreScore V4 — Shared state components
 *
 * One honest place for the mandatory states of the constitution §23:
 * loading, empty, error, offline and degraded-persistence. All strings come
 * from the caller through i18n so no French literal is hardcoded here, and
 * every component carries a screen-reader role or live region.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, View, ViewStyle } from 'react-native';
import { Text } from './Text';
import { Button } from './Button';
import { colors, spacing, borderRadius } from '../design-system/theme';

export function LoadingState({ message }: { message: string }) {
  return (
    <View
      style={styles.centered}
      accessibilityRole="progressbar"
      accessibilityLabel={message}
    >
      <ActivityIndicator color={colors.primary} size="small" />
      <Text variant="caption" color={colors.textSecondary} style={styles.centeredText}>
        {message}
      </Text>
    </View>
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.centered}>
      <Text variant="sectionTitle" accessibilityRole="header" style={styles.centeredText}>
        {title}
      </Text>
      {body ? (
        <Text variant="caption" color={colors.textSecondary} style={styles.centeredText}>
          {body}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <Button
          title={actionLabel}
          variant="secondary"
          size="small"
          onPress={onAction}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

export function ErrorState({
  title,
  message,
  retryLabel,
  onRetry,
}: {
  title: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.centered} accessibilityRole="alert">
      <Text variant="sectionTitle" color={colors.balanceNegative} style={styles.centeredText}>
        {title}
      </Text>
      {message ? (
        <Text variant="caption" color={colors.textSecondary} style={styles.centeredText}>
          {message}
        </Text>
      ) : null}
      {retryLabel && onRetry ? (
        <Button
          title={retryLabel}
          variant="secondary"
          size="small"
          onPress={onRetry}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

export type NoticeTone = 'info' | 'warning' | 'error' | 'success';

const TONE_COLOR: Record<NoticeTone, string> = {
  info: colors.textSecondary,
  warning: colors.warning,
  error: colors.balanceNegative,
  success: colors.balancePositive,
};

export function InlineNotice({
  tone = 'info',
  message,
  style,
}: {
  tone?: NoticeTone;
  message: string;
  style?: ViewStyle;
}) {
  return (
    <View
      style={[styles.notice, { borderLeftColor: TONE_COLOR[tone] }, style]}
      accessibilityLiveRegion="polite"
    >
      <Text variant="caption" color={TONE_COLOR[tone]}>
        {message}
      </Text>
    </View>
  );
}

/**
 * Shown when the local database could not be opened and the app fell back to
 * an in-memory store. The user is told the truth: data may not survive a
 * restart. Presentational only; the caller owns visibility and the message.
 */
export function PersistenceBanner({
  visible,
  message,
}: {
  visible: boolean;
  message: string;
}) {
  if (!visible) return null;
  return (
    <View style={styles.banner} accessibilityLiveRegion="polite">
      <Text variant="caption" color={colors.warning}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  centeredText: {
    textAlign: 'center',
  },
  action: {
    marginTop: spacing.sm,
  },
  notice: {
    borderLeftWidth: 3,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.sm,
  },
  banner: {
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.surfaceAlt,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
});
