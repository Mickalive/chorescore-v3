/**
 * V3-02 — Design system tests
 *
 * Validates the V3 theme tokens exist, are coherent,
 * and contain no warm V2 remnants.
 */

import { colors, spacing, borderRadius, typography, theme } from '../../src/ui/design-system/theme';

describe('V3-02 design system', () => {
  test('colors contain no warm V2 remnants', () => {
    // V2 warm palette should be gone
    expect(colors.background).not.toBe('#FFF8F0'); // warm cream
    expect(colors.primary).not.toBe('#C0512F'); // terracotta
    expect(colors.primaryLight).not.toBe('#F2CC8F'); // amber
    expect(colors.border).not.toBe('#E8E0D8'); // warm gray

    // V3 metallic palette should be present
    expect(colors.background).toBe('#F5F5F7'); // off-white
    expect(colors.text).toBe('#171719'); // graphite
    expect(colors.border).toBe('#D1D1D6'); // metallic
    expect(colors.textSecondary).toBe('#68686D'); // metallic gray
  });

  test('balance colors are desaturated forest green and wine red', () => {
    expect(colors.balancePositive).toBe('#2D6A4F'); // forest green
    expect(colors.balanceNegative).toBe('#9B2226'); // wine red

    // Not aggressive bright green/red
    expect(colors.balancePositive).not.toBe('#00FF00');
    expect(colors.balanceNegative).not.toBe('#FF0000');
  });

  test('typography tokens have correct hierarchy', () => {
    expect(typography.screenTitle.fontSize).toBe(24);
    expect(typography.sectionTitle.fontSize).toBe(18);
    expect(typography.body.fontSize).toBe(16);
    expect(typography.caption.fontSize).toBe(13);
    expect(typography.metric.fontSize).toBe(32);
  });

  test('spacing and borderRadius are consistent', () => {
    expect(spacing.xs).toBe(4);
    expect(spacing.sm).toBe(8);
    expect(spacing.md).toBe(12);
    expect(spacing.lg).toBe(16);
    expect(spacing.xl).toBe(24);

    expect(borderRadius.sm).toBe(6);
    expect(borderRadius.md).toBe(10);
  });

  test('shadows are subtle (V3 metallic, not heavy V2)', () => {
    expect(theme.shadows.small.shadowOpacity).toBeLessThan(0.1);
    expect(theme.shadows.medium.shadowOpacity).toBeLessThan(0.1);
  });

  test('complete theme object is exported', () => {
    expect(theme.colors).toBeDefined();
    expect(theme.spacing).toBeDefined();
    expect(theme.borderRadius).toBeDefined();
    expect(theme.typography).toBeDefined();
    expect(theme.shadows).toBeDefined();
  });
});
