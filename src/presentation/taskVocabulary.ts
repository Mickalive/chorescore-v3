/**
 * ChoreScore V4 — presentation vocabulary (FR / EN)
 *
 * Single source for the user-facing ledger vocabulary of this criterion:
 * the contribution ledger is named **Task / Tâche** everywhere in the UI —
 * the word "Contribution" is an internal/accounting term only.
 *
 * The strings live here (not inline in screens) so V4-02's i18n layer can
 * adopt them without touching the domain, and so this rule stays testable:
 * every value is free of Contribution, Démo, Premium, paywall, chrono and
 * imposed-taxonomy wording, and French accents are exact.
 */

export type SupportedLocale = 'fr' | 'en';

export interface LocalizedText {
  fr: string;
  en: string;
}

/** Resolve a localized string. FR is the default when an unknown locale slips through. */
export function t(text: LocalizedText, locale: SupportedLocale): string {
  return locale === 'en' ? text.en : text.fr;
}

// ── Ledger nouns ───────────────────────────────────────────────

export const LEDGER_NOUN = {
  task: { fr: 'Tâche', en: 'Task' },
  taskPlural: { fr: 'Tâches', en: 'Tasks' },
  expense: { fr: 'Dépense', en: 'Expense' },
  expensePlural: { fr: 'Dépenses', en: 'Expenses' },
  balance: { fr: 'Balance', en: 'Balance' },
  balances: { fr: 'Balances', en: 'Balances' },
  settlement: { fr: 'Compensation', en: 'Settlement' },
  category: { fr: 'Catégorie', en: 'Category' },
  categories: { fr: 'Catégories', en: 'Categories' },
  note: { fr: 'Note', en: 'Note' },
  photo: { fr: 'Photo', en: 'Photo' },
  split: { fr: 'Répartition', en: 'Split' },
  members: { fr: 'Membres', en: 'Members' },
} as const;

/** Label for a single ledger entry kind ('task' | 'expense'). */
export function ledgerNounLabel(
  kind: 'task' | 'expense',
  locale: SupportedLocale
): string {
  return t(kind === 'task' ? LEDGER_NOUN.task : LEDGER_NOUN.expense, locale);
}

// ── Screens & actions ──────────────────────────────────────────

export const SCREEN_LABEL = {
  add: { fr: 'Ajouter', en: 'Add' },
  addTask: { fr: 'Ajouter une tâche', en: 'Add a task' },
  addExpense: { fr: 'Ajouter une dépense', en: 'Add an expense' },
  balances: { fr: 'Balances', en: 'Balances' },
  todo: { fr: 'À faire', en: 'To do' },
  groups: { fr: 'Groupes', en: 'Groups' },
  options: { fr: 'Options', en: 'Options' },
  createGroup: { fr: 'Créer un groupe', en: 'Create a group' },
} as const;

export const ACTION_LABEL = {
  save: { fr: 'Enregistrer', en: 'Save' },
  edit: { fr: 'Modifier', en: 'Edit' },
  delete: { fr: 'Supprimer', en: 'Delete' },
  share: { fr: 'Partager', en: 'Share' },
  addMember: { fr: 'Ajouter', en: 'Add' },
  complete: { fr: 'Terminer', en: 'Complete' },
} as const;

// ── Member identity ────────────────────────────────────────────

/**
 * A group can hold named members (created from a name, no account yet) and
 * linked members (joined with an account). Both are full member identities;
 * the labels only make the distinction visible.
 */
export const MEMBER_IDENTITY_LABEL = {
  named: { fr: 'Membre nommé', en: 'Named member' },
  linked: { fr: 'Membre lié', en: 'Linked member' },
} as const;

export function memberIdentityLabel(
  kind: 'named' | 'linked',
  locale: SupportedLocale
): string {
  return t(MEMBER_IDENTITY_LABEL[kind], locale);
}

// ── Task split ─────────────────────────────────────────────────

export const SPLIT_LABEL = {
  equal: { fr: 'Égal', en: 'Equal' },
  custom: { fr: 'Personnalisé', en: 'Custom' },
  categoryDefault: { fr: 'Ratio de la catégorie', en: 'Category ratio' },
} as const;

export function splitSourceLabel(
  source: 'equal' | 'custom' | 'category-default',
  locale: SupportedLocale
): string {
  if (source === 'equal') return t(SPLIT_LABEL.equal, locale);
  if (source === 'custom') return t(SPLIT_LABEL.custom, locale);
  return t(SPLIT_LABEL.categoryDefault, locale);
}
