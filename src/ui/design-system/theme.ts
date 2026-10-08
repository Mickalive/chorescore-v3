/**
 * ChoreScore V4 — Design System Theme
 *
 * Warm V2 palette restored, with a more mature and polished execution.
 * Reference palette is canonical: docs/V4_CONSTITUTION.md §1.
 *
 * - Terracotta / cream / sage warm palette
 * - Dense but breathable composition, controlled spaces
 * - Audited balance colors only (deep sage / deep brick)
 * - No gamification, no crypto/neobank flash, no gratuitous gradients
 */

export const colors = {
  // Base palette — canonical V2 warm
  background: '#FFF8F0',    // Warm cream
  surface: '#FFFFFF',       // Clean white
  surfaceAlt: '#FFF0E6',    // Soft warm surface
  surfaceHighlight: '#FFE8D6', // Warm highlight

  // Primary text hierarchy — all meet WCAG AA 4.5:1 on surfaces
  text: '#3D405B',          // Deep ink
  textSecondary: '#5A7260', // Sage gray-green
  textMuted: '#606070',     // Muted slate
  textOnPrimary: '#FFFFFF',

  // Primary action — warm terracotta
  primary: '#C0512F',
  primaryLight: '#F2CC8F',
  primaryDark: '#9A3A1B',

  // Semantic balance states — canonical and desaturated
  balancePositive: '#5D8C6F',  // Deep sage
  balanceNegative: '#9A3A1B',  // Deep brick

  // Semantic aliases from the canonical V2 palette
  success: '#5D8C6F',
  error: '#C0512F',
  warning: '#7A5614',
  info: '#3D85C6',

  // Borders and dividers — warm
  border: '#E8E0D8',
  divider: '#F0E8E0',

  // Chart palette — warm but sober
  chartColors: [
    '#C0512F',
    '#5A7260',
    '#3D405B',
    '#5D8C6F',
    '#F2CC8F',
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
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  medium: {
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
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
