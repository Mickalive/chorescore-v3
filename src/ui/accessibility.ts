/**
 * ChoreScore V3 — Accessibility Utilities
 *
 * WCAG AA compliant helpers for the V3 design system.
 *
 * Design principles (from V3_CONSTITUTION.md §22):
 *   - Graphite on white ≈ 18.1:1 (AAA)
 *   - Graphite on off-white ≈ 16.4:1 (AAA)
 *   - Secondary text on white ≈ 5.1:1 (AA)
 *   - All interactive targets ≥ 44×44 points (iOS) / 48×48 dp (Android)
 */

import { AccessibilityProps, Platform } from 'react-native';
import { typography, colors } from '../design-system/theme';

// ── Color contrast ──────────────────────────────────────────

/**
 * Relative luminance per WCAG 2.1 §1.4.3
 * Formula: L = 0.2126R + 0.7152G + 0.0722B
 */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  const adj = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * adj(r) + 0.7152 * adj(g) + 0.0722 * adj(b);
}

/**
 * WCAG 2.1 contrast ratio between two hex colors.
 * Returns a value between 1 and 21.
 */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Does the color pair meet WCAG AA for normal text (≥4.5:1)?
 */
export function meetsWCAG_AA(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= 4.5;
}

/**
 * Does the color pair meet WCAG AA for large text (≥3:1)?
 */
export function meetsWCAG_AA_Large(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= 3;
}

/**
 * Does the color pair meet WCAG AAA (≥7:1)?
 */
export function meetsWCAG_AAA(fg: string, bg: string): boolean {
  return contrastRatio(fg, bg) >= 7;
}

// ── Pre-validated V3 color pairs ────────────────────────────

/** Primary text on white surface — validated WCAG AAA (18.1:1) */
export const V3_TEXT_ON_SURFACE = {
  fg: colors.text,
  bg: colors.surface,
  ratio: contrastRatio(colors.text, colors.surface),
  level: 'AAA' as const,
};

/** Primary text on off-white background — validated WCAG AAA (16.4:1) */
export const V3_TEXT_ON_BACKGROUND = {
  fg: colors.text,
  bg: colors.background,
  ratio: contrastRatio(colors.text, colors.background),
  level: 'AAA' as const,
};

/** Secondary text on white — validated WCAG AA (5.1:1) */
export const V3_SECONDARY_ON_SURFACE = {
  fg: colors.textSecondary,
  bg: colors.surface,
  ratio: contrastRatio(colors.textSecondary, colors.surface),
  level: 'AA' as const,
};

/** Positive balance (forest green) on white — must meet AA */
export const V3_BALANCE_POSITIVE = {
  fg: colors.balancePositive,
  bg: colors.surface,
  ratio: contrastRatio(colors.balancePositive, colors.surface),
  level: meetsWCAG_AA(colors.balancePositive, colors.surface) ? 'AA' : 'FAIL' as const,
};

/** Negative balance (wine red) on white — must meet AA */
export const V3_BALANCE_NEGATIVE = {
  fg: colors.balanceNegative,
  bg: colors.surface,
  ratio: contrastRatio(colors.balanceNegative, colors.surface),
  level: meetsWCAG_AA(colors.balanceNegative, colors.surface) ? 'AA' : 'FAIL' as const,
};

// ── Touch target ────────────────────────────────────────────

/**
 * Minimum touch target size per platform.
 * iOS: 44×44 pt, Android: 48×48 dp (WCAG 2.5.5).
 */
export const MIN_TOUCH_TARGET = Platform.OS === 'ios'
  ? { width: 44, height: 44 }
  : { width: 48, height: 48 };

/**
 * Wraps any touchable style to ensure it meets the minimum touch target.
 * Adds padding if the element is smaller than the required minimum.
 */
export function ensureTouchTarget(
  style: { width?: number; height?: number; padding?: number; paddingVertical?: number; paddingHorizontal?: number },
): Record<string, number> {
  const w = style.width ?? 0;
  const h = style.height ?? 0;
  const padH = Math.max(0, MIN_TOUCH_TARGET.width - w) / 2;
  const padV = Math.max(0, MIN_TOUCH_TARGET.height - h) / 2;
  return {
    minWidth: MIN_TOUCH_TARGET.width,
    minHeight: MIN_TOUCH_TARGET.height,
    ...(padH > 0 ? { paddingHorizontal: (style.paddingHorizontal ?? 0) + padH } : {}),
    ...(padV > 0 ? { paddingVertical: (style.paddingVertical ?? 0) + padV } : {}),
  };
}

// ── Accessibility props ─────────────────────────────────────

/** Common accessibility props for interactive elements */
export interface AccessiblePressableProps extends AccessibilityProps {
  /** Accessible role — defaults to 'button' for pressable elements */
  accessibilityRole?: AccessibilityProps['accessibilityRole'];
  /** Label read by screen readers */
  accessibilityLabel?: string;
  /** Hint for complex interactions */
  accessibilityHint?: string;
  /** Whether the element is currently disabled */
  accessibilityState?: AccessibilityProps['accessibilityState'];
}

/**
 * Generates standard accessibility props for a button-like element.
 */
export function buttonAccessibilityProps(opts: {
  label: string;
  hint?: string;
  disabled?: boolean;
  loading?: boolean;
}): AccessiblePressableProps {
  return {
    accessibilityRole: 'button',
    accessibilityLabel: opts.label,
    accessibilityHint: opts.hint,
    accessibilityState: {
      disabled: opts.disabled ?? false,
      busy: opts.loading ?? false,
    },
  };
}

/**
 * Generates standard accessibility props for a card-like element.
 */
export function cardAccessibilityProps(opts: {
  label: string;
  hint?: string;
}): AccessibilityProps {
  return {
    accessibilityRole: 'summary',
    accessibilityLabel: opts.label,
    accessibilityHint: opts.hint,
  };
}

/**
 * Generates standard accessibility props for a text element.
 */
export function textAccessibilityProps(opts: {
  label: string;
  isHeader?: boolean;
}): AccessibilityProps {
  return {
    accessibilityRole: opts.isHeader ? 'header' : 'text',
    accessibilityLabel: opts.label,
  };
}

// ── Large text support ──────────────────────────────────────

/**
 * All typography variants with explicit font sizes.
 * React Native automatically scales these with system font size settings.
 * Use these as the base — never use absolute pixel values that bypass scaling.
 */
export const ACCESSIBLE_FONT_SIZES = Object.fromEntries(
  Object.entries(typography).map(([key, val]) => [key, val.fontSize])
);

/**
 * Minimum font size for readability (WCAG 1.4.4 Resize Text).
 * Text should remain readable when scaled up to 200%.
 */
export const MIN_FONT_SIZE = 12;

/**
 * Verifies that all typography variants use readable font sizes.
 * Call in tests to catch accidental regressions.
 */
export function verifyFontSizesReadable(): boolean {
  return Object.values(typography).every(
    (t) => typeof t.fontSize === 'number' && t.fontSize >= MIN_FONT_SIZE
  );
}

// ── Screen reader announcements ─────────────────────────────

/**
 * Standard accessibility labels for V3 domain concepts.
 */
export const ACCESSIBILITY_LABELS = {
  // Navigation
  tabAdd: 'Ajouter',
  tabBalances: 'Balances',
  tabTodo: 'À faire',

  // Tabs within Ajouter
  switchContribution: 'Contribution',
  switchExpense: 'Dépense',

  // Balances section
  balanceContribution: 'Balance de contribution',
  balanceMoney: 'Balance financière',
  balancePositive: 'En avance',
  balanceNegative: 'En retard',

  // Forms
  labelTask: 'Libellé de la tâche',
  labelAmount: 'Montant',
  labelCurrency: 'Devise',
  labelPaidBy: 'Payé par',
  labelParticipants: 'Participants',
  labelFaitPar: 'Fait par',
  labelFaitPour: 'Fait pour',
  labelValue: 'Valeur',

  // Actions
  actionAdd: 'Ajouter',
  actionEdit: 'Modifier',
  actionDelete: 'Supprimer',
  actionComplete: 'Terminer',
  actionCompensate: 'Compenser',

  // States
  stateLoading: 'Chargement…',
  stateEmpty: 'Aucune donnée',
  stateOffline: 'Mode hors ligne',

  // History
  historyContribution: 'Contribution',
  historyExpense: 'Dépense',
  historySettlement: 'Compensation',
} as const;
