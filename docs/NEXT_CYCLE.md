# Next cycle

Active criterion: **V3-08 — Finition, accessibilité, coût et release mobile** (repair).

## Objective

Repair the Builder-fixable mustFix (F1) on the preserved V3-08 WIP baseline. Do not rebuild — the candidate baseline (431 tests passing, privacy/cost gates passing, wrapper contract test preserved) is the starting point.

## Must-fix findings

### F1 (Builder scope) — `npx expo install --check` fails with outdated dependencies

**Path:** `package.json` / `package-lock.json`

Trusted verification exits 1 at `npx expo install --check` (`Found outdated dependencies`), before `expo export`/`prebuild`/`assembleRelease` can run. Expected vs installed:

- `expo@57.0.23` → expected `~57.0.24`
- `expo-constants@57.0.18` → expected `~57.0.19`
- `expo-router@57.0.21` → expected `~57.0.22`
- `expo-sharing@57.0.20` → expected `~57.0.21`
- `@expo/metro-runtime@57.0.15` → expected `~57.0.16`

**Fix:** run `npx expo install --fix` (or align `package.json` to the expected versions) and commit `package.json`/`package-lock.json`.

### F2 (trusted-shell only) — finalizer emulator step still uses multi-line `script: |`

**Path:** `.github/workflows/chorescore-v3-finalize.yml` (emulator step, lines 90-94)

`reactivecircus/android-emulator-runner@v2` line-splits the block and executes each line via `sh -c`; dash rejects `set -euo pipefail` (exit 2) before APK install/golden path. Same root cause as finalizer runs 35293489693, 35302658175, 35315519533. The Builder cannot edit workflows (AGENTS.md). Trusted shell must replace the block with `script: bash scripts/finalizer-e2e.sh` on `main` and re-run the finalizer.

## Verification

- `npx expo install --check` exits 0 (no outdated dependencies)
- `npm run check` (typecheck + 431 tests) PASS
- `privacy:check` PASS (71 tests)
- `cost:check` PASS (21 tests, 10 gates)
- `expo export --platform android` and `--platform ios` PASS
- `expo prebuild --platform android --no-install` PASS
- `assembleRelease` builds `app-release.apk`
- WIP delta `__tests__/domain/v3-08-finalizer-wrapper.test.ts` preserved
- V3-01 through V3-07 regression suites pass
- No prohibited patterns introduced (no chrono, paywall, cross-currency netting, silent conversion, destructive history, Firebase in domain, operational ID leakage)

V3-08 final completion belongs to the trusted release finalizer after privacy/cost/APK/install/golden-path evidence.