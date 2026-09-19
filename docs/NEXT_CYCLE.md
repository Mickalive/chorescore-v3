# Next cycle

Active criterion: **V3-08 — Finition, accessibilité, coût et release mobile** (repair).

## Objective

Repair any remaining V3-08 blocker. The candidate baseline (432 tests passing, privacy/cost gates passing, diagnostic instrumentation for emulator step, wrapper contract test preserved) is the starting point. Do not rebuild from scratch — preserve the existing WIP.

## Must-fix findings

### F1 (trusted-shell only) — trusted finalizer emulator step failure

**Path:** `.github/workflows/chorescore-v3-finalize.yml` → `scripts/finalizer-e2e.sh` → `scripts/e2e-android.js` (step 7: Android API 35 install, launch and golden path)

The trusted finalizer has failed at step 7 in all 6 actual emulator runs. The diagnostic instrumentation added in cycles 35419214459 and 35425284987 now captures the exact failure cause (boot state, install attempts, logcat, dumpsys). The next trusted finalizer run will either:

- **Pass** → V3-08 complete, release finalized
- **Fail with evidence** → the diagnostic logs will identify the concrete blocker (emulator boot timeout, adb install failure, E2E assertion timeout, or other)

**Required fix (if finalizer fails again):** Inspect the diagnostic evidence from the failed run, identify the specific failure cause, and repair only that cause. Do not modify protected control-plane files.

## Verification

- `npx expo install --check` exits 0 (no outdated dependencies)
- `npm run check` (typecheck + 432 tests) PASS
- `privacy:check` PASS (71 tests)
- `cost:check` PASS (21 tests, 10 gates)
- `expo export --platform android` and `--platform ios` PASS
- `expo prebuild --platform android --no-install` PASS
- `assembleRelease` builds `app-release.apk`
- WIP delta preserved (e2e scripts, finalizer scripts, regression guard test)
- V3-01 through V3-07 regression suites pass
- No prohibited patterns introduced

V3-08 final completion belongs to the trusted release finalizer after privacy/cost/APK/install/golden-path/iOS-readiness evidence.
