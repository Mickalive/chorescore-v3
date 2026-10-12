/**
 * ChoreScore V4 — Screen Container
 *
 * Consistent screen wrapper with the warm V2 background and safe-area edges.
 *
 * Stack screens (pushed routes) pass `edges={['top', 'bottom']}` so controls
 * and content never sit under the Android navigation bar or the iOS home
 * indicator. Tab screens keep the default `['top']` and rely on React
 * Navigation's tab bar, which already consumes the bottom inset.
 */

import React from 'react';
import { View, StyleSheet, ScrollView, ViewStyle } from 'react-native';
import { SafeAreaView, Edge } from 'react-native-safe-area-context';
import { colors, spacing } from '../design-system/theme';

interface ScreenContainerProps {
  children: React.ReactNode;
  scrollable?: boolean;
  padded?: boolean;
  style?: ViewStyle;
  /** Safe-area edges to respect. Defaults to the top edge only. */
  edges?: Edge[];
}

export function ScreenContainer({
  children,
  scrollable = true,
  padded = true,
  style,
  edges = ['top'],
}: ScreenContainerProps) {
  const content = scrollable ? (
    <ScrollView
      style={styles.scrollView}
      contentContainerStyle={[padded && styles.padded, styles.scrollContent]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, padded && styles.padded, style]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={edges}>
      <View style={[styles.container, style]}>
        {content}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: spacing.lg,
  },
  scrollContent: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
});
