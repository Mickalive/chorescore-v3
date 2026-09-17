/**
 * ChoreScore V3 — Button Component
 *
 * Minimal, precise, metallic. No decorative gradients.
 * WCAG-compliant with proper accessibilityRole, label, and state.
 */

import React from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  ActivityIndicator,
} from 'react-native';
import { Text } from './Text';
import { colors, spacing, borderRadius } from '../design-system/theme';

interface ButtonProps {
  title: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'small' | 'medium';
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  /** Accessibility label for screen readers. Falls back to `title`. */
  accessibilityLabel?: string;
  /** Optional hint for screen readers (e.g. "Double tap to submit") */
  accessibilityHint?: string;
}

export function Button({
  title,
  variant = 'primary',
  size = 'medium',
  onPress,
  disabled = false,
  loading = false,
  style,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  return (
    <TouchableOpacity
      style={[
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        size === 'small' && styles.small,
        disabled && styles.disabled,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled, busy: loading }}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.textOnPrimary : colors.text}
          size="small"
          accessibilityLabel="Chargement"
        />
      ) : (
        <Text
          variant={size === 'small' ? 'caption' : 'bodyBold'}
          color={
            variant === 'primary'
              ? colors.textOnPrimary
              : variant === 'secondary'
              ? colors.text
              : colors.textSecondary
          }
          accessibilityLabel={title}
        >
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
  },
  primary: {
    backgroundColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  small: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  disabled: {
    opacity: 0.4,
  },
});
