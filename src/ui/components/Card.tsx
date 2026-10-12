/**
 * ChoreScore V3 — Card Component
 *
 * Minimal surface with subtle metallic border. No heavy shadows.
 */

import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { colors, spacing, borderRadius, shadows } from '../design-system/theme';

interface CardProps {
  children: React.ReactNode;
  variant?: 'default' | 'highlighted';
  style?: ViewStyle;
}

export function Card({ children, variant = 'default', style }: CardProps) {
  return (
    <View
      style={[
        styles.base,
        variant === 'highlighted' && styles.highlighted,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadows.small,
  },
  highlighted: {
    backgroundColor: colors.surfaceHighlight,
  },
});
