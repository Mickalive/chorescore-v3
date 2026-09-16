/**
 * ChoreScore V3 — Local Auth Adapter
 *
 * Demo/local authentication. No real providers configured.
 * Honest about what is available.
 */

import { AuthGateway, AuthUser, AuthSessionToken } from '../../application/ports';

const DEMO_USER: AuthUser = {
  userId: 'demo-user-alex',
  email: 'demo@chorescore.app',
  displayName: 'Alex',
  provider: 'local',
};

export class LocalAuthAdapter implements AuthGateway {
  private currentUser: AuthUser | null = null;
  private listeners: Array<(user: AuthUser | null) => void> = [];

  isAvailable(): boolean {
    return true;
  }

  getCurrentUserId(): string | null {
    return this.currentUser?.userId ?? null;
  }

  getCurrentUser(): AuthUser | null {
    return this.currentUser;
  }

  async signInWithEmail(_email: string, _password: string): Promise<AuthUser | null> {
    // Local demo: always return demo user
    this.currentUser = DEMO_USER;
    this.notifyListeners();
    return DEMO_USER;
  }

  async signInWithGoogle(): Promise<AuthUser | null> {
    // Not configured — honest adapter
    return null;
  }

  async signInWithFacebook(): Promise<AuthUser | null> {
    // Not configured — honest adapter
    return null;
  }

  async signOut(): Promise<void> {
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

  async persistSession(_token: AuthSessionToken): Promise<void> {
    // Local demo: no-op
  }

  async restoreSession(): Promise<AuthSessionToken | null> {
    return null;
  }

  async clearSession(): Promise<void> {
    // Local demo: no-op
  }

  /** Set user directly for demo purposes */
  setUser(user: AuthUser | null): void {
    this.currentUser = user;
    this.notifyListeners();
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.currentUser);
    }
  }
}
