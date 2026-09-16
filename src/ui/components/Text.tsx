/**
 * ChoreScore V3 — Text Component
 *
 * Typography tokens from the V3 design system.
 */

import React from 'react';
import { Text as RNText, TextProps as RNTextProps, StyleSheet } from 'react-native';
import { typography, colors } from '../design-system/theme';

type Variant = 'screenTitle' | 'sectionTitle' | 'body' | 'bodyBold' | 'caption' | 'metric' | 'metricUnit' | 'balance';

interface TextProps extends RNTextProps {
  variant?: Variant;
  color?: string;
  children: React.ReactNode;
}

export function Text({ variant = 'body', color, style, children, ...props }: TextProps) {
  const variantStyle = typography[variant];
  return (
    <RNText
      style={[variantStyle, color ? { color } : undefined, style]}
      {...props}
    >
      {children}
    </RNText>
  );
}
