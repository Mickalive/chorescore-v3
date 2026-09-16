/**
 * V3-02 — Ports/adapters tests
 *
 * Validates that:
 * - V3 ports have no Premium/billing/chrono references
 * - Local adapters are honest about availability
 * - Domain stays provider-agnostic
 */

import { LocalAuthAdapter } from '../../src/infrastructure/local/LocalAuthAdapter';
import { LocalSystemShareAdapter } from '../../src/infrastructure/local/LocalSystemShareAdapter';
import { LocalNotificationAdapter } from '../../src/infrastructure/local/LocalNotificationAdapter';
import { LocalCalendarAdapter } from '../../src/infrastructure/local/LocalCalendarAdapter';
import { LocalSyncAdapter } from '../../src/infrastructure/local/LocalSyncAdapter';
import { LocalResearchAnalyticsAdapter } from '../../src/infrastructure/local/LocalResearchAnalyticsAdapter';

describe('V3-02 ports/adapters', () => {
  test('auth adapter is available and provides demo sign-in', async () => {
    const auth = new LocalAuthAdapter();
    expect(auth.isAvailable()).toBe(true);

    const user = await auth.signInWithEmail('demo@chorescore.app', 'test');
    expect(user).not.toBeNull();
    expect(user?.userId).toBeTruthy();
    expect(user?.email).toBe('demo@chorescore.app');
  });

  test('auth adapter notifies on state changes', async () => {
    const auth = new LocalAuthAdapter();
    const states: any[] = [];

    const unsub = auth.onAuthStateChanged((user) => {
      states.push(user);
    });

    await auth.signInWithEmail('test@test.com', 'pass');
    await auth.signOut();

    unsub();

    // Should have received: null (initial), user (signed in), null (signed out)
    expect(states.length).toBeGreaterThanOrEqual(3);
    expect(states[0]).toBeNull();
    expect(states[1]).not.toBeNull();
    expect(states[2]).toBeNull();
  });

  test('share adapter is available', () => {
    const share = new LocalSystemShareAdapter();
    expect(share.isAvailable()).toBe(true);
  });

  test('notification adapter is honest about not being configured', () => {
    const notifications = new LocalNotificationAdapter();
    expect(notifications.isAvailable()).toBe(false);
  });

  test('calendar adapter is honest about not being configured', () => {
    const calendar = new LocalCalendarAdapter();
    expect(calendar.isAvailable()).toBe(false);
  });

  test('sync adapter is honest about not being configured', async () => {
    const sync = new LocalSyncAdapter();
    expect(sync.isAvailable()).toBe(false);

    const status = await sync.getStatus('h-1');
    expect(status.isSyncing).toBe(false);
    expect(status.pendingChanges).toBe(0);
  });

  test('analytics adapter is disabled by default', () => {
    const analytics = new LocalResearchAnalyticsAdapter();
    expect(analytics.isEnabled()).toBe(false);
    expect(analytics.isAvailable()).toBe(false);

    // Enabling should not throw
    analytics.setEnabled(true);
    expect(analytics.isEnabled()).toBe(true);

    // Disabling should not throw
    analytics.setEnabled(false);
    expect(analytics.isEnabled()).toBe(false);
  });

  test('V3 ports file has no billing/entitlement/premium/chrono references', async () => {
    // Read the ports file and verify it doesn't contain V2-only concepts
    const fs = require('fs');
    const path = require('path');
    const portsPath = path.resolve(__dirname, '../../src/application/ports/index.ts');
    const content = fs.readFileSync(portsPath, 'utf-8');

    // These should NOT appear in V3 ports
    expect(content).not.toContain('BillingGateway');
    expect(content).not.toContain('EntitlementGateway');
    expect(content).not.toContain('EntitlementState');
    expect(content).not.toContain('EntitlementFeature');
    expect(content).not.toContain('SubscriptionStatus');
    expect(content).not.toContain('PurchaseResult');
    expect(content).not.toContain('TrialStatus');
    expect(content).not.toContain('ChronoTimerRepository');
    expect(content).not.toContain('canCreateAdditionalOwnedHousehold');
    expect(content).not.toContain('memberLimit');
  });
});
