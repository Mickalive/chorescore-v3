/**
 * ChoreScore V4 — Tabs Layout
 *
 * Three exact tabs: Ajouter / Balances / À faire, localized FR/EN.
 * Bottom safe area is owned by React Navigation's tab bar.
 */

import React from 'react';
import { Tabs } from 'expo-router';
import { colors } from '../../src/ui/design-system/theme';
import { useI18n } from '../../src/i18n';

export default function TabsLayout() {
  const { t } = useI18n();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.divider,
          borderTopWidth: 1,
          // Let React Navigation include the Android bottom safe-area inset.
          // A fixed height pushed labels underneath the system navigation bar.
          paddingTop: 4,
        },
        tabBarLabelStyle: {
          fontSize: 13,
          fontWeight: '500',
          letterSpacing: 0.2,
        },
      }}
    >
      <Tabs.Screen
        name="add"
        options={{
          title: t('tabs.add'),
          tabBarLabel: t('tabs.add'),
        }}
      />
      <Tabs.Screen
        name="balances"
        options={{
          title: t('tabs.balances'),
          tabBarLabel: t('tabs.balances'),
        }}
      />
      <Tabs.Screen
        name="todos"
        options={{
          title: t('tabs.todo'),
          tabBarLabel: t('tabs.todo'),
        }}
      />
    </Tabs>
  );
}
