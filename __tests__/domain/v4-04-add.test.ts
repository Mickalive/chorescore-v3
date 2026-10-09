/**
 * V4-04 — Ajouter : Tâche/Dépense, catégories libres, split, note/photo, membres
 *
 * Evidence for the V4-04 acceptance list:
 *   - UI says Tâche, never Contribution;
 *   - no seeded/imposed category (a group starts empty);
 *   - safe category create/rename/delete (history keeps its snapshot);
 *   - task split equal / category-default / custom, override wins;
 *   - exact expense split, equal or custom (integer minor units);
 *   - optional note + photo on both task and expense;
 *   - the Members section replaces the old history;
 *   - native share sheet reuse.
 */

import fs from 'fs';
import path from 'path';

import {
  Category,
  ContributionEntry,
  ExpenseEntry,
} from '../../src/domain/entities';
import {
  buildCategoryDraft,
  renameCategory,
  setCategoryDefaultTaskRatio,
} from '../../src/domain/services/categoryService';
import {
  ADD_LABEL_MAX_LENGTH,
  buildExpenseDraft,
  buildTaskDraft,
  defaultTaskWeights,
  expenseSharesFromRaw,
  parseAmountToMinor,
  parsePositiveNumber,
  parseShareToMinor,
  taskWeightsFromRaw,
} from '../../src/domain/services/addEntryService';
import {
  ATTACHMENTS_UNAVAILABLE,
  LocalAttachmentAdapter,
} from '../../src/infrastructure/local/LocalAttachmentAdapter';
import {
  E2E_ATTACHMENT_REF_PREFIX,
  E2EAttachmentAdapter,
} from '../../src/infrastructure/local/E2EAttachmentAdapter';
import { createInMemoryRepositories } from '../../src/infrastructure/repositories/RepositoryFactory';
import { CATALOG } from '../../src/i18n/catalog';

const ROOT = path.resolve(__dirname, '../..');
const HH = 'h-v4-04';

function category(overrides: Partial<Category> = {}): Category {
  const now = '2026-10-09T10:00:00.000Z';
  const merged: Category = {
    id: 'cat-fixed',
    householdId: HH,
    name: 'Ménage',
    defaultTaskRatio: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  if (overrides.defaultTaskRatio) {
    merged.defaultTaskRatio = overrides.defaultTaskRatio.map((weight) => ({ ...weight }));
  }
  return merged;
}

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

// ─────────────────────────────────────────────────────────────
// Parsing helpers
// ─────────────────────────────────────────────────────────────

describe('V4-04 parsing helpers', () => {
  test('positive numbers tolerate a comma and reject non-positive input', () => {
    expect(parsePositiveNumber('15')).toBe(15);
    expect(parsePositiveNumber('42,50')).toBe(42.5);
    expect(parsePositiveNumber('0')).toBeNull();
    expect(parsePositiveNumber('-3')).toBeNull();
    expect(parsePositiveNumber('')).toBeNull();
  });

  test('money parses to integer minor units and shares allow zero', () => {
    expect(parseAmountToMinor('42.50')).toBe(4250);
    expect(parseAmountToMinor('42,5')).toBe(4250);
    expect(parseAmountToMinor('0')).toBeNull();
    expect(parseShareToMinor('')).toBe(0);
    expect(parseShareToMinor('12.34')).toBe(1234);
    expect(parseShareToMinor('abc')).toBe(0);
    expect(parseShareToMinor('-1')).toBeNull();
  });

  test('weights default to 1 and raw weights must all be positive', () => {
    expect(defaultTaskWeights(['m-a', 'm-b'])).toEqual([
      { memberId: 'm-a', weight: 1 },
      { memberId: 'm-b', weight: 1 },
    ]);
    expect(taskWeightsFromRaw(['m-a', 'm-b'], { 'm-a': '2', 'm-b': '1' })).toEqual([
      { memberId: 'm-a', weight: 2 },
      { memberId: 'm-b', weight: 1 },
    ]);
    expect(taskWeightsFromRaw(['m-a', 'm-b'], { 'm-a': '2' })).toBeNull();
    expect(taskWeightsFromRaw(['m-a'], { 'm-a': '0' })).toBeNull();
  });

  test('expense shares parse to non-negative integer minor units', () => {
    expect(expenseSharesFromRaw(['m-a', 'm-b'], { 'm-a': '10', 'm-b': '20' })).toEqual([
      { memberId: 'm-a', amountMinor: 1000 },
      { memberId: 'm-b', amountMinor: 2000 },
    ]);
    expect(expenseSharesFromRaw(['m-a'], { 'm-a': 'oops' })).toEqual([
      { memberId: 'm-a', amountMinor: 0 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────
// Task draft — no imposed category, split precedence, snapshot
// ─────────────────────────────────────────────────────────────

describe('V4-04 task draft', () => {
  const base = {
    householdId: HH,
    label: 'Aspi',
    value: 30,
    unit: 'minutes' as const,
    performedByMemberId: 'm-a',
    beneficiaryMemberIds: ['m-a', 'm-b'],
    occurredAt: '2026-10-09T10:00:00.000Z',
    createdBy: 'user-1',
  };

  test('a task without a category is category-less and uses the equal split', () => {
    const result = buildTaskDraft({ ...base, category: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.categoryId).toBeNull();
    expect(result.draft.categoryLabelSnapshot).toBeUndefined();
    expect(result.draft.splitMode).toBeUndefined();
    expect(result.draft.splitSource).toBeUndefined();
  });

  test('the category default ratio is applied and snapshoted', () => {
    const cat = category({
      defaultTaskRatio: [
        { memberId: 'm-a', weight: 1 },
        { memberId: 'm-b', weight: 3 },
      ],
    });
    const result = buildTaskDraft({ ...base, category: cat });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.categoryId).toBe(cat.id);
    expect(result.draft.categoryLabelSnapshot).toBe('Ménage');
    expect(result.draft.splitMode).toBe('custom');
    expect(result.draft.splitSource).toBe('category-default');
    expect(result.draft.splitWeights).toEqual([
      { memberId: 'm-a', weight: 1 },
      { memberId: 'm-b', weight: 3 },
    ]);
  });

  test('an explicit equal choice overrides the category default ratio', () => {
    const cat = category({
      defaultTaskRatio: [
        { memberId: 'm-a', weight: 1 },
        { memberId: 'm-b', weight: 3 },
      ],
    });
    const result = buildTaskDraft({ ...base, category: cat, splitChoice: 'equal' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Equal wins even though the category defines a ratio; the snapshot label
    // is still kept so the entry stays readable.
    expect(result.draft.splitMode).toBeUndefined();
    expect(result.draft.categoryId).toBe(cat.id);
    expect(result.draft.categoryLabelSnapshot).toBe('Ménage');
  });

  test('an explicit custom ratio is used with its own provenance', () => {
    const result = buildTaskDraft({
      ...base,
      category: null,
      splitChoice: 'custom',
      customWeights: [
        { memberId: 'm-a', weight: 2 },
        { memberId: 'm-b', weight: 1 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.splitMode).toBe('custom');
    expect(result.draft.splitSource).toBe('custom');
  });

  test('a custom ratio missing a beneficiary is rejected, never silently equal', () => {
    const result = buildTaskDraft({
      ...base,
      splitChoice: 'custom',
      customWeights: [{ memberId: 'm-a', weight: 1 }],
    });
    expect(result).toEqual({ ok: false, error: 'task-split-missing-weight' });
  });

  test('invalid value/label/beneficiaries are typed errors', () => {
    expect(buildTaskDraft({ ...base, value: 0 })).toEqual({ ok: false, error: 'value-invalid' });
    expect(buildTaskDraft({ ...base, label: '   ' })).toEqual({ ok: false, error: 'label-required' });
    expect(buildTaskDraft({ ...base, label: 'x'.repeat(ADD_LABEL_MAX_LENGTH + 1) })).toEqual({
      ok: false,
      error: 'label-too-long',
    });
    expect(buildTaskDraft({ ...base, beneficiaryMemberIds: [] })).toEqual({
      ok: false,
      error: 'beneficiaries-required',
    });
  });

  test('note and photo are optional and validated when present', () => {
    const withNote = buildTaskDraft({ ...base, note: '  sous l’évier  ' });
    expect(withNote.ok && withNote.draft.note).toBe('sous l’évier');

    const withPhoto = buildTaskDraft({
      ...base,
      attachments: [
        {
          id: 'att-1',
          kind: 'photo',
          ref: 'file:///tmp/photo.jpg',
          createdAt: '2026-10-09T10:00:00.000Z',
        },
      ],
    });
    expect(withPhoto.ok && withPhoto.draft.attachments?.[0].ref).toBe('file:///tmp/photo.jpg');

    const bad = buildTaskDraft({
      ...base,
      attachments: [
        { id: 'att-1', kind: 'photo', ref: '   ', createdAt: '2026-10-09T10:00:00.000Z' },
      ],
    });
    expect(bad).toEqual({ ok: false, error: 'attachment-invalid' });
  });
});

// ─────────────────────────────────────────────────────────────
// Expense draft — exact integer split + snapshot
// ─────────────────────────────────────────────────────────────

describe('V4-04 expense draft', () => {
  const base = {
    householdId: HH,
    title: 'Courses',
    amountMinor: 4250,
    currency: 'chf',
    paidByMemberId: 'm-a',
    participantMemberIds: ['m-a', 'm-b'],
    splitMode: 'equal' as const,
    occurredAt: '2026-10-09T10:00:00.000Z',
    createdBy: 'user-1',
  };

  test('an equal expense normalizes the currency and needs no custom shares', () => {
    const result = buildExpenseDraft({ ...base, category: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.currency).toBe('CHF');
    expect(result.draft.customShares).toBeUndefined();
    expect(result.draft.categoryId).toBeNull();
  });

  test('a custom expense must total exactly the amount', () => {
    const good = buildExpenseDraft({
      ...base,
      splitMode: 'custom',
      customShares: [
        { memberId: 'm-a', amountMinor: 2000 },
        { memberId: 'm-b', amountMinor: 2250 },
      ],
    });
    expect(good.ok).toBe(true);

    const bad = buildExpenseDraft({
      ...base,
      splitMode: 'custom',
      customShares: [
        { memberId: 'm-a', amountMinor: 2000 },
        { memberId: 'm-b', amountMinor: 2000 },
      ],
    });
    expect(bad).toEqual({ ok: false, error: 'expense-split-invalid' });
  });

  test('the selected category is snapshoted and kept as a display label', () => {
    const cat = category({ name: 'Maison' });
    const result = buildExpenseDraft({ ...base, category: cat });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.categoryId).toBe(cat.id);
    expect(result.draft.categoryLabelSnapshot).toBe('Maison');
    expect(result.draft.category).toBe('Maison');
  });

  test('invalid amount, currency and participants are typed errors', () => {
    expect(buildExpenseDraft({ ...base, amountMinor: 0 })).toEqual({
      ok: false,
      error: 'amount-invalid',
    });
    expect(buildExpenseDraft({ ...base, currency: 'EU' })).toEqual({
      ok: false,
      error: 'currency-invalid',
    });
    expect(buildExpenseDraft({ ...base, participantMemberIds: [] })).toEqual({
      ok: false,
      error: 'participants-required',
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Round-trip through the repositories
// ─────────────────────────────────────────────────────────────

describe('V4-04 persistence round-trip', () => {
  test('a task keeps category, split, note and photo', async () => {
    const repos = createInMemoryRepositories();
    const cat = await repos.categories.create(
      buildCategoryDraft({
        householdId: HH,
        name: 'Ménage',
        defaultTaskRatio: [
          { memberId: 'm-a', weight: 1 },
          { memberId: 'm-b', weight: 2 },
        ],
      }),
    );

    const built = buildTaskDraft({
      householdId: HH,
      label: 'Aspi salon',
      value: 30,
      unit: 'minutes',
      performedByMemberId: 'm-a',
      beneficiaryMemberIds: ['m-a', 'm-b'],
      occurredAt: '2026-10-09T10:00:00.000Z',
      createdBy: 'user-1',
      category: cat,
      note: 'sous l’évier',
      attachments: [
        {
          id: 'att-1',
          kind: 'photo',
          ref: 'file:///tmp/photo.jpg',
          createdAt: '2026-10-09T10:00:00.000Z',
        },
      ],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const stored = await repos.contributions.create(built.draft);
    const fromStore = await repos.contributions.getById(stored.id);
    expect(fromStore?.categoryId).toBe(cat.id);
    expect(fromStore?.categoryLabelSnapshot).toBe('Ménage');
    expect(fromStore?.splitSource).toBe('category-default');
    expect(fromStore?.splitWeights).toEqual([
      { memberId: 'm-a', weight: 1 },
      { memberId: 'm-b', weight: 2 },
    ]);
    expect(fromStore?.note).toBe('sous l’évier');
    expect(fromStore?.attachments?.[0].ref).toBe('file:///tmp/photo.jpg');
  });

  test('renaming then deleting the category never touches a stored entry', async () => {
    const repos = createInMemoryRepositories();
    const cat = await repos.categories.create(
      buildCategoryDraft({ householdId: HH, name: 'Ménage' }),
    );
    const built = buildTaskDraft({
      householdId: HH,
      label: 'Aspi',
      value: 20,
      unit: 'minutes',
      performedByMemberId: 'm-a',
      beneficiaryMemberIds: ['m-a'],
      occurredAt: '2026-10-09T10:00:00.000Z',
      createdBy: 'user-1',
      category: cat,
    });
    if (!built.ok) throw new Error('draft failed');
    const stored = await repos.contributions.create(built.draft);

    await repos.categories.update(cat.id, renameCategory('Propreté'));
    await repos.categories.delete(cat.id);

    const fromStore: ContributionEntry | null = await repos.contributions.getById(stored.id);
    expect(fromStore?.categoryLabelSnapshot).toBe('Ménage');
    expect(await repos.categories.getByHousehold(HH)).toHaveLength(0);
  });

  test('expense split fields survive an in-memory round-trip', async () => {
    const repos = createInMemoryRepositories();
    const built = buildExpenseDraft({
      householdId: HH,
      title: 'Courses',
      amountMinor: 1000,
      currency: 'CHF',
      paidByMemberId: 'm-a',
      participantMemberIds: ['m-a', 'm-b'],
      splitMode: 'custom',
      customShares: [
        { memberId: 'm-a', amountMinor: 999 },
        { memberId: 'm-b', amountMinor: 1 },
      ],
      occurredAt: '2026-10-09T10:00:00.000Z',
      createdBy: 'user-1',
    });
    if (!built.ok) throw new Error('draft failed');
    const stored = await repos.expenses.create(built.draft);
    const fromStore: ExpenseEntry | null = await repos.expenses.getById(stored.id);
    expect(fromStore?.splitMode).toBe('custom');
    expect(fromStore?.customShares).toEqual([
      { memberId: 'm-a', amountMinor: 999 },
      { memberId: 'm-b', amountMinor: 1 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────
// Category manager safety
// ─────────────────────────────────────────────────────────────

describe('V4-04 category manager — user-created only', () => {
  test('a fresh group starts with zero categories', async () => {
    const repos = createInMemoryRepositories();
    expect(await repos.categories.getByHousehold(HH)).toHaveLength(0);
  });

  test('ratio set/clear is snapshot-safe', () => {
    const ratio = [
      { memberId: 'm-a', weight: 1 },
      { memberId: 'm-b', weight: 2 },
    ];
    const patch = setCategoryDefaultTaskRatio(ratio);
    ratio[0].weight = 9;
    expect(patch.defaultTaskRatio).toEqual([
      { memberId: 'm-a', weight: 1 },
      { memberId: 'm-b', weight: 2 },
    ]);
    expect(setCategoryDefaultTaskRatio(null)).toEqual({ defaultTaskRatio: null });
    expect(setCategoryDefaultTaskRatio([])).toEqual({ defaultTaskRatio: null });
  });
});

// ─────────────────────────────────────────────────────────────
// Photo provider — honest normal build, deterministic E2E build
// ─────────────────────────────────────────────────────────────

describe('V4-04 photo adapters', () => {
  test('the normal build keeps the honest unavailable adapter', async () => {
    const adapter = new LocalAttachmentAdapter();
    expect(adapter.isAvailable()).toBe(false);
    await expect(adapter.pickPhoto()).resolves.toBeNull();
    await expect(adapter.save({ localUri: 'file:///x.jpg' }, HH)).rejects.toThrow(
      ATTACHMENTS_UNAVAILABLE,
    );
  });

  test('the E2E adapter is enabled only when flagged and yields deterministic refs', async () => {
    const off = new E2EAttachmentAdapter(false);
    expect(off.isAvailable()).toBe(false);
    await expect(off.pickPhoto()).resolves.toBeNull();
    await expect(off.save({ localUri: 'file:///x.jpg' }, HH)).rejects.toThrow(
      ATTACHMENTS_UNAVAILABLE,
    );

    const on = new E2EAttachmentAdapter(true);
    expect(on.isAvailable()).toBe(true);
    const source = await on.pickPhoto();
    expect(source).not.toBeNull();
    const first = await on.save(source!, HH);
    const second = await on.save(source!, HH);
    expect(first.ref).toBe(`${E2E_ATTACHMENT_REF_PREFIX}${HH}/1`);
    expect(second.ref).toBe(`${E2E_ATTACHMENT_REF_PREFIX}${HH}/2`);
    expect(first.mimeType).toBe('image/jpeg');
  });
});

// ─────────────────────────────────────────────────────────────
// Screen source: Tâche only, members replace history, native share
// ─────────────────────────────────────────────────────────────

describe('V4-04 Add screen', () => {
  const source = nonCommentLines(
    fs.readFileSync(path.join(ROOT, 'app/(tabs)/add.tsx'), 'utf8'),
  );

  test('the UI never says Contribution (task vocabulary only)', () => {
    expect(source).not.toMatch(/\bContribution\b/);
    expect(source).toContain('add.modeTask');
    expect(source).toContain('add.modeExpense');
  });

  test('categories are user-managed, with no imposed taxonomy', () => {
    expect(source).toContain('add.categoryManage');
    expect(source).toContain('repos.categories.create');
    expect(source).toContain('repos.categories.update');
    expect(source).toContain('repos.categories.delete');
  });

  test('the task form offers equal / category / custom splits', () => {
    expect(source).toContain('add.splitCategory');
    expect(source).toContain('add.splitCustom');
    expect(source).toContain('taskWeightsFromRaw');
  });

  test('note and photo are available on both task and expense', () => {
    expect(source).toContain('add.noteOptional');
    expect(source).toContain('add.photoOptional');
    expect(source).toContain('services.attachments');
  });

  test('the Members section replaces the activity history', () => {
    expect(source).toContain('add.members');
    expect(source).toContain('addMember');
    expect(source).not.toContain('paginateActivityLog');
    expect(source).not.toContain('add.activity');
  });

  test('entries are shared through the injected native share port', () => {
    expect(source).toContain('services.share.share');
    expect(source).toContain('add.shareLast');
  });
});

// ─────────────────────────────────────────────────────────────
// i18n — the new keys exist in FR and EN, with exact French
// ─────────────────────────────────────────────────────────────

describe('V4-04 catalog keys', () => {
  test('every V4-04 key exists in both locales', () => {
    const keys = [
      'add.categoryNone',
      'add.categoryManage',
      'add.categoryCreateAction',
      'add.categoryRatio',
      'add.splitCategory',
      'add.weights',
      'add.photoOptional',
      'add.photoUnavailable',
      'add.members',
      'add.inviteLink',
      'add.shareLast',
    ];
    for (const key of keys) {
      expect(CATALOG.fr[key]).toBeDefined();
      expect(CATALOG.en[key]).toBeDefined();
    }
    expect(CATALOG.fr['add.splitCategory']).toBe('Ratio de la catégorie');
    expect(CATALOG.fr['add.categoryNone']).toBe('Sans catégorie');
    expect(CATALOG.fr['add.members']).toBe('Membres');
  });
});
