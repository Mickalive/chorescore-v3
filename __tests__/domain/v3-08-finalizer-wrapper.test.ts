/**
 * ChoreScore V3 — V3-08 Finalizer wrapper contract tests
 *
 * Guards the Builder-scoped half of the trusted finalizer repair:
 * the Android API 35 emulator step must run as ONE bash process via
 * `script: bash scripts/finalizer-e2e.sh` (the multi-line `script: |`
 * form is line-split and executed under dash by
 * reactivecircus/android-emulator-runner@v2, where `set -euo pipefail`
 * exits 2). These tests verify, without an emulator:
 *
 *   1. scripts/finalizer-e2e.sh exists and is valid bash;
 *   2. the wrapper contains the complete APK locate/install + golden-path
 *      invocation in a single shell;
 *   3. package.json exposes the `e2e:android` script the wrapper calls;
 *   4. scripts/e2e-android.js is valid node and auto-locates the release
 *      APK under the standard build output directory;
 *   5. every UI label asserted by the E2E golden path exists in the demo
 *      fixture and the app screens (automated fixture alignment).
 *
 * No emulator, adb or network is required: the checks are static file
 * contract checks plus a bash syntax parse, so they run in plain CI.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function repoFileExists(relativePath: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

describe('V3-08 finalizer wrapper contract', () => {
  test('scripts/finalizer-e2e.sh exists and parses as valid bash', () => {
    expect(repoFileExists('scripts/finalizer-e2e.sh')).toBe(true);
    // bash -n must exit 0; a syntax error would fail the trusted finalizer
    // emulator step before the APK install and golden path ever run.
    expect(() =>
      execFileSync('bash', ['-n', path.join(REPO_ROOT, 'scripts', 'finalizer-e2e.sh')], {
        stdio: 'pipe',
      })
    ).not.toThrow();
  });

  test('wrapper runs as a single bash process with the full APK locate/install + golden path', () => {
    const wrapper = readRepo('scripts/finalizer-e2e.sh');
    // Single-shell execution: the wrapper must be self-contained bash.
    expect(wrapper).toContain('#!/usr/bin/env bash');
    expect(wrapper).toContain('set -euo pipefail');
    // APK locate under the standard release output directory.
    expect(wrapper).toContain('find android/app/build/outputs/apk/release');
    expect(wrapper).toContain("name '*.apk'");
    // Empty-APK guard: fail loudly instead of installing nothing.
    expect(wrapper).toContain('No release APK found');
    expect(wrapper).toContain('APK is empty');
    // Install then run the golden path, all in the same shell.
    expect(wrapper).toContain('adb install -r "$apk"');
    expect(wrapper).toContain('npm run e2e:android');
  });

  test('package.json exposes the e2e:android script the wrapper invokes', () => {
    const pkg = JSON.parse(readRepo('package.json'));
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts['e2e:android']).toBe('node scripts/e2e-android.js');
  });

  test('scripts/e2e-android.js exists, parses, and auto-locates the release APK', () => {
    expect(repoFileExists('scripts/e2e-android.js')).toBe(true);
    expect(() =>
      execFileSync('node', ['--check', path.join(REPO_ROOT, 'scripts', 'e2e-android.js')], {
        stdio: 'pipe',
      })
    ).not.toThrow();
    const e2e = readRepo('scripts/e2e-android.js');
    // Auto-locate under the standard build output directory.
    expect(e2e).toContain("'android', 'app', 'build', 'outputs', 'apk', 'release'");
    // Install only when the package is absent (idempotent re-runs).
    expect(e2e).toContain("pm', 'list', 'packages'");
    // Golden path must assert the three V3 tabs and the demo fixture labels.
    expect(e2e).toContain("'Ajouter'");
    expect(e2e).toContain("'Balances'");
    expect(e2e).toContain("'A faire'");
  });
});

describe('V3-08 finalize workflow YAML regression guard', () => {
  test('emulator step uses single-line script form (not multi-line script: |)', () => {
    // Regression guard: the multi-line `script: |` form is line-split by
    // reactivecircus/android-emulator-runner@v2 into separate sh -c invocations
    // under dash, where `set -euo pipefail` exits 2 before the APK install and
    // golden path ever run. The single-line form ensures the wrapper runs as
    // ONE bash process. Earlier runs (e.g. 35293489693, 35315519533, 35333103534)
    // used the multi-line form and failed with exit 2. This guard protects
    // against regressions to the multi-line form; the E2E script itself carries
    // diagnostic instrumentation (timeouts, logcat capture, dump failure logging)
    // to surface any remaining emulator-step issues.
    const workflow = readRepo('.github/workflows/chorescore-v3-finalize.yml');

    // Find the emulator-runner step — the block between `uses: reactivecircus/android-emulator-runner@v2`
    // and the next top-level step or job. YAML steps under `with:` are indented, so grab everything
    // from the `uses:` line to the next step marker (`  - name:` at the same indent level) or job.
    const emulatorStart = workflow.indexOf('uses: reactivecircus/android-emulator-runner@v2');
    expect(emulatorStart).toBeGreaterThanOrEqual(0);
    // Grab a generous window: 800 chars covers the `with:` block including `script:`.
    const emulatorStep = workflow.substring(emulatorStart, emulatorStart + 800);

    // The script directive must be the single-line form, not `script: |`.
    expect(emulatorStep).toContain('script: bash scripts/finalizer-e2e.sh');
    // Explicitly reject the multi-line form that caused the regression.
    expect(emulatorStep).not.toMatch(/script:\s*\|/);
  });
});

describe('V3-08 E2E golden-path fixture alignment', () => {
  test('every label asserted by the E2E script exists in the demo fixture or app screens', () => {
    const e2e = readRepo('scripts/e2e-android.js');
    const fixture = readRepo('src/features/app/demoFixture.ts');
    const rootScreen = readRepo('app/index.tsx');
    const tabsLayout = readRepo('app/(tabs)/_layout.tsx');
    const balancesScreen = readRepo('app/(tabs)/balances.tsx');

    // Labels the E2E script waits for / taps (substring semantics, matching
    // the script's own nodeMatches() includes() behavior).
    const expectedLabels: Array<[string, string]> = [
      // [label, source file that must contain it]
      ['Demarrer', rootScreen], // "Demarrer (demo)" sign-in button
      ['Appartement', fixture], // demo household name
      ['Ajouter', tabsLayout], // tab 1
      ['Balances', tabsLayout], // tab 2
      ['A faire', tabsLayout], // tab 3
      ['Vaisselle du soir', fixture], // demo contribution
      ['Sortir les poubelles', fixture], // demo todo
      ['Alex', fixture], // demo member
      ['Sam', fixture], // demo member
      ['Contribution', balancesScreen], // dual-ledger section title
    ];

    for (const [label, source] of expectedLabels) {
      expect(source).toContain(label);
    }

    // The E2E script must assert the absence of chrono/premium/warm-V2 UI.
    for (const forbidden of ['Chrono', 'Chronometre', 'Duree reelle']) {
      expect(e2e).toContain(`assertAbsent('${forbidden}')`);
    }
    for (const forbidden of ['Premium', 'Essai', 'Standard', 'Pro', 'Gratuit']) {
      expect(e2e).toContain(`assertAbsent('${forbidden}')`);
    }
  });
});