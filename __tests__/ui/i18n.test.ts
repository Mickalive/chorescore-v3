import * as fs from 'fs';
import * as path from 'path';

import {
  CATALOG,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  resolveString,
  unitShortLabel,
} from '../../src/i18n/catalog';

const ROOT = path.resolve(__dirname, '../..');
const APP_DIR = path.join(ROOT, 'app');

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

function isComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

describe('V4-02 i18n catalog', () => {
  test('exposes the supported locales and French default', () => {
    expect([...SUPPORTED_LOCALES]).toEqual(['fr', 'en']);
    expect(DEFAULT_LOCALE).toBe('fr');
  });

  test('FR and EN catalogs have identical keys', () => {
    const frKeys = Object.keys(CATALOG.fr).sort();
    const enKeys = Object.keys(CATALOG.en).sort();
    expect(enKeys).toEqual(frKeys);
    expect(frKeys.length).toBeGreaterThan(0);
  });

  test('every value is non-empty and has no forbidden wording', () => {
    const forbidden = /\b(contribution|premium|paywall|abonnement|subscription|chrono|démo|demo|standard)\b/i;
    for (const locale of SUPPORTED_LOCALES) {
      for (const [key, value] of Object.entries(CATALOG[locale])) {
        expect(value.length).toBeGreaterThan(0);
        expect(`${key}=${value}`).not.toMatch(forbidden);
      }
    }
  });

  test('French accents and nouns are exact on the main journey', () => {
    expect(resolveString('fr', 'tabs.todo')).toBe('À faire');
    expect(resolveString('fr', 'add.modeTask')).toBe('Tâche');
    expect(resolveString('fr', 'add.modeExpense')).toBe('Dépense');
    expect(resolveString('fr', 'add.category')).toBe('Catégorie');
    expect(resolveString('fr', 'add.split')).toBe('Répartition');
    expect(resolveString('fr', 'add.beneficiaries')).toBe('Fait pour');
    expect(resolveString('fr', 'add.performedBy')).toBe('Fait par');
    expect(resolveString('fr', 'groups.create')).toBe('Créer un groupe');
    expect(resolveString('fr', 'groups.generalOptions')).toBe('Options générales');
    expect(resolveString('fr', 'groupOptions.unitProvenance')).toContain('unité');
    expect(resolveString('fr', 'balances.activity')).toBe('Activité');
    expect(resolveString('fr', 'todos.title')).toBe('À faire');
    expect(resolveString('fr', 'options.privacyDataTitle')).toBe('Données et recherche');
  });

  test('interpolates named parameters and falls back to French', () => {
    expect(resolveString('fr', 'groups.memberMany', { count: 3 })).toBe('3 membres');
    expect(resolveString('en', 'groups.memberMany', { count: 3 })).toBe('3 members');
    expect(resolveString('fr', 'invite.shareMessage', { group: 'Coloc', link: 'l' }))
      .toBe('Rejoins Coloc sur ChoreScore : l');
    // Unknown locale falls back to FR; unknown key returns the key.
    expect(resolveString('de' as 'fr', 'tabs.todo')).toBe('À faire');
    expect(resolveString('fr', 'missing.key')).toBe('missing.key');
  });

  test('unit short labels are localized', () => {
    expect(unitShortLabel('minutes', 'fr')).toBe('min');
    expect(unitShortLabel('points', 'fr')).toBe('pts');
    expect(unitShortLabel('points', 'en')).toBe('pts');
  });
});

describe('V4-02 visible screens are localized', () => {
  const screenFiles = [
    'app/index.tsx',
    'app/general-options.tsx',
    'app/group-options.tsx',
    'app/invite.tsx',
    'app/join/[token].tsx',
    'app/(tabs)/_layout.tsx',
    'app/(tabs)/add.tsx',
    'app/(tabs)/balances.tsx',
    'app/(tabs)/todos.tsx',
  ];

  test('the main-path screens consume useI18n', () => {
    for (const rel of screenFiles) {
      const full = path.join(ROOT, rel);
      expect(fs.existsSync(full)).toBe(true);
      const source = fs.readFileSync(full, 'utf8');
      expect(source).toMatch(/useI18n/);
    }
  });

  test('every static t() key used by a screen exists in the catalog', () => {
    const used = new Set<string>();
    const files = fs.existsSync(APP_DIR) ? walk(APP_DIR) : [];
    const keyPattern = /\bt\(\s*['"]([A-Za-z0-9_.]+)['"]/g;
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      let match: RegExpExecArray | null;
      while ((match = keyPattern.exec(source)) !== null) {
        used.add(match[1]);
      }
    }
    expect(used.size).toBeGreaterThan(0);
    const missing = [...used].filter((key) => !(key in CATALOG.fr));
    expect(missing).toEqual([]);
  });

  test('no non-accented or forbidden French literal in app screens', () => {
    // These literals must never be hardcoded in the UI layer: either they are
    // missing accents, they are V3 wording replaced by V4, or they describe a
    // removed product concept.
    const forbiddenLiterals: RegExp[] = [
      /\bA faire\b/,
      /\bDepense(s)?\b/,
      /\bCategorie(s)?\b/,
      /\bRepartition\b/,
      /\bBeneficiaire(s)?\b/,
      /\bEcheance\b/,
      /\bDemarrer\b/,
      /\bContribution\b/,
      /\bPremium\b/i,
      /\bpaywall\b/i,
      /\bchrono\b/i,
    ];

    const files = fs.existsSync(APP_DIR) ? walk(APP_DIR) : [];
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (isComment(line)) return;
        if (!/['"`]/.test(line)) return;
        for (const pattern of forbiddenLiterals) {
          if (pattern.test(line)) {
            violations.push(
              `${path.relative(ROOT, file)}:${index + 1} ${line.trim()}`,
            );
          }
        }
      });
    }
    expect(violations).toEqual([]);
  });
});
