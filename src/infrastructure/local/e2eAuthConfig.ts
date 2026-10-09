/**
 * ChoreScore V4 — E2E deterministic session configuration (secretless)
 *
 * The automated Android/iOS end-to-end harness must reach the app's real
 * screens without a human tapping a provider sheet and without shipping any
 * OAuth secret. This module is the single, explicit gate for the deterministic
 * local session used by that harness.
 *
 * Honest rules:
 * - It is enabled ONLY when `EXPO_PUBLIC_E2E_AUTH=1` is present at bundle time.
 *   A normal/dev/production build never sets it, so normal users always see the
 *   honest social-provider screen and no session is fabricated.
 * - It carries no secret: no token from Google/Apple/Facebook, no email/password.
 * - The normal UI never references this module; nothing about it is visible.
 */

import { AuthSessionToken, AuthUser } from '../../application/ports';

export const E2E_AUTH_ENV_VAR = 'EXPO_PUBLIC_E2E_AUTH';
export const E2E_AUTH_ENV_VALUE = '1';

type EnvLike = Record<string, string | undefined>;

function readProcessEnv(): EnvLike {
  const globalProcess = (globalThis as { process?: { env?: EnvLike } }).process;
  return globalProcess?.env ?? {};
}

/**
 * True only for the explicit E2E build flag. Never inferred from `__DEV__` or
 * `NODE_ENV`, so a normal build can never inject a phantom session.
 */
export function isE2EAuthEnabled(env: EnvLike = readProcessEnv()): boolean {
  return env[E2E_AUTH_ENV_VAR] === E2E_AUTH_ENV_VALUE;
}

export const E2E_AUTH_USER: AuthUser = {
  userId: 'e2e-local-user',
  email: 'e2e@chorescore.local',
  displayName: 'E2E',
  provider: 'local',
};

/**
 * Deterministic, non-expiring local session. It is not a credential for any
 * remote service; it only lets the local-first app open the real screens.
 */
export const E2E_AUTH_SESSION: AuthSessionToken = {
  userId: E2E_AUTH_USER.userId,
  accessToken: 'e2e-local-session',
  expiresAt: '2999-12-31T00:00:00.000Z',
  provider: 'local',
  displayName: E2E_AUTH_USER.displayName,
  email: E2E_AUTH_USER.email,
};

/** Rebuild the in-memory user from a persisted/restored session token. */
export function authUserFromSession(token: AuthSessionToken): AuthUser {
  return {
    userId: token.userId,
    email: token.email ?? '',
    displayName: token.displayName ?? token.email ?? 'Membre',
    provider: token.provider,
  };
}
