/**
 * ChoreScore V3 — App Context
 *
 * Central state management. V3 removes: billing, entitlements, premium, chrono.
 * V3 adds: local-first expo-sqlite repositories.
 * Navigation reads from local SQLite without network dependency.
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
  InMemoryUserRepository,
  InMemoryMembershipRepository,
  InMemoryHouseholdRepository,
  InMemoryMemberRepository,
  InMemoryContributionEntryRepository,
  InMemoryPersistentTaskRepository,
  InMemoryTodoRepository,
  InMemoryExpenseEntryRepository,
  InMemorySettlementRepository,
} from '../../infrastructure/repositories/InMemoryRepositories';
import { AuthUser } from '../../application/ports';
import {
  Household,
  Member,
  ContributionUnit,
} from '../../domain/entities';

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
  loadHouseholds: () => Promise<void>;

  // Members
  getMembersForHousehold: (householdId: string) => Promise<Member[]>;

  // Repositories (exposed for screens)
  repos: {
    contributions: InMemoryContributionEntryRepository;
    tasks: InMemoryPersistentTaskRepository;
    todos: InMemoryTodoRepository;
    expenses: InMemoryExpenseEntryRepository;
    settlements: InMemorySettlementRepository;
    members: InMemoryMemberRepository;
  };

  // Services
  services: {
    share: LocalSystemShareAdapter;
  };
}

const AppContext = createContext<AppState | null>(null);

const DEMO_HOUSEHOLD_ID = 'h-core';
const DEMO_ALEX_MEMBER_ID = 'm-alex';
const DEMO_SAM_MEMBER_ID = 'm-sam';
const DEMO_SAM_USER_ID = 'demo-user-sam';

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

  // Create stable repository instances
  const reposRef = useRef({
    users: new InMemoryUserRepository(),
    memberships: new InMemoryMembershipRepository(),
    households: new InMemoryHouseholdRepository(),
    members: new InMemoryMemberRepository(),
    contributions: new InMemoryContributionEntryRepository(),
    tasks: new InMemoryPersistentTaskRepository(),
    todos: new InMemoryTodoRepository(),
    expenses: new InMemoryExpenseEntryRepository(),
    settlements: new InMemorySettlementRepository(),
  });

  const servicesRef = useRef({
    auth: new LocalAuthAdapter(),
    share: new LocalSystemShareAdapter(),
    notifications: new LocalNotificationAdapter(),
    calendar: new LocalCalendarAdapter(),
    secureStorage: new LocalSecureStorageAdapter(),
    sync: new LocalSyncAdapter(),
    analytics: new LocalResearchAnalyticsAdapter(),
  });

  // Seed the canonical demo fixture
  const ensureDemoFixture = useCallback(async (demoUser: AuthUser) => {
    const repos = reposRef.current;
    const nowIso = new Date().toISOString();

    if (!(await repos.users.getById(demoUser.userId))) {
      repos.users.seed([{
        id: demoUser.userId,
        email: demoUser.email,
        displayName: 'Alex',
        createdAt: nowIso,
      }]);
    }
    if (!(await repos.users.getById(DEMO_SAM_USER_ID))) {
      repos.users.seed([{
        id: DEMO_SAM_USER_ID,
        email: 'sam.demo@chorescore.app',
        displayName: 'Sam',
        createdAt: nowIso,
      }]);
    }

    if (!(await repos.households.getById(DEMO_HOUSEHOLD_ID))) {
      repos.households.seed([{
        id: DEMO_HOUSEHOLD_ID,
        name: 'Appartement',
        ownerId: demoUser.userId,
        contributionUnit: 'minutes',
        crossLedgerCompensationEnabled: false,
        contributionToMoneyRate: null,
        createdAt: nowIso,
      }]);
    }

    if (!(await repos.memberships.getByUserAndHousehold(demoUser.userId, DEMO_HOUSEHOLD_ID))) {
      repos.memberships.seed([{
        id: 'membership-demo-alex',
        userId: demoUser.userId,
        householdId: DEMO_HOUSEHOLD_ID,
        role: 'OWNER',
        joinedAt: nowIso,
      }]);
    }
    if (!(await repos.memberships.getByUserAndHousehold(DEMO_SAM_USER_ID, DEMO_HOUSEHOLD_ID))) {
      repos.memberships.seed([{
        id: 'membership-demo-sam',
        userId: DEMO_SAM_USER_ID,
        householdId: DEMO_HOUSEHOLD_ID,
        role: 'MEMBER',
        joinedAt: nowIso,
      }]);
    }

    const existingMembers = await repos.members.getByHousehold(DEMO_HOUSEHOLD_ID);
    if (!existingMembers.some((m) => m.id === DEMO_ALEX_MEMBER_ID)) {
      repos.members.seed([{
        id: DEMO_ALEX_MEMBER_ID,
        householdId: DEMO_HOUSEHOLD_ID,
        name: 'Alex',
        userId: demoUser.userId,
        joinedAt: nowIso,
      }]);
    }
    if (!existingMembers.some((m) => m.id === DEMO_SAM_MEMBER_ID)) {
      repos.members.seed([{
        id: DEMO_SAM_MEMBER_ID,
        householdId: DEMO_HOUSEHOLD_ID,
        name: 'Sam',
        userId: DEMO_SAM_USER_ID,
        joinedAt: nowIso,
      }]);
    }

    const tasks = await repos.tasks.getByHousehold(DEMO_HOUSEHOLD_ID);
    let dishesTask = tasks.find((t) => t.name === 'Vaisselle');
    if (!dishesTask) {
      dishesTask = await repos.tasks.create({
        householdId: DEMO_HOUSEHOLD_ID,
        name: 'Vaisselle',
        defaultValue: 15,
        defaultUnit: 'minutes',
      });
    }

    const entries = await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID);
    if (!entries.some((e) => e.label === 'Vaisselle du soir')) {
      await repos.contributions.create({
        householdId: DEMO_HOUSEHOLD_ID,
        label: 'Vaisselle du soir',
        performedByMemberId: DEMO_ALEX_MEMBER_ID,
        beneficiaryMemberIds: [DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID],
        value: 15,
        unit: 'minutes',
        persistentTaskId: dishesTask.id,
        occurredAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        createdBy: demoUser.userId,
      });
    }
    if (!entries.some((e) => e.label === 'Courses')) {
      await repos.contributions.create({
        householdId: DEMO_HOUSEHOLD_ID,
        label: 'Courses Migros',
        performedByMemberId: DEMO_SAM_MEMBER_ID,
        beneficiaryMemberIds: [DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID],
        value: 45,
        unit: 'minutes',
        persistentTaskId: null,
        occurredAt: new Date(Date.now() - 1 * 86400000).toISOString(),
        createdBy: DEMO_SAM_USER_ID,
      });
    }

    const todos = await repos.todos.getByHousehold(DEMO_HOUSEHOLD_ID);
    if (!todos.some((t) => t.title === 'Sortir les poubelles')) {
      await repos.todos.create({
        householdId: DEMO_HOUSEHOLD_ID,
        title: 'Sortir les poubelles',
        assigneeMemberId: DEMO_SAM_MEMBER_ID,
        beneficiaryMemberIds: [DEMO_ALEX_MEMBER_ID, DEMO_SAM_MEMBER_ID],
        dueAt: null,
        reminderAt: null,
        notes: '',
        persistentTaskId: null,
        status: 'todo',
      });
    }
  }, []);

  // Auth state listener
  useEffect(() => {
    const unsubscribe = servicesRef.current.auth.onAuthStateChanged((user) => {
      setCurrentUser(user);
      setIsLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = useCallback(async (email: string, _password: string) => {
    const user = await servicesRef.current.auth.signInWithEmail(email, _password);
    if (user) {
      await ensureDemoFixture(user);
      setCurrentHouseholdId(DEMO_HOUSEHOLD_ID);
    }
  }, [ensureDemoFixture]);

  const signOut = useCallback(async () => {
    await servicesRef.current.auth.signOut();
    setHouseholds([]);
    setCurrentHouseholdId(null);
  }, []);

  const loadHouseholds = useCallback(async () => {
    if (!currentUser) return;
    const memberships = await reposRef.current.memberships.getByUser(currentUser.userId);
    const loaded: Household[] = [];
    for (const m of memberships) {
      const h = await reposRef.current.households.getById(m.householdId);
      if (h) loaded.push(h);
    }
    setHouseholds(loaded);
    if (loaded.length > 0 && !currentHouseholdId) {
      setCurrentHouseholdId(loaded[0].id);
    }
  }, [currentUser, currentHouseholdId]);

  const createHousehold = useCallback(async (name: string) => {
    if (!currentUser) throw new Error('Not authenticated');
    const household = await reposRef.current.households.create({
      name,
      ownerId: currentUser.userId,
      contributionUnit: 'minutes',
      crossLedgerCompensationEnabled: false,
      contributionToMoneyRate: null,
    });
    await reposRef.current.memberships.create({
      userId: currentUser.userId,
      householdId: household.id,
      role: 'OWNER',
    });
    const user = await reposRef.current.users.getById(currentUser.userId);
    await reposRef.current.members.create({
      householdId: household.id,
      name: user?.displayName || 'Membre',
      userId: currentUser.userId,
    });
    await loadHouseholds();
    return household;
  }, [currentUser, loadHouseholds]);

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
    repos: {
      contributions: reposRef.current.contributions,
      tasks: reposRef.current.tasks,
      todos: reposRef.current.todos,
      expenses: reposRef.current.expenses,
      settlements: reposRef.current.settlements,
      members: reposRef.current.members,
    },
    services: {
      share: servicesRef.current.share,
    },
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
