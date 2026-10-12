/** ChoreScore local-first authentication. A user can use the app entirely offline. */

import { AuthGateway, AuthSessionToken, AuthUser } from '../../application/ports';
import { SecureStorageGateway } from '../../application/ports';
import {
  E2E_AUTH_SESSION,
  authUserFromSession,
  isE2EAuthEnabled,
} from './e2eAuthConfig';

const SESSION_STORAGE_KEY = 'chorescore.auth.session';

const LOCAL_USER: AuthUser = {
  userId: 'chorescore-local-owner',
  email: '',
  displayName: 'Moi',
  provider: 'local',
};

const LOCAL_SESSION: AuthSessionToken = {
  userId: LOCAL_USER.userId,
  accessToken: 'device-local-session',
  expiresAt: '2999-12-31T00:00:00.000Z',
  provider: 'local',
  displayName: LOCAL_USER.displayName,
  email: LOCAL_USER.email,
};

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

  // Offline single-device account. No OAuth keys or network are required.
  async signInWithEmail(_email: string, _password: string): Promise<AuthUser | null> {
    await this.activateLocalSession();
    return this.currentUser;
  }

  private async activateLocalSession(): Promise<AuthSessionToken> {
    this.applySession(LOCAL_SESSION);
    await this.persistSession(LOCAL_SESSION);
    return LOCAL_SESSION;
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
    if (this.e2eEnabled) {
      this.applySession(E2E_AUTH_SESSION);
      return E2E_AUTH_SESSION;
    }

    // Preserve the same on-device user and its SQLite data across restarts.
    if (this.secureStorage) {
      try {
        const raw = await this.secureStorage.getItem(SESSION_STORAGE_KEY);
        if (raw) {
          const token = JSON.parse(raw) as AuthSessionToken;
          if (token?.userId && (!token.expiresAt || new Date(token.expiresAt).getTime() > Date.now())) {
            this.applySession(token);
            return token;
          }
        }
      } catch {
        // A failed secure-store read never prevents offline use.
      }
    }
    return this.activateLocalSession();
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
