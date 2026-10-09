/**
 * ChoreScore V4 — Root Layout
 *
 * Expo Router root layout with the warm V2 design system, i18n and app context.
 * No premium, no chrono, no demo entry in the normal build.
 */

import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../src/features/app/AppContext';
import { I18nProvider } from '../src/i18n';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <I18nProvider>
        <AppProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerShown: false,
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="general-options" />
            <Stack.Screen name="group-options" />
            <Stack.Screen name="invite" />
            <Stack.Screen name="edit-entry" />
            <Stack.Screen name="join/[token]" />
          </Stack>
        </AppProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
