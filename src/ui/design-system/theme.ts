/**
 * ChoreScore V3 — Design System Theme
 *
 * Precise, adult, premium aesthetic.
 * Reference: Apple, bunq/Tricount, high-end personal finance tools.
 *
 * - Graphite / off-white / metallic palette
 * - Dense but breathable composition
 * - Semantic balance colors only (forest green / wine red)
 * - No warm terracotta, no self-care, no gamification
 */

export const colors = {
  // Base palette
  background: '#F5F5F7',    // Off-white, near Apple default
  surface: '#FFFFFF',       // Clean white
  surfaceAlt: '#F0F0F2',   // Light metallic surface
  surfaceHighlight: '#E8E8EC', // Subtle highlight

  // Primary text hierarchy — all meet WCAG AA 4.5:1 on all surfaces
  text: '#171719',          // Graphite, near-black
  textSecondary: '#68686D', // Metallic gray
  textMuted: '#8E8E93',     // Light metallic
  textOnPrimary: '#FFFFFF',

  // Primary action
  primary: '#171719',       // Graphite as primary
  primaryLight: '#3A3A3C',
  primaryDark: '#000000',

  // Semantic balance states — desaturated, never aggressive
  balancePositive: '#2D6A4F',  // Forest green
  balanceNegative: '#9B2226',  // Wine red

  // Legacy semantic aliases (mapped to balance states for consistency)
  success: '#2D6A4F',
  error: '#9B2226',
  warning: '#7A5614',
  info: '#3A6EA5',

  // Borders and dividers — metallic
  border: '#D1D1D6',
  divider: '#E5E5EA',

  // Chart palette — muted metallic tones
  chartColors: [
    '#171719',
    '#68686D',
    '#2D6A4F',
    '#9B2226',
    '#3A6EA5',
    '#7A5614',
  ],
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const borderRadius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
};

export const typography = {
  screenTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    letterSpacing: -0.3,
    color: colors.text,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    letterSpacing: -0.2,
    color: colors.text,
  },
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 22,
    color: colors.text,
  },
  bodyBold: {
    fontSize: 16,
    fontWeight: '600' as const,
    lineHeight: 22,
    color: colors.text,
  },
  caption: {
    fontSize: 13,
    fontWeight: '400' as const,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  metric: {
    fontSize: 32,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
    color: colors.text,
  },
  metricUnit: {
    fontSize: 16,
    fontWeight: '400' as const,
    color: colors.textSecondary,
  },
  balance: {
    fontSize: 20,
    fontWeight: '600' as const,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '500' as const,
    letterSpacing: 0.2,
  },
};

export const shadows = {
  small: {
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 2,
    elevation: 1,
  },
  medium: {
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
};

export const theme = {
  colors,
  spacing,
  borderRadius,
  typography,
  shadows,
};

export type Theme = typeof theme;
