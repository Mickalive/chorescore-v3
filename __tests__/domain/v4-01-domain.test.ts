/**
 * V4-01 — Domaine V4 et migration sûre
 *
 * Evidence for the V4-01 acceptance list:
 *   - Category sans seed obligatoire   (user-created categories only)
 *   - named member distinct de linked identity
 *   - task split custom exact et snapshot du ratio de catégorie
 *   - attachments provider-agnostic
 *   - aucune réinterprétation historique
 *   - vocabulaire Task côté présentation
 *   - invariants V3 préservés (zero-sum, unit history, V3 entry shape)
 *
 * The atomic Todo task|expense acceptance has its own file:
 * `__tests__/domain/v4-01-todo-atomic.test.ts`.
 */

import fs from 'fs';
import path from 'path';

import {
  Category,
  ContributionEntry,
  isLinkedMember,
  isNamedMember,
  memberIdentityKind,
} from '../../src/domain/entities';
import {
  allocateEntryShares,
  allocateTaskShares,
  cloneTaskSplitWeights,
  normalizeTaskSplitWeights,
  sumTaskShares,
} from '../../src/domain/calculations/taskSplit';
import {
  CATEGORY_NAME_MAX_LENGTH,
  buildCategoryDraft,
  categoryDefaultTaskRatioSnapshot,
  renameCategory,
  requireSplitCoverage,
  resolveEntryCategoryLabel,
  resolveTaskSplitForNewEntry,
  setCategoryDefaultTaskRatio,
} from '../../src/domain/services/categoryService';
import {
  ATTACHMENT_NOTE_MAX_LENGTH,
  ATTACHMENT_REF_MAX_LENGTH,
  AttachmentInput,
  attachmentReleaseDescriptor,
  createAttachment,
  normalizeNote,
} from '../../src/domain/services/attachmentService';
import {
  calculateContributionBalances,
  contributionLedgerIsZeroSum,
} from '../../src/domain/calculations/contributionLedger';
import { deltaUpdateContribution } from '../../src/domain/calculations/materializedBalances';
import { createInMemoryRepositories } from '../../src/infrastructure/repositories/RepositoryFactory';
import { InMemoryMemberRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import {
  ensureDemoFixture,
  DEMO_HOUSEHOLD_ID,
} from '../../src/features/app/demoFixture';
import { AuthUser } from '../../src/application/ports';
import {
  ATTACHMENTS_UNAVAILABLE,
  LocalAttachmentAdapter,
} from '../../src/infrastructure/local/LocalAttachmentAdapter';
import { PrivacyReleaseGate } from '../../src/analytics/gate';
import { createDefaultPipeline } from '../../src/analytics/pipeline';
import { OperationalFact } from '../../src/analytics/types';
import {
  ACTION_LABEL,
  LEDGER_NOUN,
  SPLIT_LABEL,
  SCREEN_LABEL,
  ledgerNounLabel,
  memberIdentityLabel,
  splitSourceLabel,
  t,
} from '../../src/presentation/taskVocabulary';

const HH = 'h-v4-01';

function contribution(overrides: Partial<ContributionEntry> = {}): ContributionEntry {
  return {
    id: 'c-1',
    householdId: HH,
    label: 'Aspirateur salon',
    performedByMemberId: 'm-a',
    beneficiaryMemberIds: ['m-a', 'm-b'],
    value: 30,
    unit: 'minutes',
    persistentTaskId: null,
    occurredAt: '2026-09-16T10:00:00.000Z',
    createdBy: 'user-1',
    ...overrides,
  };
}

function category(overrides: Partial<Category> = {}): Category {
  const now = '2026-09-16T10:00:00.000Z';
  const merged: Category = {
    id: 'cat-1',
    householdId: HH,
    name: 'Ménage',
    defaultTaskRatio: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  // The category always owns its ratio: a test fixture can never share an
  // array with the entry snapshot it is compared against.
  if (overrides.defaultTaskRatio) {
    merged.defaultTaskRatio = overrides.defaultTaskRatio.map((weight) => ({ ...weight }));
  }
  return merged;
}

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// Category sans seed obligatoire
// ─────────────────────────────────────────────────────────────

describe('V4-01 Category — user-created only, never seeded', () => {
  test('a fresh repository exposes zero categories for a new group', async () => {
    const repos = createInMemoryRepositories();
    expect(await repos.categories.getByHousehold(HH)).toHaveLength(0);
    expect(await repos.categories.getById('anything')).toBeNull();
  });

  test('the demo fixture seeds members, tasks and entries but NO category', async () => {
    const repos = createInMemoryRepositories();
    const user: AuthUser = {
      userId: 'demo-user-alex',
      email: 'alex.demo@chorescore.app',
      displayName: 'Alex',
      provider: 'local',
    };

    await ensureDemoFixture(repos, user);

    expect(await repos.categories.getByHousehold(DEMO_HOUSEHOLD_ID)).toHaveLength(0);
    // The fixture still seeds its own V3 data (sanity: the assertion above is
    // not passing because the fixture silently did nothing).
    expect((await repos.members.getByHousehold(DEMO_HOUSEHOLD_ID)).length).toBeGreaterThan(0);
    expect((await repos.contributions.getByHousehold(DEMO_HOUSEHOLD_ID)).length).toBeGreaterThan(0);
  });

  test('no product code path ever calls categories.seed (no imposed taxonomy)', () => {
    const root = path.resolve(__dirname, '../..');
    const offenders: string[] = [];

    for (const sourceRoot of ['src', 'app']) {
      for (const file of walkSourceFiles(path.join(root, sourceRoot))) {
        const content = fs.readFileSync(file, 'utf8');
        // `.seed(` on a categories repository would install a taxonomy.
        // Repository class definitions declare `seed(...)` as a method and are
        // not matched (the pattern requires `categories.seed(`).
        if (/categories\s*\.\s*seed\s*\(/.test(content)) {
          offenders.push(path.relative(root, file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test('the demo fixture file does not reference categories at all', () => {
    const root = path.resolve(__dirname, '../..');
    const content = fs.readFileSync(path.join(root, 'src/features/app/demoFixture.ts'), 'utf8');
    expect(content).not.toMatch(/categor/i);
  });

  test('category names are validated, bounded and normalized', () => {
    const draft = buildCategoryDraft({ householdId: HH, name: '  Chambre   d\u2019amis  ' });
    expect(draft.name).toBe('Chambre d\u2019amis');
    expect(draft.defaultTaskRatio).toBeNull();

    expect(() => buildCategoryDraft({ householdId: HH, name: '   ' })).toThrow('non-empty');
    expect(() => buildCategoryDraft({ householdId: '', name: 'Ménage' })).toThrow('householdId');
    expect(() =>
      buildCategoryDraft({ householdId: HH, name: 'x'.repeat(CATEGORY_NAME_MAX_LENGTH + 1) })
    ).toThrow(String(CATEGORY_NAME_MAX_LENGTH));
    expect(() => renameCategory('')).toThrow('non-empty');
  });

  test('a category default ratio is validated and copied (snapshot safety)', () => {
    const input = [
      { memberId: 'm-a', weight: 1 },
      { memberId: 'm-b', weight: 2 },
    ];
    const draft = buildCategoryDraft({
      householdId: HH,
      name: 'Ménage',
      defaultTaskRatio: input,
    });

    expect(draft.defaultTaskRatio).toEqual(input);
    // The stored ratio is an independent copy: mutating the input afterwards
    // must not change what the category holds.
    input[0].weight = 99;
    expect(draft.defaultTaskRatio?.[0].weight).toBe(1);

    expect(() =>
      buildCategoryDraft({
        householdId: HH,
        name: 'Ménage',
        defaultTaskRatio: [{ memberId: 'm-a', weight: 0 }],
      })
    ).toThrow('> 0');
    expect(() =>
      buildCategoryDraft({
        householdId: HH,
        name: 'Ménage',
        defaultTaskRatio: [
          { memberId: 'm-a', weight: 1 },
          { memberId: 'm-a', weight: 2 },
        ],
      })
    ).toThrow('duplicate');
  });

  test('renaming and deleting a category never reinterprets history', () => {
    const cat = category({ name: 'Ménage' });
    const entry = contribution({ categoryId: cat.id, categoryLabelSnapshot: 'Ménage' });
    const before = JSON.parse(JSON.stringify(entry));

    // Rename: the live name wins while the category exists.
    const renamed = { ...cat, name: renameCategory('Propreté').name };
    expect(resolveEntryCategoryLabel(entry, [renamed])).toBe('Propreté');

    // Delete: the creation-time snapshot keeps history readable.
    expect(resolveEntryCategoryLabel(entry, [])).toBe('Ménage');

    // Neither operation touched the entry itself.
    expect(entry).toEqual(before);
  });

  test('entries without a category stay category-less (no default imposed)', () => {
    const entry = contribution({ categoryId: null });
    expect(resolveEntryCategoryLabel(entry, [])).toBeNull();
    expect(entry.categoryId).toBeNull();
    expect(entry.categoryLabelSnapshot).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Named member distinct de linked identity
// ─────────────────────────────────────────────────────────────

describe('V4-01 Member identities — named vs linked', () => {
  test('memberIdentityKind distinguishes the two without merging them', () => {
    expect(memberIdentityKind({ userId: null })).toBe('named');
    expect(memberIdentityKind({ userId: undefined })).toBe('named');
    expect(memberIdentityKind({ userId: '' })).toBe('named');
    expect(memberIdentityKind({ userId: 'user-42' })).toBe('linked');

    expect(isNamedMember({ userId: null })).toBe(true);
    expect(isNamedMember({ userId: 'user-42' })).toBe(false);
    expect(isLinkedMember({ userId: 'user-42' })).toBe(true);
    expect(isLinkedMember({ userId: null })).toBe(false);
  });

  test('a named member round-trips as null and stays a full member identity', async () => {
    const repo = new InMemoryMemberRepository();

    const marie = await repo.create({ householdId: HH, name: 'Marie', userId: null });
    const alex = await repo.create({ householdId: HH, name: 'Alex', userId: 'user-alex' });

    expect(marie.userId).toBeNull();
    expect(memberIdentityKind(marie)).toBe('named');
    expect(alex.userId).toBe('user-alex');
    expect(memberIdentityKind(alex)).toBe('linked');

    const stored = await repo.getByHousehold(HH);
    expect(stored).toHaveLength(2);
    // Both are full ledger identities: distinct ids, distinct names, no merge.
    expect(stored[0].id).not.toBe(stored[1].id);
    expect(stored.map((m) => m.name).sort()).toEqual(['Alex', 'Marie']);
    expect(stored.find((m) => m.name === 'Marie')?.userId).toBeNull();
    expect(stored.find((m) => m.name === 'Alex')?.userId).toBe('user-alex');
  });

  test('two named members with the same name never collapse into one identity', async () => {
    const repo = new InMemoryMemberRepository();
    const first = await repo.create({ householdId: HH, name: 'Sam', userId: null });
    const second = await repo.create({ householdId: HH, name: 'Sam', userId: null });

    expect(first.id).not.toBe(second.id);
    expect(await repo.getByHousehold(HH)).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────
// Task split custom exact + invariants V3
// ─────────────────────────────────────────────────────────────

describe('V4-01 Task split — equal, custom, exact', () => {
  test('equal split keeps the exact V3 arithmetic (value / count)', () => {
    const shares = allocateTaskShares(10, ['m-a', 'm-b', 'm-c']);
    expect(shares.map((s) => s.share)).toEqual([10 / 3, 10 / 3, 10 / 3]);
    expect(sumTaskShares(shares)).toBeCloseTo(10, 9);

    // An entry without split fields is an equal entry: same expression, so
    // the validated V3 balances are byte-for-byte reproducible.
    const entry = contribution({ value: 45, beneficiaryMemberIds: ['m-a', 'm-b'] });
    expect(allocateEntryShares(entry)).toEqual([
      { memberId: 'm-a', share: 22.5 },
      { memberId: 'm-b', share: 22.5 },
    ]);
  });

  test('custom split allocates the ratio exactly', () => {
    const weights = [
      { memberId: 'm-a', weight: 1 },
      { memberId: 'm-b', weight: 2 },
    ];
    const shares = allocateTaskShares(30, ['m-a', 'm-b'], weights);

    expect(shares).toEqual([
      { memberId: 'm-a', share: 10 },
      { memberId: 'm-b', share: 20 },
    ]);
    expect(sumTaskShares(shares)).toBe(30);
  });

  test('custom split always sums to the entry value (residual absorbed deterministically)', () => {
    const weights = [
      { memberId: 'm-a', weight: 1 },
      { memberId: 'm-b', weight: 1 },
      { memberId: 'm-c', weight: 1 },
    ];
    const shares = allocateTaskShares(10, ['m-a', 'm-b', 'm-c'], weights);

    expect(sumTaskShares(shares)).toBeCloseTo(10, 9);
    // Deterministic: the last beneficiary absorbs the rounding residual.
    expect(shares[2].share).toBeCloseTo(10 - (shares[0].share + shares[1].share), 12);
    expect(allocateTaskShares(10, ['m-a', 'm-b', 'm-c'], weights)).toEqual(shares);
  });

  test('a missing, duplicate or invalid weight is an error, never a silent fallback', () => {
    expect(() =>
      allocateTaskShares(30, ['m-a', 'm-c'], [
        { memberId: 'm-a', weight: 1 },
        { memberId: 'm-b', weight: 2 },
      ])
    ).toThrow('no weight for beneficiary m-c');

    expect(() =>
      normalizeTaskSplitWeights([
        { memberId: 'm-a', weight: 1 },
        { memberId: 'm-a', weight: 3 },
      ])
    ).toThrow('duplicate');

    expect(() => normalizeTaskSplitWeights([{ memberId: 'm-a', weight: 0 }])).toThrow('> 0');
    expect(() => normalizeTaskSplitWeights([{ memberId: 'm-a', weight: -2 }])).toThrow('> 0');
    expect(() => normalizeTaskSplitWeights([])).toThrow('at least one weight');
    expect(() => allocateTaskShares(10, [], null)).toThrow('at least one beneficiary');
    expect(() => allocateTaskShares(10, ['m-a'], [{ memberId: 'm-a', weight: 1 }])).not.toThrow();
  });

  test('a custom entry without weights is rejected instead of silently reinterpreted', () => {
    const entry = contribution({ splitMode: 'custom' });
    expect(() => allocateEntryShares(entry)).toThrow('defines no weights');
    expect(() =>
      calculateContributionBalances([entry], 'minutes', [], ['m-a', 'm-b', 'm-c'])
    ).toThrow('defines no weights');
  });

  test('weights are copied on read (an entry owns its snapshot)', () => {
    const stored = [{ memberId: 'm-a', weight: 1 }];
    const copy = cloneTaskSplitWeights(stored);
    expect(copy).toEqual(stored);
    copy![0].weight = 42;
    expect(stored[0].weight).toBe(1);

    expect(cloneTaskSplitWeights(null)).toBeNull();
    expect(cloneTaskSplitWeights(undefined)).toBeNull();
  });

  test('zero-sum invariant holds for custom-split entries and deltas match replay', () => {
    const entries: ContributionEntry[] = [
      // V3-shaped entry (no split fields)
      contribution({ id: 'c-v3', value: 30, beneficiaryMemberIds: ['m-a', 'm-b'] }),
      // custom-split entry
      contribution({
        id: 'c-custom',
        performedByMemberId: 'm-c',
        beneficiaryMemberIds: ['m-a', 'm-b', 'm-c'],
        value: 100,
        splitMode: 'custom',
        splitSource: 'custom',
        splitWeights: [
          { memberId: 'm-a', weight: 1 },
          { memberId: 'm-b', weight: 3 },
          { memberId: 'm-c', weight: 6 },
        ],
      }),
    ];

    const memberIds = ['m-a', 'm-b', 'm-c'];
    const replayed = calculateContributionBalances(entries, 'minutes', [], memberIds);
    expect(contributionLedgerIsZeroSum(replayed)).toBe(true);

    // Incremental materialized balances must equal the full ledger replay.
    let delta = new Map<string, number>(memberIds.map((id) => [id, 0]));
    for (const entry of entries) {
      delta = deltaUpdateContribution(delta, entry, 'minutes', memberIds, 'add');
    }
    for (const memberId of memberIds) {
      expect(delta.get(memberId)).toBeCloseTo(replayed.get(memberId) ?? 0, 9);
    }

    // Removing every entry returns the balances to exactly zero.
    for (const entry of [...entries].reverse()) {
      delta = deltaUpdateContribution(delta, entry, 'minutes', memberIds, 'remove');
    }
    for (const memberId of memberIds) {
      expect(delta.get(memberId)).toBeCloseTo(0, 9);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Snapshot du ratio de catégorie
// ─────────────────────────────────────────────────────────────

describe('V4-01 Category default ratio — snapshoted, overrideable', () => {
  const ratio = [
    { memberId: 'm-a', weight: 1 },
    { memberId: 'm-b', weight: 3 },
  ];

  test('precedence: explicit override > category default > equal', () => {
    const cat = category({ defaultTaskRatio: ratio });

    const fromCategory = resolveTaskSplitForNewEntry({
      category: cat,
      beneficiaryMemberIds: ['m-a', 'm-b'],
    });
    expect(fromCategory.splitMode).toBe('custom');
    expect(fromCategory.splitSource).toBe('category-default');
    expect(fromCategory.splitWeights).toEqual(ratio);

    const overridden = resolveTaskSplitForNewEntry({
      category: cat,
      overrideWeights: [
        { memberId: 'm-a', weight: 5 },
        { memberId: 'm-b', weight: 5 },
      ],
      beneficiaryMemberIds: ['m-a', 'm-b'],
    });
    expect(overridden.splitSource).toBe('custom');
    expect(overridden.splitWeights).toEqual([
      { memberId: 'm-a', weight: 5 },
      { memberId: 'm-b', weight: 5 },
    ]);

    const equal = resolveTaskSplitForNewEntry({ beneficiaryMemberIds: ['m-a', 'm-b'] });
    expect(equal).toEqual({ splitMode: 'equal', splitSource: 'equal' });

    const noRatio = resolveTaskSplitForNewEntry({
      category: category({ defaultTaskRatio: null }),
      beneficiaryMemberIds: ['m-a', 'm-b'],
    });
    expect(noRatio.splitMode).toBe('equal');
  });

  test('the resolved ratio is an independent copy of the category ratio', () => {
    const cat = category({ defaultTaskRatio: ratio });
    const resolved = resolveTaskSplitForNewEntry({
      category: cat,
      beneficiaryMemberIds: ['m-a', 'm-b'],
    });
    expect(resolved.splitWeights).toEqual(ratio);

    // Editing the category afterwards cannot move the already-resolved ratio.
    cat.defaultTaskRatio![0].weight = 99;
    expect(resolved.splitWeights).toEqual([
      { memberId: 'm-a', weight: 1 },
      { memberId: 'm-b', weight: 3 },
    ]);
    expect(categoryDefaultTaskRatioSnapshot(cat)).toEqual([
      { memberId: 'm-a', weight: 99 },
      { memberId: 'm-b', weight: 3 },
    ]);
    expect(categoryDefaultTaskRatioSnapshot(null)).toBeNull();
  });

  test('a ratio that does not cover every beneficiary fails at creation time', () => {
    const cat = category({ defaultTaskRatio: ratio });
    expect(() =>
      resolveTaskSplitForNewEntry({ category: cat, beneficiaryMemberIds: ['m-a', 'm-c'] })
    ).toThrow('Category default ratio defines no weight for beneficiary m-c');

    expect(() =>
      resolveTaskSplitForNewEntry({
        overrideWeights: [{ memberId: 'm-a', weight: 1 }],
        beneficiaryMemberIds: ['m-a', 'm-b'],
      })
    ).toThrow('Task split defines no weight for beneficiary m-b');

    // Extra weights beyond the beneficiaries are allowed (group-wide ratio).
    expect(() =>
      resolveTaskSplitForNewEntry({
        category: cat,
        beneficiaryMemberIds: ['m-a'],
      })
    ).not.toThrow();
    requireSplitCoverage({ splitMode: 'equal', splitSource: 'equal' }, ['m-a']);
  });

  test('editing or deleting the category never reinterprets a stored entry', () => {
    const cat = category({ defaultTaskRatio: ratio });
    const resolved = resolveTaskSplitForNewEntry({
      category: cat,
      beneficiaryMemberIds: ['m-a', 'm-b'],
    });

    const entry = contribution({
      value: 40,
      beneficiaryMemberIds: ['m-a', 'm-b'],
      categoryId: cat.id,
      categoryLabelSnapshot: cat.name,
      splitMode: resolved.splitMode,
      splitWeights: resolved.splitWeights,
      splitSource: resolved.splitSource,
    });

    const memberIds = ['m-a', 'm-b'];
    const before = calculateContributionBalances([entry], 'minutes', [], memberIds);
    const snapshotWeights = JSON.parse(JSON.stringify(entry.splitWeights));

    // The group rewrites the category ratio and then deletes the category.
    cat.defaultTaskRatio = [
      { memberId: 'm-a', weight: 7 },
      { memberId: 'm-b', weight: 1 },
    ];
    cat.name = 'Propreté';
    const afterRename = calculateContributionBalances([entry], 'minutes', [], memberIds);

    cat.defaultTaskRatio = null;
    cat.name = 'Ancienne catégorie';
    const afterDelete = calculateContributionBalances([entry], 'minutes', [], memberIds);

    // Balances are identical in all three cases: the entry kept its snapshot.
    expect(entry.splitWeights).toEqual(snapshotWeights);
    expect(entry.splitSource).toBe('category-default');
    for (const memberId of memberIds) {
      expect(afterRename.get(memberId)).toBeCloseTo(before.get(memberId) ?? 0, 9);
      expect(afterDelete.get(memberId)).toBeCloseTo(before.get(memberId) ?? 0, 9);
    }
    expect(contributionLedgerIsZeroSum(afterDelete)).toBe(true);
    expect(resolveEntryCategoryLabel(entry, [])).toBe('Ménage');
  });

  test('unit history survives a unit change together with the split snapshot', () => {
    const minutesEntry = contribution({
      id: 'c-min',
      value: 30,
      splitMode: 'custom',
      splitSource: 'category-default',
      splitWeights: [
        { memberId: 'm-a', weight: 1 },
        { memberId: 'm-b', weight: 3 },
      ],
      categoryId: 'cat-1',
      categoryLabelSnapshot: 'Ménage',
    });
    const pointsEntry = contribution({ id: 'c-pts', unit: 'points', value: 5 });
    const entries = [minutesEntry, pointsEntry];
    const memberIds = ['m-a', 'm-b'];

    const minutes = calculateContributionBalances(entries, 'minutes', [], memberIds);
    const points = calculateContributionBalances(entries, 'points', [], memberIds);

    // The group is now in "points" mode: minutes history is not re-read as
    // points and vice versa — each entry keeps its own unit.
    expect(contributionLedgerIsZeroSum(minutes)).toBe(true);
    expect(contributionLedgerIsZeroSum(points)).toBe(true);
    expect(minutesEntry.unit).toBe('minutes');
    expect(pointsEntry.unit).toBe('points');
    expect(minutes.get('m-a')).toBeCloseTo(30 - 7.5, 9); // +30 done, −7.5 share
    expect(points.get('m-a')).toBe(2.5); // +5 done, −2.5 share (equal split)
  });
});

// ─────────────────────────────────────────────────────────────
// Attachments provider-agnostic
// ─────────────────────────────────────────────────────────────

describe('V4-01 Attachments — provider-agnostic and private', () => {
  test('an attachment stores only provider-agnostic fields', () => {
    const attachment = createAttachment({
      id: 'att-1',
      kind: 'photo',
      ref: 'file:///data/user/0/app/cache/photo-1.jpg',
      mimeType: 'image/jpeg',
      byteSize: 12345,
      width: 1024,
      height: 768,
      createdAt: '2026-09-16T10:00:00.000Z',
    });

    expect(Object.keys(attachment).sort()).toEqual(
      ['byteSize', 'createdAt', 'height', 'id', 'kind', 'mimeType', 'ref', 'width'].sort()
    );

    // Any opaque reference works: local path, content uri, provider id.
    const fromProvider = createAttachment({
      id: 'att-2',
      kind: 'photo',
      ref: 'provider://media/abc-123',
      createdAt: '2026-09-16T10:00:00.000Z',
    });
    expect(fromProvider.ref).toBe('provider://media/abc-123');
    expect(fromProvider.mimeType).toBeUndefined();
  });

  test('malformed attachments are rejected before they reach a ledger write', () => {
    const base: Pick<AttachmentInput, 'id' | 'kind' | 'createdAt'> = {
      id: 'att-1',
      kind: 'photo',
      createdAt: '2026-09-16T10:00:00.000Z',
    };

    expect(() => createAttachment({ ...base, ref: '   ' })).toThrow('non-empty');
    expect(() =>
      createAttachment({ ...base, ref: 'x'.repeat(ATTACHMENT_REF_MAX_LENGTH + 1) })
    ).toThrow(String(ATTACHMENT_REF_MAX_LENGTH));
    expect(() => createAttachment({ ...base, kind: 'video' as 'photo', ref: 'r' })).toThrow(
      'Unsupported attachment kind'
    );
    expect(() => createAttachment({ ...base, ref: 'r', byteSize: -1 })).toThrow('non-negative');
    expect(() => createAttachment({ ...base, ref: 'r', width: 1.5 })).toThrow('integer');
    expect(() => createAttachment({ ...base, kind: 'photo', ref: '' })).toThrow('non-empty');
  });

  test('the release projection omits the id and the reference', () => {
    const attachment = createAttachment({
      id: 'att-secret',
      kind: 'photo',
      ref: 'file:///private/path/photo-1.jpg',
      mimeType: 'image/jpeg',
      byteSize: 99,
      createdAt: '2026-09-16T10:00:00.000Z',
    });

    const descriptor = attachmentReleaseDescriptor(attachment);
    expect(descriptor).toEqual({ kind: 'photo', mimeType: 'image/jpeg', byteSize: 99 });
    expect(descriptor).not.toHaveProperty('id');
    expect(descriptor).not.toHaveProperty('ref');
    expect(descriptor).not.toHaveProperty('createdAt');
    expect(JSON.stringify(descriptor)).not.toContain('private/path');
    expect(JSON.stringify(descriptor)).not.toContain('att-secret');
  });

  test('notes are optional, bounded and normalized', () => {
    expect(normalizeNote('  sous l\u2019évier  ')).toBe('sous l\u2019évier');
    expect(normalizeNote('')).toBeUndefined();
    expect(normalizeNote('   ')).toBeUndefined();
    expect(normalizeNote(null)).toBeUndefined();
    expect(normalizeNote(undefined)).toBeUndefined();
    expect(() => normalizeNote('x'.repeat(ATTACHMENT_NOTE_MAX_LENGTH + 1))).toThrow(
      String(ATTACHMENT_NOTE_MAX_LENGTH)
    );
    expect(() => normalizeNote(42 as unknown as string)).toThrow('Note must be a string');
  });

  test('the attachment adapter is honest while no provider is configured', async () => {
    const adapter = new LocalAttachmentAdapter();

    // Port shape (AttachmentGateway) is fully implemented.
    expect(typeof adapter.isAvailable).toBe('function');
    expect(typeof adapter.pickPhoto).toBe('function');
    expect(typeof adapter.save).toBe('function');
    expect(typeof adapter.remove).toBe('function');

    // Honest behaviour: no provider → no fake photo, no phantom reference.
    expect(adapter.isAvailable()).toBe(false);
    await expect(adapter.pickPhoto()).resolves.toBeNull();
    await expect(
      adapter.save({ localUri: 'file:///tmp/photo.jpg' }, HH)
    ).rejects.toThrow(ATTACHMENTS_UNAVAILABLE);
    await expect(adapter.remove({ ref: 'anything' })).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Privacy: notes / attachments / category text never released
// ─────────────────────────────────────────────────────────────

describe('V4-01 Privacy — new V4-01 fields are rejected by the analytics plane', () => {
  const gate = new PrivacyReleaseGate();

  test('the release gate blocks notes, category text, category ids and attachments', () => {
    const note = gate.isClean({ taxonomyCategoryId: 'cleaning', note: 'sous l\u2019évier' });
    expect(note.clean).toBe(false);
    expect(note.violations[0].type).toBe('free_text_detected');

    const snapshot = gate.isClean({ categoryLabelSnapshot: 'Vaisselle' });
    expect(snapshot.clean).toBe(false);
    expect(snapshot.violations[0].type).toBe('free_text_detected');

    const category = gate.isClean({ categoryId: 'category-1' });
    expect(category.clean).toBe(false);
    expect(category.violations[0].type).toBe('operational_id_detected');

    const attachments = gate.isClean({ attachments: [{ kind: 'photo' }] });
    expect(attachments.clean).toBe(false);
    expect(attachments.violations[0].type).toBe('attachment_payload_detected');

    // A clean, minimal research fact still passes.
    expect(gate.isClean({ taxonomyCategoryId: 'cleaning', weekday: 3 }).clean).toBe(true);
  });

  test('the transform pipeline rejects V4-01 operational payloads on input', () => {
    const pipeline = createDefaultPipeline();
    const base = {
      unit: 'minutes',
      value: 15,
      beneficiaryCount: 2,
      label: 'aspi salon',
    };
    const timestamp = '2026-09-16T10:00:00.000Z';

    const withNote = pipeline.transform({
      type: 'contribution_created',
      data: { ...base, note: 'hello' },
      timestamp,
    } as OperationalFact);
    expect(withNote.success).toBe(false);
    expect(withNote.rejectionReason).toContain('note');

    const withSnapshot = pipeline.transform({
      type: 'contribution_created',
      data: { ...base, categoryLabelSnapshot: 'Vaisselle' },
      timestamp,
    } as OperationalFact);
    expect(withSnapshot.success).toBe(false);
    expect(withSnapshot.rejectionReason).toContain('categoryLabelSnapshot');

    const withCategoryId = pipeline.transform({
      type: 'contribution_created',
      data: { ...base, categoryId: 'category-1' },
      timestamp,
    } as OperationalFact);
    expect(withCategoryId.success).toBe(false);
    expect(withCategoryId.rejectionReason).toContain('categoryId');

    const withAttachments = pipeline.transform({
      type: 'contribution_created',
      data: { ...base, attachments: [{ id: 'att-1', kind: 'photo', ref: 'file:///x.jpg' }] },
      timestamp,
    } as OperationalFact);
    expect(withAttachments.success).toBe(false);
    expect(withAttachments.rejectionReason).toContain('attachments');

    // The clean payload still transforms, and never emits the raw label.
    const clean = pipeline.transform({
      type: 'contribution_created',
      data: base,
      timestamp,
    } as OperationalFact);
    expect(clean.success).toBe(true);
    const emitted = clean.fact as unknown as Record<string, unknown>;
    expect(emitted.label).toBeUndefined();
    expect(emitted.note).toBeUndefined();
    expect(emitted.attachments).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Presentation vocabulary: Task, never Contribution
// ─────────────────────────────────────────────────────────────

describe('V4-01 Presentation vocabulary — Task / Tâche', () => {
  const forbidden =
    /\b(contribution|contributions|démo|demo|premium|standard|paywall|abonnement|chrono|essai)\b/i;

  function collectValues(node: unknown, acc: string[] = []): string[] {
    if (typeof node === 'string') {
      acc.push(node);
    } else if (Array.isArray(node)) {
      node.forEach((child) => collectValues(child, acc));
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach((child) => collectValues(child, acc));
    }
    return acc;
  }

  test('every visible string has FR and EN and no forbidden wording', () => {
    const modules = [LEDGER_NOUN, SCREEN_LABEL, ACTION_LABEL, SPLIT_LABEL];
    for (const values of modules) {
      const strings = collectValues(values);
      expect(strings.length).toBeGreaterThan(0);
      for (const value of strings) {
        expect(value.length).toBeGreaterThan(0);
        expect(value).not.toMatch(forbidden);
      }
    }

    // Explicit vocabulary checks.
    expect(t(LEDGER_NOUN.task, 'fr')).toBe('Tâche');
    expect(t(LEDGER_NOUN.task, 'en')).toBe('Task');
    expect(t(SCREEN_LABEL.todo, 'fr')).toBe('À faire');
    expect(t(LEDGER_NOUN.expensePlural, 'fr')).toBe('Dépenses');
  });

  test('French accents are exact', () => {
    expect(t(LEDGER_NOUN.task, 'fr')).toBe('Tâche');
    expect(t(LEDGER_NOUN.taskPlural, 'fr')).toBe('Tâches');
    expect(t(LEDGER_NOUN.category, 'fr')).toBe('Catégorie');
    expect(t(LEDGER_NOUN.split, 'fr')).toBe('Répartition');
    expect(t(SCREEN_LABEL.todo, 'fr')).toBe('À faire');
    expect(t(SCREEN_LABEL.createGroup, 'fr')).toBe('Créer un groupe');
    expect(t(SPLIT_LABEL.equal, 'fr')).toBe('Égal');
    expect(t(SPLIT_LABEL.custom, 'fr')).toBe('Personnalisé');
    expect(t(SPLIT_LABEL.categoryDefault, 'fr')).toBe('Ratio de la catégorie');
    expect(t(ACTION_LABEL.complete, 'fr')).toBe('Terminer');
  });

  test('label helpers expose the right noun for each ledger kind', () => {
    expect(ledgerNounLabel('task', 'fr')).toBe('Tâche');
    expect(ledgerNounLabel('task', 'en')).toBe('Task');
    expect(ledgerNounLabel('expense', 'fr')).toBe('Dépense');
    expect(ledgerNounLabel('expense', 'en')).toBe('Expense');

    expect(splitSourceLabel('equal', 'fr')).toBe('Égal');
    expect(splitSourceLabel('custom', 'fr')).toBe('Personnalisé');
    expect(splitSourceLabel('category-default', 'fr')).toBe('Ratio de la catégorie');
    expect(splitSourceLabel('category-default', 'en')).toBe('Category ratio');

    expect(memberIdentityLabel('named', 'fr')).toBe('Membre nommé');
    expect(memberIdentityLabel('linked', 'en')).toBe('Linked member');
  });

  test('an unknown locale falls back to French instead of leaking a raw key', () => {
    expect(t(LEDGER_NOUN.task, 'de' as 'fr')).toBe('Tâche');
  });
});
