# Next cycle

Active criterion: **V3-08 — Finition, accessibilité, coût et release mobile** (repair).

## Objective

Repair the single must-fix finding in the existing V3-08 WIP delta. Do not rebuild — the candidate baseline (package.json + 3 gate scripts, 426 tests passing, privacy/cost gates passing) is the starting point.

## Must-fix finding

### F1 — `scripts/e2e-android.js` requires `CHORESCORE_APK_PATH` that the finalizer never sets

**Path:** `scripts/e2e-android.js` line 205 (docstring line 14)

The script's first try-block statement is:
```js
if (!apkPath || !fs.existsSync(apkPath)) throw new Error(`Unreadable CHORESCORE_APK_PATH: ${apkPath}`);
```

The trusted finalizer emulator step (`.github/workflows/chorescore-v3-finalize.yml` lines 84–94) runs:
```bash
apk=$(find android/app/build/outputs/apk/release -type f -name '*.apk' | head -1)
adb install -r "$apk"
npm run e2e:android
```

There is **no** `CHORESCORE_APK_PATH` env var anywhere in the workflow (grep confirms). The script's own docstring says the variable is "optional if already installed" — the implementation contradicts this.

**Fix:** Make the APK path optional when the package is already installed. Two approaches:

1. Check `adb shell pm list packages <packageName>` first; if installed, skip the install step entirely and only require/use `apkPath` when an install is actually needed.
2. Auto-locate the APK under `android/app/build/outputs/apk/release/` when `CHORESCORE_APK_PATH` is unset.

The script must match its documented contract: "CHORESCORE_APK_PATH — path to the APK (optional if already installed)".

## Verification

- `scripts/e2e-android.js` runs without `CHORESCORE_APK_PATH` when the package is pre-installed
- Script reaches the golden-path steps (tap Ajouter, tap Balances, tap A faire, verify content) instead of throwing at the first guard
- `npx tsc --noEmit` exits 0
- All 426 tests pass across 21 suites
- All V3-01 through V3-07 regression suites pass
- No product code changed (src/, app/, __tests__/ byte-identical to pristine)
