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

  test('dump cache TTL is long enough to cover same-screen rapid calls on slow emulators', () => {
    // On API 35 x86_64, each uiautomator dump takes 30-60s.  A short TTL
    // (<15s) means every findNodes() call triggers a fresh dump, wasting
    // 30-60s per call on rapid successive checks (assertAbsent, screenshot,
    // sequential waitFor).  The TTL must be >= 15s so that same-screen
    // calls share one dump, and invalidated on tap/swipe so post-transition
    // calls always get fresh state.
    const e2e = readRepo('scripts/e2e-android.js');
    // Extract DUMP_CACHE_TTL_MS value, handling JS numeric underscores (e.g. 30_000)
    const ttlMatch = e2e.match(/DUMP_CACHE_TTL_MS\s*=\s*([\d_]+)/);
    expect(ttlMatch).not.toBeNull();
    const ttl = Number(ttlMatch![1].replace(/_/g, ''));
    expect(ttl).toBeGreaterThanOrEqual(15_000);
    // Invalidate on tap (screen transition)
    expect(e2e).toContain('_dumpCache = null');
    // tapNode must invalidate
    expect(e2e).toMatch(/function tapNode[\s\S]*_dumpCache\s*=\s*null/);
    // swipeUp must invalidate
    expect(e2e).toMatch(/function swipeUp[\s\S]*_dumpCache\s*=\s*null/);
  });

  test('all golden path waitFor timeouts are >= 60s (single dump takes 30-60s)', () => {
    // A single uiautomator dump takes 30-60s on API 35 x86_64.
    // waitFor loops by calling findNodes (which triggers a dump) then
    // sleeping 500ms.  If the timeout is < 60s, only 0-1 dump attempts
    // fit, so the element is never found even if visible.
    const e2e = readRepo('scripts/e2e-android.js');
    // Extract all waitFor('label', timeout) calls
    const waitForCalls = [...e2e.matchAll(/waitFor\('[^']+',\s*(\d+)\)/g)];
    expect(waitForCalls.length).toBeGreaterThan(0);
    for (const [, ms] of waitForCalls) {
      expect(Number(ms)).toBeGreaterThanOrEqual(60_000);
    }
  });

  test('dumpsys activity pre-check in launch() is bounded to <= 20s', () => {
    // The dumpsys activity pre-check polls every 5s.  On slow emulators
    // each poll can take 3-5s.  A 12-iteration (60s) poll wastes dead time
    // before the Demarrer window.  3 iterations (15s) is sufficient: the
    // app is either in foreground within 15s or it will appear during the
    // Demarrer waitFor.
    const e2e = readRepo('scripts/e2e-android.js');
    // Find the launch function's dumpsys loop: "for (let i = 0; i < N; i++)"
    const loopMatch = e2e.match(/function launch\(\)[\s\S]*?for\s*\(\s*let\s+i\s*=\s*0\s*;\s*i\s*<\s*(\d+)/);
    expect(loopMatch).not.toBeNull();
    const iterations = Number(loopMatch![1]);
    expect(iterations).toBeLessThanOrEqual(5);
  });

  test('waitFor timeout echoes the current UI dump text nodes for diagnosis', () => {
    // The UI dump XML is only saved to the artifact directory, which is NOT
    // uploaded when the emulator step fails (the upload step has no
    // if: always()).  Echoing the text/content-desc nodes at timeout is the
    // only way the exact on-screen content survives in the step logs, so the
    // next Builder cycle can see whether the app was stuck on "Chargement...",
    // a blank screen, or an error state.
    const e2e = readRepo('scripts/e2e-android.js');
    expect(e2e).toMatch(/function waitFor[\s\S]*UI dump at timeout/);
    expect(e2e).toMatch(/function waitFor[\s\S]*content-desc/);
  });

  test('finalizer diagnostic echo includes the UI dump XML files', () => {
    // Same rationale as above: the checkpoint XML files (post-launch and
    // failure) must be echoed to the step logs so the screen content survives
    // even when the artifact upload is skipped.
    const wrapper = readRepo('scripts/finalizer-e2e.sh');
    expect(wrapper).toContain('UI dump XML files');
    expect(wrapper).toContain('audit/android-e2e/*.xml');
  });

  test('waitFor detects app crash and relaunches instead of waiting full timeout', () => {
    // If the app process dies during a long waitFor (e.g. ANR on API 35
    // x86_64), each dumpUi call returns empty XML and the loop burns
    // through the entire 600 s timeout doing nothing.  The crash-recovery
    // check detects pidof returning empty and relaunches the app, saving
    // up to 10 minutes of wasted wait time.
    const e2e = readRepo('scripts/e2e-android.js');
    expect(e2e).toMatch(/APP CRASHED[\s\S]*relaunch/);
    expect(e2e).toMatch(/pidof[\s\S]*force-stop/);
    expect(e2e).toMatch(/pidof[\s\S]*monkey/);
  });

  test('waitFor distinguishes pidof exit-1 (app dead) from transport errors', () => {
    // Android toybox pidof exits with status 1 when no process matches.
    // This is the primary signal that the app has crashed.  When
    // execFileSync throws, the catch block must check err.status === 1
    // to trigger the relaunch branch, and treat other errors (transport
    // ETIMEDOUT, adb disconnect) as 'continue normal wait'.
    const e2e = readRepo('scripts/e2e-android.js');
    // The catch block must check err.status === 1 (pidof no-process exit)
    expect(e2e).toMatch(/catch\s*\(\s*err\s*\)/);
    expect(e2e).toMatch(/err\.status\s*===\s*1/);
    // On status === 1, the relaunch path must execute (force-stop + monkey)
    expect(e2e).toMatch(/pidof exit 1[\s\S]*force-stop/);
    expect(e2e).toMatch(/pidof exit 1[\s\S]*monkey/);
    // On status === 1, the code must invalidate the dump cache
    expect(e2e).toMatch(/pidof exit 1[\s\S]*_dumpCache\s*=\s*null/);
    // On status === 1, the code must sleep and continue (not throw)
    expect(e2e).toMatch(/pidof exit 1[\s\S]*continue/);
    // Transport errors must NOT trigger the relaunch branch
    expect(e2e).toMatch(/Transport or other adb error/);
  });

  test('launch() warms up uiautomator server before golden path begins', () => {
    // On API 35 x86_64 under React Native cold-start load, the uiautomator
    // server can take 30-60s to initialize and often fails on the first dump.
    // Without a warm-up, the first dumpUi() in the golden path is a cold
    // start that burns 30-60s and often cascades into timeout failures.
    // A warm-up dump at the end of launch() forces the server to initialize,
    // so the first real dumpUi() in the golden path succeeds immediately.
    const e2e = readRepo('scripts/e2e-android.js');
    // The launch function must contain a uiautomator warm-up dump
    expect(e2e).toMatch(/function launch\(\)[\s\S]*Warming up uiautomator server/);
    // The warm-up must be best-effort (wrapped in try/catch)
    expect(e2e).toMatch(/Warming up uiautomator server[\s\S]*try\s*\{/);
    expect(e2e).toMatch(/Warming up uiautomator server[\s\S]*WARN.*warm-up/);
    // The warm-up must cache the result so the first findNodes() reuses it
    expect(e2e).toMatch(/Warming up uiautomator server[\s\S]*_dumpCache\s*=\s*\{/);
  });

  test('uiautomator dump timeout is >= 60s for degraded API 35 emulators', () => {
    // Each uiautomator dump on API 35 x86_64 under React Native cold-start
    // load can take 30-60s.  A 45s timeout caused intermittent failures
    // where the dump was killed mid-transfer, producing empty XML and
    // wasting the entire investment.  60s gives sufficient headroom.
    const e2e = readRepo('scripts/e2e-android.js');
    const dumpMatch = e2e.match(/uiautomator.*dump.*timeoutMs:\s*([\d_]+)/);
    expect(dumpMatch).not.toBeNull();
    const timeout = Number(dumpMatch![1].replace(/_/g, ''));
    expect(timeout).toBeGreaterThanOrEqual(60_000);
  });

  test('screenshot reuses cached dump instead of triggering fresh uiautomator dump', () => {
    // Each fresh uiautomator dump takes 30-60s on slow emulators.
    // Screenshots are diagnostic-only and don't affect golden-path
    // pass/fail.  Reusing a fresh cache (already < 30s old from the
    // most recent findNodes/tapNode) avoids 8 redundant 30-60s dumps
    // across the golden path.
    const e2e = readRepo('scripts/e2e-android.js');
    // The screenshot function should check cache freshness before dumping
    expect(e2e).toMatch(/function screenshot[\s\S]*cacheFresh/);
    expect(e2e).toMatch(/function screenshot[\s\S]*_dumpCacheTime/);
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

  test('finalizer wrapper does not unconditionally restart adb server before golden path', () => {
    // Previous cycles restarted the adb server after emulator boot but
    // before the golden path.  This destabilised a healthy connection:
    // kill-server + start-server takes 6+s and the uiautomator server on
    // the device may not re-register in time, causing every dumpUi()
    // call to return empty XML and the waitFor('Demarrer') to time out.
    // The E2E script's own adbReconnect() handles truly degraded
    // transport, so the wrapper should verify health instead of blindly
    // restarting.
    const wrapper = readRepo('scripts/finalizer-e2e.sh');
    // Should NOT contain an unconditional adb kill-server before the E2E
    // golden path (the E2E script handles this internally).
    // The wrapper should verify health with get-state instead.
    expect(wrapper).toContain('Verifying adb connection health');
    expect(wrapper).toContain('adb get-state');
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