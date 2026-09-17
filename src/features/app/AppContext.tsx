/**
 * ChoreScore V3 — App Context
 *
 * Central state management. V3 removes: billing, entitlements, premium, chrono.
 * V3 adds: local-first expo-sqlite repositories.
 * Navigation reads from local SQLite without network dependency.
 *
 * Repository readiness is consumed: sign-in and loadHouseholds wait for the
 * repository initialization promise, so an early sign-in can never skip the
 * demo fixture or permanently miss the user's groups.
 *
 * Data-change signals: screens emit lightweight events when they write data.
 * Other screens (e.g. Balances) subscribe and apply incremental deltas
 * instead of performing a full re-read + full replay on every focus.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { LocalAuthAdapter } from '../../infrastructure/local/LocalAuthAdapter';
import { LocalSystemShareAdapter } from '../../infrastructure/local/LocalSystemShareAdapter';
import { LocalNotificationAdapter } from '../../infrastructure/local/LocalNotificationAdapter';
import { LocalCalendarAdapter } from '../../infrastructure/local/LocalCalendarAdapter';
import { LocalSecureStorageAdapter } from '../../infrastructure/local/LocalSecureStorageAdapter';
import { LocalSyncAdapter } from '../../infrastructure/local/LocalSyncAdapter';
import { LocalResearchAnalyticsAdapter } from '../../infrastructure/local/LocalResearchAnalyticsAdapter';
import {
  createRepositories,
  createInMemoryRepositories,
  AllRepositories,
} from '../../infrastructure/repositories/RepositoryFactory';
import { createScopedRepositories } from '../../infrastructure/repositories/ScopedRepositoryFacade';
import { AuthUser } from '../../application/ports';
import { Household, Member } from '../../domain/entities';
import {
  ensureDemoFixture,
  loadHouseholdsForUser,
  DEMO_HOUSEHOLD_ID,
} from './demoFixture';

/** Types of data-change events that screens can emit. */
export type DataChangeType = 'contribution' | 'expense' | 'settlement' | 'household' | 'member' | 'todo';

/** Callback signature for data-change subscribers. */
export type DataChangeCallback = (type: DataChangeType, householdId: string) => void;

interface AppState {
  currentUser: AuthUser | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;

  // Household
  households: Household[];
  currentHouseholdId: string | null;
  setCurrentHouseholdId: (id: string | null) => void;
  createHousehold: (name: string) => Promise<Household>;
  loadHouseholds: (userId?: string) => Promise<void>;

  // Members
  getMembersForHousehold: (householdId: string) => Promise<Member[]>;

  // Repositories (exposed for screens)
  repos: AllRepositories;

  // Data-change signals (lightweight pub/sub for cross-tab delta refresh)
  emitDataChange: (type: DataChangeType, householdId: string) => void;
  subscribeToDataChanges: (callback: DataChangeCallback) => () => void;

  // Services
  services: {
    share: LocalSystemShareAdapter;
    notifications: LocalNotificationAdapter;
    calendar: LocalCalendarAdapter;
  };
}

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [currentHouseholdId, setCurrentHouseholdId] = useState<string | null>(null);
  const [reposReady, setReposReady] = useState(false);

  // Start with a real (in-memory) repository set so screens always receive a
  // working provider; it is replaced by the SQLite-backed set once ready.
  // No business data is written before readiness because sign-in is gated.
  const reposRef = useRef<AllRepositories>(createInMemoryRepositories());
  const reposReadyPromiseRef = useRef<Promise<void> | null>(null);

  // Initialize repositories asynchronously — SQLite on device, in-memory for tests.
  // The promise is stored so sign-in/loadHouseholds can await readiness.
  const ensureReposReady = useCallback(async () => {
    if (!reposReadyPromiseRef.current) {
      reposReadyPromiseRef.current = (async () => {
        const repos = await createRepositories();
        reposRef.current = repos;
        setReposReady(true);
      })();
    }
    await reposReadyPromiseRef.current;
  }, []);

  useEffect(() => {
    let cancelled = false;
    ensureReposReady().catch(() => {
      // createRepositories already falls back to in-memory internally; this
      // guard keeps the app usable even if that fallback itself fails.
      if (!cancelled) {
        reposRef.current = createInMemoryRepositories();
        setReposReady(true);
      }
    });
    return () => { cancelled = true; };
  }, [ensureReposReady]);

  const servicesRef = useRef({
    auth: new LocalAuthAdapter(),
    share: new LocalSystemShareAdapter(),
    notifications: new LocalNotificationAdapter(),
    calendar: new LocalCalendarAdapter(),
    secureStorage: new LocalSecureStorageAdapter(),
    sync: new LocalSyncAdapter(),
    analytics: new LocalResearchAnalyticsAdapter(),
  });

  // ── Data-change signal (pub/sub) ──────────────────────────────
  // Lightweight mechanism so screens can notify each other of writes
  // without full re-reads.  Each subscriber receives the change type
  // and the affected householdId so it can decide whether to refresh.
  const dataChangeListenersRef = useRef<Set<DataChangeCallback>>(new Set());

  const emitDataChange = useCallback((type: DataChangeType, householdId: string) => {
    for (const listener of dataChangeListenersRef.current) {
      try { listener(type, householdId); } catch { /* swallow */ }
    }
  }, []);

  const subscribeToDataChanges = useCallback((callback: DataChangeCallback): (() => void) => {
    dataChangeListenersRef.current.add(callback);
    return () => { dataChangeListenersRef.current.delete(callback); };
  }, []);

  // Auth state listener
  useEffect(() => {
    const unsubscribe = servicesRef.current.auth.onAuthStateChanged((user) => {
      setCurrentUser(user);
    });
    return unsubscribe;
  }, []);

  // The app is only "loaded" once the auth state has been emitted AND the
  // repositories are initialized, so an early sign-in can never race the
  // local store (reposReady is consumed here and by signIn/loadHouseholds).
  useEffect(() => {
    if (reposReady) {
      setIsLoading(false);
    }
  }, [reposReady]);

  const loadHouseholds = useCallback(async (userId?: string) => {
    // Gate on repository readiness so the local store is always available.
    await ensureReposReady();
    const repos = reposRef.current;
    const uid = userId ?? currentUser?.userId;
    if (!uid || !repos) return;
    const loaded = await loadHouseholdsForUser(repos, uid);
    setHouseholds(loaded);
    if (loaded.length > 0 && !currentHouseholdId) {
      setCurrentHouseholdId(loaded[0].id);
    }
  }, [currentUser, currentHouseholdId, ensureReposReady]);

  const signIn = useCallback(async (email: string, _password: string) => {
    // Gate on repository readiness: an early sign-in must not skip the fixture.
    await ensureReposReady();
    const user = await servicesRef.current.auth.signInWithEmail(email, _password);
    if (user) {
      // V3-06 REPAIR: Wrap repos with scoped facades so every read/write
      // verifies membership and ledger mutations go through validation.
      reposRef.current = createScopedRepositories(reposRef.current, user.userId);
      await ensureDemoFixture(reposRef.current, user);
      setCurrentHouseholdId(DEMO_HOUSEHOLD_ID);
      await loadHouseholds(user.userId);
    }
  }, [ensureReposReady, loadHouseholds]);

  const signOut = useCallback(async () => {
    await servicesRef.current.auth.signOut();
    setHouseholds([]);
    setCurrentHouseholdId(null);
  }, []);

  const createHousehold = useCallback(async (name: string) => {
    if (!currentUser) throw new Error('Not authenticated');
    await ensureReposReady();
    const repos = reposRef.current;
    const household = await repos.households.create({
      name,
      ownerId: currentUser.userId,
      contributionUnit: 'minutes',
      crossLedgerCompensationEnabled: false,
      contributionToMoneyRate: null,
    });
    await repos.memberships.create({
      userId: currentUser.userId,
      householdId: household.id,
      role: 'OWNER',
    });
    const user = await repos.users.getById(currentUser.userId);
    await repos.members.create({
      householdId: household.id,
      name: user?.displayName || 'Membre',
      userId: currentUser.userId,
    });
    await loadHouseholds(currentUser.userId);
    return household;
  }, [currentUser, ensureReposReady, loadHouseholds]);

  const getMembersForHousehold = useCallback(async (householdId: string) => {
    return reposRef.current.members.getByHousehold(householdId);
  }, []);

  const value: AppState = {
    currentUser,
    isLoading,
    signIn,
    signOut,
    households,
    currentHouseholdId,
    setCurrentHouseholdId,
    createHousehold,
    loadHouseholds,
    getMembersForHousehold,
    repos: reposRef.current,
    emitDataChange,
    subscribeToDataChanges,
    services: {
      share: servicesRef.current.share,
      notifications: servicesRef.current.notifications,
      calendar: servicesRef.current.calendar,
    },
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}