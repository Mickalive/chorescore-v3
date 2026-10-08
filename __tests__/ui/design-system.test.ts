/**
 * V4-02 — Design system tests
 *
 * Validates the V4 theme restores the canonical warm V2 palette
 * (docs/V4_CONSTITUTION.md §1) while keeping a sober, mature execution.
 */

import * as fs from 'fs';
import * as path from 'path';

import { colors, spacing, borderRadius, typography, theme } from '../../src/ui/design-system/theme';

const ROOT = path.resolve(__dirname, '../..');

describe('V4-02 design system — warm V2 palette', () => {
  test('colors expose the exact canonical V2 warm palette', () => {
    expect(colors.background).toBe('#FFF8F0'); // warm cream
    expect(colors.surface).toBe('#FFFFFF');
    expect(colors.surfaceAlt).toBe('#FFF0E6');
    expect(colors.surfaceHighlight).toBe('#FFE8D6');
    expect(colors.primary).toBe('#C0512F'); // terracotta
    expect(colors.primaryLight).toBe('#F2CC8F'); // amber
    expect(colors.primaryDark).toBe('#9A3A1B');
    expect(colors.text).toBe('#3D405B');
    expect(colors.textSecondary).toBe('#5A7260');
    expect(colors.textMuted).toBe('#606070');
    expect(colors.border).toBe('#E8E0D8');
    expect(colors.divider).toBe('#F0E8E0');

    // V3 metallic palette must be gone
    expect(colors.background).not.toBe('#F5F5F7');
    expect(colors.text).not.toBe('#171719');
    expect(colors.border).not.toBe('#D1D1D6');
    expect(colors.textSecondary).not.toBe('#68686D');
  });

  test('balance colors are desaturated sage and deep brick', () => {
    expect(colors.balancePositive).toBe('#5D8C6F'); // deep sage
    expect(colors.balanceNegative).toBe('#9A3A1B'); // deep brick

    // Not aggressive bright green/red
    expect(colors.balancePositive).not.toBe('#00FF00');
    expect(colors.balanceNegative).not.toBe('#FF0000');
    // Not the V3 forest/wine pair either
    expect(colors.balancePositive).not.toBe('#2D6A4F');
    expect(colors.balanceNegative).not.toBe('#9B2226');
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

  test('shadows stay subtle and controlled', () => {
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

describe('V4-02 shell safe areas', () => {
  test('pushed stack screens respect top and bottom safe-area edges', () => {
    const stackScreens = [
      'app/index.tsx',
      'app/general-options.tsx',
      'app/group-options.tsx',
      'app/invite.tsx',
      'app/join/[token].tsx',
    ];
    for (const rel of stackScreens) {
      const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(source).toContain("edges={['top', 'bottom']}");
    }
  });

  test('tab screens leave the bottom edge to the React Navigation tab bar', () => {
    const tabScreens = [
      'app/(tabs)/add.tsx',
      'app/(tabs)/balances.tsx',
      'app/(tabs)/todos.tsx',
    ];
    for (const rel of tabScreens) {
      const source = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(source).not.toContain("edges={['top', 'bottom']}");
    }
  });
});
