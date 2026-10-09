/**
 * V4-03 — Auth sociale, session, groupes et membres
 *
 * Evidence for the V4-03 acceptance list:
 *   - aucun bouton Démo/email-password normal   (source scan of app/)
 *   - auth adapters honnêtes                    (social → null, no fake OAuth)
 *   - mode E2E secretless invisible             (explicit flag only)
 *   - session persistée vers Groupes            (secure-store round-trip)
 *   - création groupe avec plusieurs membres
 *   - member count visible                      (groups root)
 *   - aucun bouton Inviter sur carte groupe
 *   - ajout membre post-création
 *   - lien invitation + native share
 */

import fs from 'fs';
import path from 'path';

import { LocalAuthAdapter } from '../../src/infrastructure/local/LocalAuthAdapter';
import { LocalSystemShareAdapter } from '../../src/infrastructure/local/LocalSystemShareAdapter';
import {
  E2E_AUTH_ENV_VAR,
  E2E_AUTH_SESSION,
  E2E_AUTH_USER,
  isE2EAuthEnabled,
} from '../../src/infrastructure/local/e2eAuthConfig';
import { AuthSessionToken, SecureStorageGateway } from '../../src/application/ports';
import { createInMemoryRepositories } from '../../src/infrastructure/repositories/RepositoryFactory';
import {
  MEMBER_NAME_MAX_LENGTH,
  addGroupMember,
  buildNamedMembers,
  createGroupWithMembers,
  normalizeMemberName,
} from '../../src/application/use-cases/groupMembers';
import { Household, memberIdentityKind } from '../../src/domain/entities';
import {
  createInvitation,
  validateCreateInvitation,
} from '../../src/domain/services/invitationService';

const ROOT = path.resolve(__dirname, '../..');

class FakeSecureStorage implements SecureStorageGateway {
  store = new Map<string, string>();

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async getItem(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async deleteItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

/** Remove comments so a source scan only inspects actual UI code. */
function nonCommentLines(source: string): string {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !(
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/*')
      );
    })
    .join('\n');
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function appSources(): { rel: string; code: string }[] {
  return walk(path.join(ROOT, 'app')).map((file) => ({
    rel: path.relative(ROOT, file),
    code: nonCommentLines(fs.readFileSync(file, 'utf8')),
  }));
}

function household(overrides: Partial<Household> = {}): Household {
  return {
    id: 'h-v4-03',
    name: 'Colocation',
    ownerId: 'user-owner',
    contributionUnit: 'minutes',
    crossLedgerCompensationEnabled: false,
    contributionToMoneyRate: null,
    createdAt: '2026-10-09T00:00:00.000Z',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// Honest auth adapters
// ─────────────────────────────────────────────────────────────

describe('V4-03 Auth adapters — honest, no fake OAuth', () => {
  test('social providers are unconfigured and resolve null', async () => {
    const auth = new LocalAuthAdapter({ e2e: false, secureStorage: null });

    await expect(auth.signInWithGoogle()).resolves.toBeNull();
    await expect(auth.signInWithApple()).resolves.toBeNull();
    await expect(auth.signInWithFacebook()).resolves.toBeNull();
    expect(auth.getCurrentUser()).toBeNull();
  });

  test('the email/password seam is disabled in a normal (non-test) build', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const auth = new LocalAuthAdapter({ e2e: false, secureStorage: null });
      await expect(auth.signInWithEmail('user@example.com', 'secret')).resolves.toBeNull();
      expect(auth.getCurrentUser()).toBeNull();
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  test('the normal UI exposes no demo / email-password entry', () => {
    for (const { rel, code } of appSources()) {
      expect({ rel, matches: /\bdemo\b/i.test(code) }).toEqual({ rel, matches: false });
      expect(code).not.toContain('signInWithEmail');
      expect(code).not.toMatch(/email-address|password/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Secretless E2E session, invisible in normal builds
// ─────────────────────────────────────────────────────────────

describe('V4-03 E2E session — secretless and invisible', () => {
  test('the gate is off unless the explicit E2E flag is set', () => {
    expect(isE2EAuthEnabled({})).toBe(false);
    expect(isE2EAuthEnabled({ [E2E_AUTH_ENV_VAR]: '0' })).toBe(false);
    expect(isE2EAuthEnabled({ [E2E_AUTH_ENV_VAR]: '1' })).toBe(true);
  });

  test('the deterministic session carries no provider secret', () => {
    expect(E2E_AUTH_SESSION.userId).toBe(E2E_AUTH_USER.userId);
    expect(E2E_AUTH_SESSION.provider).toBe('local');
    expect(JSON.stringify(E2E_AUTH_SESSION)).not.toMatch(
      /google|apple|facebook|password|secret|token=/i,
    );
    expect(Object.keys(E2E_AUTH_SESSION)).not.toContain('password');
  });

  test('an E2E adapter restores a session with no input; a normal adapter does not', async () => {
    const e2e = new LocalAuthAdapter({ e2e: true, secureStorage: new FakeSecureStorage() });
    await expect(e2e.restoreSession()).resolves.toEqual(E2E_AUTH_SESSION);
    expect(e2e.getCurrentUser()).toEqual(E2E_AUTH_USER);

    const normal = new LocalAuthAdapter({ e2e: false, secureStorage: new FakeSecureStorage() });
    await expect(normal.restoreSession()).resolves.toBeNull();
    expect(normal.getCurrentUser()).toBeNull();
  });

  test('the normal UI never references the E2E auth module', () => {
    for (const { rel, code } of appSources()) {
      expect({ rel, references: /E2E|EXPO_PUBLIC_E2E|e2eAuthConfig/.test(code) }).toEqual({
        rel,
        references: false,
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Persisted session → direct arrival on Groups
// ─────────────────────────────────────────────────────────────

describe('V4-03 Session persistence', () => {
  test('a signed-in session is persisted and restored on the next launch', async () => {
    const storage = new FakeSecureStorage();
    const first = new LocalAuthAdapter({ e2e: false, secureStorage: storage });
    const user = await first.signInWithEmail('alex@example.com', 'ignored');
    expect(user).not.toBeNull();
    expect(storage.store.size).toBe(1);

    // A fresh adapter (cold launch) restores the exact same user.
    const second = new LocalAuthAdapter({ e2e: false, secureStorage: storage });
    expect(second.getCurrentUser()).toBeNull();
    const restored = await second.restoreSession();
    expect(restored?.userId).toBe(user?.userId);
    expect(second.getCurrentUser()?.email).toBe('alex@example.com');
    expect(second.getCurrentUserId()).toBe(user?.userId);
  });

  test('signing out clears the persisted session', async () => {
    const storage = new FakeSecureStorage();
    const auth = new LocalAuthAdapter({ e2e: false, secureStorage: storage });
    await auth.signInWithEmail('alex@example.com', 'x');
    await auth.signOut();

    expect(storage.store.size).toBe(0);
    const next = new LocalAuthAdapter({ e2e: false, secureStorage: storage });
    await expect(next.restoreSession()).resolves.toBeNull();
  });

  test('an expired persisted token is discarded, not restored', async () => {
    const storage = new FakeSecureStorage();
    const expired: AuthSessionToken = {
      userId: 'u-1',
      accessToken: 't',
      expiresAt: '2000-01-01T00:00:00.000Z',
      provider: 'local',
    };
    await storage.setItem('chorescore.auth.session', JSON.stringify(expired));

    const auth = new LocalAuthAdapter({ e2e: false, secureStorage: storage });
    await expect(auth.restoreSession()).resolves.toBeNull();
    expect(storage.store.size).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// Group creation with several named members
// ─────────────────────────────────────────────────────────────

describe('V4-03 Group creation — several named members', () => {
  test('creates the group, the owner and every named member', async () => {
    const repos = createInMemoryRepositories();
    const result = await createGroupWithMembers(repos, {
      name: '  Colocation  ',
      owner: { userId: 'user-owner', displayName: 'Alex' },
      memberNames: ['Marie', '  Sam  ', '   '],
    });

    expect(result.household.name).toBe('Colocation');
    expect(memberIdentityKind(result.ownerMember)).toBe('linked');
    expect(result.namedMembers).toHaveLength(2);
    expect(result.namedMembers.every((m) => m.userId === null)).toBe(true);
    expect(result.namedMembers.map((m) => m.name)).toEqual(['Marie', 'Sam']);

    const members = await repos.members.getByHousehold(result.household.id);
    expect(members).toHaveLength(3);

    const memberships = await repos.memberships.getByHousehold(result.household.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('OWNER');
    expect(memberships[0].userId).toBe('user-owner');
  });

  test('an invalid member name aborts creation before any write', async () => {
    const repos = createInMemoryRepositories();
    await expect(
      createGroupWithMembers(repos, {
        name: 'Groupe',
        owner: { userId: 'u', displayName: 'A' },
        memberNames: ['x'.repeat(MEMBER_NAME_MAX_LENGTH + 1)],
      }),
    ).rejects.toThrow(String(MEMBER_NAME_MAX_LENGTH));

    expect(await repos.households.getAll()).toHaveLength(0);
    expect(await repos.memberships.getByHousehold('any')).toHaveLength(0);
  });

  test('member names are normalized, blank entries skipped, long names rejected', () => {
    expect(normalizeMemberName('  Jean   Luc ')).toBe('Jean Luc');
    expect(() => normalizeMemberName('   ')).toThrow('non-empty');
    expect(() => normalizeMemberName('x'.repeat(MEMBER_NAME_MAX_LENGTH + 1))).toThrow(
      String(MEMBER_NAME_MAX_LENGTH),
    );

    expect(buildNamedMembers('h-1', [' Marie ', '', '   '])).toEqual([
      { householdId: 'h-1', name: 'Marie', userId: null },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────
// Post-creation member addition
// ─────────────────────────────────────────────────────────────

describe('V4-03 Member addition after creation', () => {
  test('a named member can be added later', async () => {
    const repos = createInMemoryRepositories();
    const { household: created } = await createGroupWithMembers(repos, {
      name: 'Groupe',
      owner: { userId: 'user-owner', displayName: 'Alex' },
      memberNames: ['Marie'],
    });

    await addGroupMember(repos, created.id, 'Nadia');

    const members = await repos.members.getByHousehold(created.id);
    expect(members).toHaveLength(3);
    const nadia = members.find((m) => m.name === 'Nadia');
    expect(nadia).toBeDefined();
    expect(nadia?.userId).toBeNull();
  });

  test('the group options screen exposes the members section and add action', () => {
    const source = nonCommentLines(
      fs.readFileSync(path.join(ROOT, 'app/group-options.tsx'), 'utf8'),
    );
    expect(source).toContain('groupOptions.members');
    expect(source).toContain('addMember');
    expect(source).toContain('groupOptions.invite');
  });
});

// ─────────────────────────────────────────────────────────────
// Groups root: member count visible, no Invite button on the card
// ─────────────────────────────────────────────────────────────

describe('V4-03 Groups root UI', () => {
  const indexSource = nonCommentLines(
    fs.readFileSync(path.join(ROOT, 'app/index.tsx'), 'utf8'),
  );

  test('the member count is visible on each group card', () => {
    expect(indexSource).toContain('groups.memberMany');
    expect(indexSource).toContain('groups.memberOne');
    expect(indexSource).toContain('getMembersForHousehold');
  });

  test('the group card has no Invite button', () => {
    expect(indexSource).not.toMatch(/invite/i);
  });

  test('multi-member creation is offered from the root', () => {
    expect(indexSource).toContain('groups.memberNamePlaceholder');
    expect(indexSource).toContain('createHousehold(newGroupName.trim(), memberNames)');
  });

  test('sign-in never seeds a demo household or demo members', () => {
    const appContext = fs.readFileSync(
      path.join(ROOT, 'src/features/app/AppContext.tsx'),
      'utf8',
    );
    expect(appContext).not.toContain('ensureDemoFixture');
    expect(appContext).not.toContain('DEMO_HOUSEHOLD_ID');
  });
});

// ─────────────────────────────────────────────────────────────
// Link-only invitation + native share
// ─────────────────────────────────────────────────────────────

describe('V4-03 Invitations — link only + native share', () => {
  const inviteSource = nonCommentLines(
    fs.readFileSync(path.join(ROOT, 'app/invite.tsx'), 'utf8'),
  );

  test('a link-only invitation is complete without an email', () => {
    const inv = createInvitation({
      household: household(),
      invitedByUserId: 'user-owner',
    });
    expect(inv.invitedEmail).toBe('');
    expect(inv.linkToken).toMatch(/^[0-9a-f]{24}$/);
    expect(inv.status).toBe('pending');
    expect(() => validateCreateInvitation({
      household: household(),
      invitedByUserId: 'user-owner',
    })).not.toThrow();
  });

  test('a malformed provided email is rejected; an omitted email is allowed', () => {
    expect(() => createInvitation({
      household: household(),
      invitedByUserId: 'user-owner',
      invitedEmail: 'not-an-email',
    })).toThrow();

    const withEmail = createInvitation({
      household: household(),
      invitedByUserId: 'user-owner',
      invitedEmail: '  marie@example.com  ',
    });
    expect(withEmail.invitedEmail).toBe('marie@example.com');
  });

  test('the invite screen shares through the injected native port, with no email form', () => {
    expect(inviteSource).toContain('services.share.share');
    expect(inviteSource).toContain('invite.createLink');
    expect(inviteSource).not.toMatch(/email-address|emailPlaceholder|TextInput/);
  });

  test('the native share adapter is available and honest', () => {
    const share = new LocalSystemShareAdapter();
    expect(share.isAvailable()).toBe(true);
    expect(typeof share.share).toBe('function');
  });
});
