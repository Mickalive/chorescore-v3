/**
 * ChoreScore V3 — Text Component
 *
 * Typography tokens from the V3 design system.
 * Supports WCAG-compliant accessibility roles and labels.
 */

import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';
import { typography, colors } from '../design-system/theme';

type Variant = 'screenTitle' | 'sectionTitle' | 'body' | 'bodyBold' | 'caption' | 'metric' | 'metricUnit' | 'balance' | 'tabLabel';

interface TextProps extends RNTextProps {
  variant?: Variant;
  color?: string;
  children: React.ReactNode;
  /** Accessibility role — 'header' for titles, 'text' for body (default) */
  accessibilityRole?: 'header' | 'text' | 'none';
  /** Explicit label for screen readers. If omitted, text content is used. */
  accessibilityLabel?: string;
}

export function Text({
  variant = 'body',
  color,
  style,
  accessibilityRole,
  accessibilityLabel,
  children,
  ...props
}: TextProps) {
  const variantStyle = typography[variant];

  // Auto-derive accessibility role from variant if not provided
  const role = accessibilityRole
    ?? (variant === 'screenTitle' || variant === 'sectionTitle' ? 'header' : 'text');

  return (
    <RNText
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel}
      style={[variantStyle, color ? { color } : undefined, style]}
      {...props}
    >
      {children}
    </RNText>
  );
}
