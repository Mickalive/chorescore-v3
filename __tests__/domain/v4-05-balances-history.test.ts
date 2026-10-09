/**
 * V4-05 — Balances : historique interactif (modifier / supprimer / partager)
 *
 * Evidence for the V4-05 acceptance list:
 *   - history rows under Balances are actionable, not read-only;
 *   - editing opens the shared Add form through the /edit-entry stack route;
 *   - deleting an old entry replays the ledger and keeps it zero-sum;
 *   - sharing reuses the native share adapter and never raw free text;
 *   - the action labels exist in FR (correct accents) and EN.
 *
 * The UI wiring is asserted from source because the repo has no renderer in
 * the Jest environment; the accounting side is asserted against the real
 * repositories and ledger functions.
 */

import fs from 'fs';
import path from 'path';

import { ContributionEntry, ExpenseEntry } from '../../src/domain/entities';
import { InMemoryContributionEntryRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import { InMemoryExpenseEntryRepository } from '../../src/infrastructure/repositories/InMemoryRepositories';
import {
  calculateContributionBalances,
  contributionLedgerIsZeroSum,
} from '../../src/domain/calculations/contributionLedger';
import {
  calculateFinancialBalances,
  financialLedgerIsZeroSum,
} from '../../src/domain/calculations/expenseLedger';
import { CATALOG } from '../../src/i18n/catalog';

const ROOT = path.resolve(__dirname, '../..');
const HH = 'h-v4-05';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function contribution(overrides: Partial<ContributionEntry> = {}): Omit<ContributionEntry, 'id'> {
  return {
    householdId: HH,
    label: 'Aspi',
    performedByMemberId: 'a',
    beneficiaryMemberIds: ['a', 'b'],
    value: 30,
    unit: 'minutes',
    persistentTaskId: null,
    occurredAt: '2026-10-09T10:00:00.000Z',
    createdBy: 'user-a',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────
// Balances screen wiring
// ─────────────────────────────────────────────────────────────

describe('V4-05 balances screen wiring', () => {
  const balances = readSource('app/(tabs)/balances.tsx');
  const add = readSource('app/(tabs)/add.tsx');
  const layout = readSource('app/_layout.tsx');

  test('history rows are pressable and open an action sheet', () => {
    expect(balances).toContain('setSelectedEntry(entry)');
    expect(balances).toContain('styles.historyRow');
    expect(balances).toContain('accessibilityRole="button"');
    expect(balances).toContain('selectedEntry');
  });

  test('edit pushes the edit-entry stack route with id + kind', () => {
    expect(balances).toContain("pathname: '/edit-entry'");
    expect(balances).toContain('entryId');
    expect(balances).toContain('entryType');
    expect(add).toContain('useLocalSearchParams');
    expect(add).toContain('isEditing');
    expect(layout).toContain('name="edit-entry"');
  });

  test('delete confirms then deletes through the repository and re-emits', () => {
    expect(balances).toContain('handleDeleteEntry');
    expect(balances).toContain('repos.contributions.delete');
    expect(balances).toContain('repos.expenses.delete');
    expect(balances).toContain("emitDataChange('contribution'");
    expect(balances).toContain("emitDataChange('expense'");
  });

  test('share reuses the system share adapter via the shared row formatter', () => {
    expect(balances).toContain('handleShareEntry');
    expect(balances).toContain('services.share.share');
    expect(balances).toContain('formatActivityRow');
  });

  test('edits go through the update builders and can clear stale optional fields', () => {
    expect(add).toContain('taskUpdatePayload');
    expect(add).toContain('expenseUpdatePayload');
    // Explicit undefined assignments are what let an edit remove a note/photo.
    expect(add).toContain('note: draft.note');
    expect(add).toContain('attachments: draft.attachments');
    expect(add).toContain("t('add.update')");
    expect(add).toContain('router.back()');
  });

  test('edit-entry route renders the same Add screen', () => {
    const editEntry = readSource('app/edit-entry.tsx');
    expect(editEntry).toContain("import AddScreen from './(tabs)/add'");
    expect(editEntry).toContain('<AddScreen');
  });
});

// ─────────────────────────────────────────────────────────────
// Ledger integrity across edit + delete
// ─────────────────────────────────────────────────────────────

describe('V4-05 ledger integrity on edit + delete', () => {
  let repo: InMemoryContributionEntryRepository;

  beforeEach(() => {
    repo = new InMemoryContributionEntryRepository();
  });

  test('editing an old task keeps the contribution ledger zero-sum', async () => {
    const created = await repo.create(contribution());
    const before = calculateContributionBalances([created], 'minutes', [], ['a', 'b']);
    expect(contributionLedgerIsZeroSum(before)).toBe(true);

    await repo.update(created.id, { value: 12, modifiedBy: 'user-b' });
    const after = await repo.getByHousehold(HH);
    const balances = calculateContributionBalances(after, 'minutes', [], ['a', 'b']);

    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
    expect(balances.get('a')).toBe(6);
    expect(balances.get('b')).toBe(-6);
  });

  test('deleting an old task removes its effect without breaking zero-sum', async () => {
    const a = await repo.create(contribution());
    await repo.create(contribution({ label: 'Courses', performedByMemberId: 'b' }));

    await repo.delete(a.id);
    const remaining = await repo.getByHousehold(HH);
    const balances = calculateContributionBalances(remaining, 'minutes', [], ['a', 'b']);

    expect(remaining).toHaveLength(1);
    expect(contributionLedgerIsZeroSum(balances)).toBe(true);
  });

  test('an edit can clear an optional note through an explicit undefined', async () => {
    const created = await repo.create(contribution({ note: 'à faire vite' }));
    expect(created.note).toBe('à faire vite');

    const updated = await repo.update(created.id, { note: undefined });
    expect(updated.note).toBeUndefined();
    const reread = await repo.getById(created.id);
    expect(reread?.note).toBeUndefined();
  });

  test('editing an expense keeps the money ledger zero-sum in minor units', async () => {
    const repoExp = new InMemoryExpenseEntryRepository();
    const created = await repoExp.create({
      householdId: HH,
      title: 'Courses',
      amountMinor: 4250,
      currency: 'CHF',
      paidByMemberId: 'a',
      participantMemberIds: ['a', 'b'],
      splitMode: 'equal',
      occurredAt: '2026-10-09T10:00:00.000Z',
      createdBy: 'user-a',
    } as Omit<ExpenseEntry, 'id'>);

    await repoExp.update(created.id, { amountMinor: 1000, modifiedBy: 'user-a' });
    const after = await repoExp.getByHousehold(HH);
    const balances = calculateFinancialBalances(after, 'CHF', [], ['a', 'b']);

    expect(financialLedgerIsZeroSum(balances)).toBe(true);
    expect(balances.get('a')).toBe(500);
    expect(balances.get('b')).toBe(-500);
  });
});

// ─────────────────────────────────────────────────────────────
// i18n keys (FR accents + EN parity)
// ─────────────────────────────────────────────────────────────

describe('V4-05 entry-action copy', () => {
  const requiredKeys = [
    'balances.entryActions',
    'balances.editEntry',
    'balances.editTask',
    'balances.editExpense',
    'balances.deleteEntry',
    'balances.shareEntry',
    'balances.deleteConfirmTask',
    'balances.deleteConfirmExpense',
  ];

  test('every key exists in FR and EN', () => {
    for (const key of requiredKeys) {
      expect(CATALOG.fr[key]).toBeTruthy();
      expect(CATALOG.en[key]).toBeTruthy();
    }
  });

  test('French labels use correct accents and the Task vocabulary', () => {
    expect(CATALOG.fr['balances.editTask']).toBe('Modifier la tâche');
    expect(CATALOG.fr['balances.editExpense']).toBe('Modifier la dépense');
    expect(CATALOG.fr['balances.deleteConfirmTask']).toContain('recalculé');
    expect(CATALOG.fr['balances.deleteEntry']).toBe('Supprimer');
    expect(CATALOG.fr['balances.shareEntry']).toBe('Partager');
  });
});
