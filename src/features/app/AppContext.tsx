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
import { E2EShareAdapter } from '../../infrastructure/local/E2EShareAdapter';
import { LocalNotificationAdapter } from '../../infrastructure/local/LocalNotificationAdapter';
import { LocalCalendarAdapter } from '../../infrastructure/local/LocalCalendarAdapter';
import { LocalSecureStorageAdapter } from '../../infrastructure/local/LocalSecureStorageAdapter';
import { LocalSyncAdapter } from '../../infrastructure/local/LocalSyncAdapter';
import { LocalResearchAnalyticsAdapter } from '../../infrastructure/local/LocalResearchAnalyticsAdapter';
import { LocalAttachmentAdapter } from '../../infrastructure/local/LocalAttachmentAdapter';
import { E2EAttachmentAdapter } from '../../infrastructure/local/E2EAttachmentAdapter';
import { isE2EAuthEnabled } from '../../infrastructure/local/e2eAuthConfig';
import {
  createRepositoriesWithStatus,
  createInMemoryRepositories,
  AllRepositories,
} from '../../infrastructure/repositories/RepositoryFactory';
import { createScopedRepositories } from '../../infrastructure/repositories/ScopedRepositoryFacade';
import { AuthUser, AttachmentGateway, SystemShareGateway } from '../../application/ports';
import { Household, Member } from '../../domain/entities';
import {
  addGroupMember,
  createGroupWithMembers,
} from '../../application/use-cases/groupMembers';
import { loadHouseholdsForUser } from './demoFixture';

/** Types of data-change events that screens can emit. */
export type DataChangeType = 'contribution' | 'expense' | 'settlement' | 'household' | 'member' | 'todo';

/** Callback signature for data-change subscribers. */
export type DataChangeCallback = (type: DataChangeType, householdId: string) => void;

/** Honest social providers offered by the normal authentication UI. */
export type SocialProvider = 'google' | 'apple' | 'facebook';

interface AppState {
  currentUser: AuthUser | null;
  isLoading: boolean;
  /**
   * True when the local store could not be opened and the app runs on the
   * in-memory backend. The UI surfaces this honestly (data may not survive a
   * restart) instead of pretending persistence works.
   */
  persistenceDegraded: boolean;
  /** Kept for test seams and the deterministic local session. Not exposed in UI. */
  signIn: (email: string, password: string) => Promise<void>;
  /** Returns true when a session was established, false when the provider is not configured. */
  signInWithProvider: (provider: SocialProvider) => Promise<boolean>;
  signOut: () => Promise<void>;

  // Household
  households: Household[];
  currentHouseholdId: string | null;
  setCurrentHouseholdId: (id: string | null) => void;
  createHousehold: (name: string, memberNames?: string[]) => Promise<Household>;
  loadHouseholds: (userId?: string) => Promise<void>;

  // Members
  getMembersForHousehold: (householdId: string) => Promise<Member[]>;
  /** Add a named member to an existing group (post-creation). */
  addMember: (householdId: string, name: string) => Promise<Member>;

  // Repositories (exposed for screens — scoped to current user)
  repos: AllRepositories;

  /** Raw unscoped repos — used ONLY for invitation-authorized operations
   *  (token-based reads + membership creation during join flow). */
  rawRepos: AllRepositories;

  // Data-change signals (lightweight pub/sub for cross-tab delta refresh)
  emitDataChange: (type: DataChangeType, householdId: string) => void;
  subscribeToDataChanges: (callback: DataChangeCallback) => () => void;

  // Services
  services: {
    share: SystemShareGateway;
    notifications: LocalNotificationAdapter;
    calendar: LocalCalendarAdapter;
    /** V4-01: photo attachments behind an honest port (no provider faked). */
    attachments: AttachmentGateway;
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
  const [persistenceDegraded, setPersistenceDegraded] = useState(false);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [currentHouseholdId, setCurrentHouseholdId] = useState<string | null>(null);
  const [reposReady, setReposReady] = useState(false);

  // Start with a real (in-memory) repository set so screens always receive a
  // working provider; it is replaced by the SQLite-backed set once ready.
  // No business data is written before readiness because sign-in is gated.
  const rawReposRef = useRef<AllRepositories>(createInMemoryRepositories());
  const reposRef = useRef<AllRepositories>(rawReposRef.current);
  const reposReadyPromiseRef = useRef<Promise<void> | null>(null);

  // Initialize repositories asynchronously — SQLite on device, in-memory for tests.
  // The promise is stored so sign-in/loadHouseholds can await readiness.
  const ensureReposReady = useCallback(async () => {
    if (!reposReadyPromiseRef.current) {
      reposReadyPromiseRef.current = (async () => {
        const { repos, degraded } = await createRepositoriesWithStatus();
        rawReposRef.current = repos;
        reposRef.current = repos;
        setPersistenceDegraded(degraded);
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
        setPersistenceDegraded(true);
        setReposReady(true);
      }
    });
    return () => { cancelled = true; };
  }, [ensureReposReady]);

  const servicesRef = useRef({
    auth: new LocalAuthAdapter({ secureStorage: new LocalSecureStorageAdapter() }),
    // V4-09: the normal build uses the real native share sheet. The explicit,
    // secretless E2E build gets a deterministic adapter so the share journey
    // can be driven without a SystemUI sheet the harness cannot dismiss.
    share: isE2EAuthEnabled() ? new E2EShareAdapter(true) : new LocalSystemShareAdapter(),
    notifications: new LocalNotificationAdapter(),
    calendar: new LocalCalendarAdapter(),
    secureStorage: new LocalSecureStorageAdapter(),
    sync: new LocalSyncAdapter(),
    analytics: new LocalResearchAnalyticsAdapter(),
    // V4-01/V4-04: honest adapter in a normal build — reports unavailable
    // until a real photo provider is configured; the UI then hides the photo
    // action instead of faking a pick. The explicit, secretless E2E build gets
    // a deterministic offline source so the real photo journey can be driven.
    attachments: isE2EAuthEnabled()
      ? new E2EAttachmentAdapter(true)
      : new LocalAttachmentAdapter(),
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

  const applySignedInUser = useCallback(async (user: AuthUser) => {
    // V3-06 REPAIR: Always wrap from the RAW repos, never from an
    // already-scoped set. This prevents stale callerUserId from a
    // previous session leaking into the new session's scope.
    reposRef.current = createScopedRepositories(rawReposRef.current, user.userId);
    // A real or deterministic session must never fabricate household data.
    // New users land on an empty Groups screen and create their own group,
    // including the member names, through the normal creation flow.
    setCurrentHouseholdId(null);
    await loadHouseholds(user.userId);
  }, [loadHouseholds]);

  // Keep the latest session-activation callback reachable from the one-shot
  // restore effect without making that effect re-run on every render.
  const applySignedInUserRef = useRef(applySignedInUser);
  useEffect(() => {
    applySignedInUserRef.current = applySignedInUser;
  }, [applySignedInUser]);

  // V4-03: restore a persisted session on launch. A normal build (honest
  // adapters) returns null, so the sign-in screen stays; the explicit E2E build
  // gets its deterministic secretless session and lands directly on Groups.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureReposReady();
      const token = await servicesRef.current.auth.restoreSession().catch(() => null);
      if (cancelled || !token) return;
      const user = servicesRef.current.auth.getCurrentUser();
      if (user) {
        await applySignedInUserRef.current(user);
      }
    })().catch(() => {
      // A failed restore must never block the app: the sign-in screen remains.
    });
    return () => { cancelled = true; };
  }, [ensureReposReady]);

  const signIn = useCallback(async (email: string, _password: string) => {
    // Gate on repository readiness: an early sign-in must not skip the fixture.
    await ensureReposReady();
    const user = await servicesRef.current.auth.signInWithEmail(email, _password);
    if (user) {
      await applySignedInUser(user);
    }
  }, [ensureReposReady, applySignedInUser]);

  const signInWithProvider = useCallback(async (provider: SocialProvider) => {
    await ensureReposReady();
    const gateway = servicesRef.current.auth;
    const user =
      provider === 'google'
        ? await gateway.signInWithGoogle()
        : provider === 'apple'
          ? await gateway.signInWithApple()
          : await gateway.signInWithFacebook();
    if (user) {
      await applySignedInUser(user);
      return true;
    }
    return false;
  }, [ensureReposReady, applySignedInUser]);

  const signOut = useCallback(async () => {
    await servicesRef.current.auth.signOut();
    // V3-06 REPAIR: Reset scoped repos to raw repos so the next signIn
    // wraps from the unscoped set, not from the previous user's scoped set.
    reposRef.current = rawReposRef.current;
    setHouseholds([]);
    setCurrentHouseholdId(null);
  }, []);

  const createHousehold = useCallback(async (name: string, memberNames: string[] = []) => {
    if (!currentUser) throw new Error('Not authenticated');
    await ensureReposReady();
    const result = await createGroupWithMembers(reposRef.current, {
      name,
      owner: { userId: currentUser.userId, displayName: currentUser.displayName || 'Membre' },
      memberNames,
    });
    emitDataChange('household', result.household.id);
    emitDataChange('member', result.household.id);
    await loadHouseholds(currentUser.userId);
    return result.household;
  }, [currentUser, ensureReposReady, loadHouseholds, emitDataChange]);

  const getMembersForHousehold = useCallback(async (householdId: string) => {
    return reposRef.current.members.getByHousehold(householdId);
  }, []);

  const addMember = useCallback(async (householdId: string, name: string) => {
    await ensureReposReady();
    const member = await addGroupMember(reposRef.current, householdId, name);
    emitDataChange('member', householdId);
    return member;
  }, [ensureReposReady, emitDataChange]);

  const value: AppState = {
    currentUser,
    isLoading,
    persistenceDegraded,
    signIn,
    signInWithProvider,
    signOut,
    households,
    currentHouseholdId,
    setCurrentHouseholdId,
    createHousehold,
    loadHouseholds,
    getMembersForHousehold,
    addMember,
    repos: reposRef.current,
    rawRepos: rawReposRef.current,
    emitDataChange,
    subscribeToDataChanges,
    services: {
      share: servicesRef.current.share,
      notifications: servicesRef.current.notifications,
      calendar: servicesRef.current.calendar,
      attachments: servicesRef.current.attachments,
    },
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}