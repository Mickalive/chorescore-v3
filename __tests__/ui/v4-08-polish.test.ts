/**
 * ChoreScore V4 — V4-08 polish tests
 *
 * Covers the final-polish tranche: legal documents reachable from General
 * options, shared loading/empty/error/persistence states, honest degraded
 * persistence reporting, accessibility labels through i18n (no hardcoded
 * French, no disabled font scaling) and safe-area tab options.
 *
 * Style note: the Jest environment has no React Native renderer, so UI
 * wiring is asserted on the source of the screens (same approach as the
 * V4-02 i18n and design-system suites).
 */

import * as fs from 'fs';
import * as path from 'path';

import { CATALOG } from '../../src/i18n/catalog';
import {
  createRepositoriesWithStatus,
  createRepositories,
} from '../../src/infrastructure/repositories/RepositoryFactory';

const ROOT = path.resolve(__dirname, '../..');
const APP_DIR = path.join(ROOT, 'app');
const SRC_DIR = path.join(ROOT, 'src');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
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

describe('V4-08 legal documents', () => {
  test('a legal screen exists, is localized and is registered in the root stack', () => {
    const legal = read('app/legal.tsx');
    expect(legal).toMatch(/useI18n/);
    expect(legal).toMatch(/useLocalSearchParams/);
    expect(legal).toMatch(/legal\.termsBody/);
    expect(legal).toMatch(/legal\.privacyBody/);
    expect(legal).toMatch(/legal\.noticeBody/);
    expect(legal).toMatch(/legal\.notFoundTitle/);

    const layout = read('app/_layout.tsx');
    expect(layout).toMatch(/<Stack\.Screen name="legal" \/>/);
  });

  test('general options opens the legal screen instead of a stub alert', () => {
    const options = read('app/general-options.tsx');
    expect(options).not.toMatch(/options\.legalUnavailable/);
    expect(options).toMatch(/router\.push\(`\/legal\?doc=/);
    expect(options).toMatch(/openLegal\('terms'\)/);
    expect(options).toMatch(/openLegal\('privacy'\)/);
    expect(options).toMatch(/openLegal\('notice'\)/);
  });

  test('legal catalog keys exist in FR and EN with real content', () => {
    const bodyKeys = ['legal.termsBody', 'legal.privacyBody', 'legal.noticeBody'];
    for (const locale of ['fr', 'en'] as const) {
      for (const key of [
        'legal.title',
        'legal.terms',
        'legal.privacy',
        'legal.notice',
        'legal.updated',
        'legal.openTerms',
        'legal.openPrivacy',
        'legal.openNotice',
        'legal.notFoundTitle',
        'legal.notFoundBody',
        ...bodyKeys,
      ]) {
        expect(CATALOG[locale][key]).toBeDefined();
        expect(CATALOG[locale][key].length).toBeGreaterThan(0);
      }
      for (const key of bodyKeys) {
        expect(CATALOG[locale][key].length).toBeGreaterThan(100);
      }
    }
  });
});

describe('V4-08 shared states', () => {
  test('state components exist and are wired into the main screens', () => {
    const states = read('src/ui/components/States.tsx');
    for (const name of ['LoadingState', 'EmptyState', 'ErrorState', 'InlineNotice', 'PersistenceBanner']) {
      expect(states).toMatch(new RegExp(`export function ${name}`));
    }

    const index = read('app/index.tsx');
    expect(index).toMatch(/LoadingState/);
    expect(index).toMatch(/EmptyState/);
    expect(index).toMatch(/PersistenceBanner/);
    expect(index).toMatch(/persistenceDegraded/);

    const groupOptions = read('app/group-options.tsx');
    expect(groupOptions).toMatch(/LoadingState/);

    const join = read('app/join/[token].tsx');
    expect(join).toMatch(/LoadingState/);
    expect(join).toMatch(/ErrorState/);
  });

  test('shared-state catalog keys exist in FR and EN', () => {
    for (const locale of ['fr', 'en'] as const) {
      for (const key of [
        'state.loadingBody',
        'state.emptyTitle',
        'state.errorTitle',
        'state.errorBody',
        'state.genericError',
        'state.offline',
        'state.persistenceTitle',
        'state.persistenceBody',
      ]) {
        expect(CATALOG[locale][key]).toBeDefined();
      }
    }
  });
});

describe('V4-08 degraded persistence is honest', () => {
  test('createRepositoriesWithStatus reports the backend and degradation', async () => {
    const { repos, backend, degraded } = await createRepositoriesWithStatus();
    expect(repos).toBeDefined();
    // In the Jest environment the in-memory backend is expected, not a
    // degradation: the flag must stay false so no banner appears in tests.
    expect(backend).toBe('memory');
    expect(degraded).toBe(false);
  });

  test('createRepositories keeps its existing contract', async () => {
    const repos = await createRepositories();
    expect(repos.households).toBeDefined();
    expect(repos.contributions).toBeDefined();
    expect(repos.expenses).toBeDefined();
  });

  test('AppContext exposes persistenceDegraded and uses the status factory', () => {
    const context = read('src/features/app/AppContext.tsx');
    expect(context).toMatch(/createRepositoriesWithStatus/);
    expect(context).toMatch(/persistenceDegraded/);
    expect(context).toMatch(/setPersistenceDegraded\(degraded\)/);
  });
});

describe('V4-08 accessibility and large text', () => {
  test('no screen or component disables font scaling', () => {
    const files = [...walk(APP_DIR), ...walk(path.join(SRC_DIR, 'ui'))];
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).not.toMatch(/allowFontScaling=\{false\}/);
      expect(source).not.toMatch(/maxFontSizeMultiplier/);
    }
  });

  test('tab bar exposes accessibility labels, keyboard hiding and scene background', () => {
    const tabs = read('app/(tabs)/_layout.tsx');
    expect(tabs).toMatch(/tabBarAccessibilityLabel/);
    expect(tabs).toMatch(/tabBarHideOnKeyboard: true/);
    expect(tabs).toMatch(/sceneStyle/);
  });

  test('mode switch and chips carry localized accessibility labels', () => {
    const add = read('app/(tabs)/add.tsx');
    expect(add).toMatch(/accessibilityLabel=\{t\('a11y\.modeTask'\)\}/);
    expect(add).toMatch(/accessibilityLabel=\{t\('a11y\.modeExpense'\)\}/);
    expect(add).toMatch(/a11y\.selected/);
    expect(add).toMatch(/a11y\.chooseDateTime/);
  });

  test('accessibility helpers are i18n-backed, not hardcoded French', () => {
    const a11y = read('src/ui/accessibility.ts');
    expect(a11y).not.toMatch(/ACCESSIBILITY_LABELS/);
    expect(a11y).toMatch(/export function accessibilityLabels/);
    expect(a11y).toMatch(/t\('tabs\.add'\)/);
    expect(a11y).toMatch(/t\('balances\.compensate'\)/);
  });

  test('a11y catalog keys exist in FR and EN', () => {
    for (const locale of ['fr', 'en'] as const) {
      for (const key of [
        'a11y.openGroup',
        'a11y.groupOptions',
        'a11y.modeTask',
        'a11y.modeExpense',
        'a11y.selected',
        'a11y.notSelected',
        'a11y.chooseDateTime',
        'a11y.balanceTasks',
        'a11y.balanceMoney',
        'a11y.balancePositive',
        'a11y.balanceNegative',
        'a11y.labelCurrency',
        'a11y.stateEmpty',
        'a11y.historyTask',
        'a11y.historyExpense',
        'a11y.historySettlement',
      ]) {
        expect(CATALOG[locale][key]).toBeDefined();
      }
    }
  });
});

describe('V4-08 missing photo state', () => {
  test('a missing-photo message exists and is rendered when the provider is unavailable', () => {
    expect(CATALOG.fr['add.photoMissing']).toBeDefined();
    expect(CATALOG.en['add.photoMissing']).toBeDefined();
    const add = read('app/(tabs)/add.tsx');
    expect(add).toMatch(/add\.photoMissing/);
    expect(add).toMatch(/attachments\.length > 0 && !attachmentsAvailable/);
  });
});