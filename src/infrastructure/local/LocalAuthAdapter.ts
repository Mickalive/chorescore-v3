/**
 * ChoreScore V4 — Local Auth Adapter
 *
 * Normal build: honest about what is configured. No social provider is wired
 * to a real OAuth backend here, so Google/Apple/Facebook resolve to `null` and
 * the UI reports "provider not configured". There is no demo button and no
 * email/password UI.
 *
 * Test/E2E seams (never reachable from the normal UI):
 * - `signInWithEmail` is a deterministic local seam used by the automated
 *   suite/join flow. It only activates under `NODE_ENV === 'test'` or when the
 *   explicit secretless E2E flag is set.
 * - `restoreSession` returns the persisted session for a real device, or the
 *   deterministic E2E session when the E2E flag is on. A normal build always
 *   returns `null`, so no phantom session is ever injected.
 */

import { AuthGateway, AuthSessionToken, AuthUser } from '../../application/ports';
import { SecureStorageGateway } from '../../application/ports';
import {
  E2E_AUTH_SESSION,
  authUserFromSession,
  isE2EAuthEnabled,
} from './e2eAuthConfig';

const SESSION_STORAGE_KEY = 'chorescore.auth.session';

const DEMO_USER: AuthUser = {
  userId: 'demo-user-alex',
  email: 'demo@chorescore.app',
  displayName: 'Alex',
  provider: 'local',
};

type EnvLike = Record<string, string | undefined>;

function readProcessEnv(): EnvLike {
  const globalProcess = (globalThis as { process?: { env?: EnvLike } }).process;
  return globalProcess?.env ?? {};
}

/** The email sign-in method is a test seam; it must not work in shipped builds. */
function isEmailSeamEnabled(env: EnvLike = readProcessEnv()): boolean {
  return env.NODE_ENV === 'test';
}

export interface LocalAuthAdapterOptions {
  /** Explicit E2E flag; defaults to the `EXPO_PUBLIC_E2E_AUTH` environment. */
  e2e?: boolean;
  /** Local secure store used to persist the session across launches. */
  secureStorage?: SecureStorageGateway | null;
}

export class LocalAuthAdapter implements AuthGateway {
  private currentUser: AuthUser | null = null;
  private listeners: Array<(user: AuthUser | null) => void> = [];
  private readonly e2eEnabled: boolean;
  private readonly secureStorage: SecureStorageGateway | null;

  constructor(options: LocalAuthAdapterOptions = {}) {
    this.e2eEnabled = options.e2e ?? isE2EAuthEnabled();
    this.secureStorage = options.secureStorage ?? null;
  }

  isAvailable(): boolean {
    return true;
  }

  getCurrentUserId(): string | null {
    return this.currentUser?.userId ?? null;
  }

  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }

  async signInWithEmail(email: string, _password: string): Promise<AuthUser | null> {
    // Deterministic local seam for the automated suite. A shipped build has
    // NODE_ENV !== 'test' (and no E2E flag), so this returns null and the app
    // keeps showing only the honest social-provider options.
    if (!isEmailSeamEnabled() && !this.e2eEnabled) {
      return null;
    }
    const user: AuthUser = {
      ...DEMO_USER,
      email: email?.trim() || DEMO_USER.email,
    };
    this.setUser(user);
    await this.persistSession({
      userId: user.userId,
      accessToken: 'local-test-session',
      expiresAt: '2999-12-31T00:00:00.000Z',
      provider: 'email',
      displayName: user.displayName,
      email: user.email,
    });
    return user;
  }

  async signInWithGoogle(): Promise<AuthUser | null> {
    // Not configured — honest adapter, no fake OAuth.
    return null;
  }

  async signInWithApple(): Promise<AuthUser | null> {
    // Not configured — honest adapter, no fake OAuth.
    return null;
  }

  async signInWithFacebook(): Promise<AuthUser | null> {
    // Not configured — honest adapter, no fake OAuth.
    return null;
  }

  async signOut(): Promise<void> {
    await this.clearSession();
    this.currentUser = null;
    this.notifyListeners();
  }

  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void {
    this.listeners.push(callback);
    // Emit current state immediately
    callback(this.currentUser);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  async persistSession(token: AuthSessionToken): Promise<void> {
    if (!this.secureStorage) return;
    try {
      await this.secureStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(token));
    } catch {
      // A storage failure must never break sign-in; the session simply is not
      // persisted and the next launch asks the provider again.
    }
  }

  async restoreSession(): Promise<AuthSessionToken | null> {
    // Deterministic secretless E2E session: only when the explicit flag is set
    // at build time. A normal build can never take this branch.
    if (this.e2eEnabled) {
      this.applySession(E2E_AUTH_SESSION);
      return E2E_AUTH_SESSION;
    }

    if (!this.secureStorage) return null;

    let raw: string | null = null;
    try {
      raw = await this.secureStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;

    try {
      const token = JSON.parse(raw) as AuthSessionToken;
      if (!token?.userId) return null;
      if (token.expiresAt && new Date(token.expiresAt).getTime() < Date.now()) {
        await this.clearSession();
        return null;
      }
      this.applySession(token);
      return token;
    } catch {
      return null;
    }
  }

  async clearSession(): Promise<void> {
    if (!this.secureStorage) return;
    try {
      await this.secureStorage.deleteItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore: best-effort cleanup.
    }
  }

  /** Set user directly for tests / deterministic fixtures. */
  setUser(user: AuthUser | null): void {
    this.currentUser = user;
    this.notifyListeners();
  }

  private applySession(token: AuthSessionToken): void {
    this.currentUser = authUserFromSession(token);
    this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.currentUser);
    }
  }
}
