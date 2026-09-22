/**
 * ChoreScore V3 — Tabs Layout
 *
 * Three exact tabs: Ajouter, Balances, A faire.
 * V3 metallic/graphite design system. No warm V2 aesthetic.
 */

import React from 'react';
import { Tabs } from 'expo-router';
import { colors } from '../../src/ui/design-system/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
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
          title: 'Ajouter',
          tabBarLabel: 'Ajouter',
        }}
      />
      <Tabs.Screen
        name="balances"
        options={{
          title: 'Balances',
          tabBarLabel: 'Balances',
        }}
      />
      <Tabs.Screen
        name="todos"
        options={{
          title: 'A faire',
          tabBarLabel: 'A faire',
        }}
      />
    </Tabs>
  );
}
