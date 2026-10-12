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
        // V4-08: hide the tab bar while the keyboard is open so the form
        // keeps its full height on small screens.
        tabBarHideOnKeyboard: true,
        // V4-08: the scene background matches the warm cream canvas so no
        // white flash appears between tab transitions.
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="add"
        options={{
          title: t('tabs.add'),
          tabBarLabel: t('tabs.add'),
          tabBarAccessibilityLabel: t('tabs.add'),
        }}
      />
      <Tabs.Screen
        name="balances"
        options={{
          title: t('tabs.balances'),
          tabBarLabel: t('tabs.balances'),
          tabBarAccessibilityLabel: t('tabs.balances'),
        }}
      />
      <Tabs.Screen
        name="todos"
        options={{
          title: t('tabs.todo'),
          tabBarLabel: t('tabs.todo'),
          tabBarAccessibilityLabel: t('tabs.todo'),
        }}
      />
    </Tabs>
  );
}
