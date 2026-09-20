# Next cycle

Active criterion: **V3-08 — Finition, accessibilité, coût et release mobile** (repair).

## Objective

Repair the trusted finalizer step-7 failure from Actions run 35505122996. Cycle 35507028007 produced an empty delta (0 files, hasDelta=false) and did not inspect the diagnostic evidence. The next cycle must retrieve and analyze the concrete failure evidence, then repair only the identified blocker.

## Must-fix findings

### F1 (trusted-shell only) — trusted finalizer emulator step failure

**Path:** `.github/workflows/chorescore-v3-finalize.yml` → `scripts/finalizer-e2e.sh` → `scripts/e2e-android.js` (step 7: Android API 35 install, launch and golden path)

**Failed run:** GitHub Actions run 35505122996 (conclusion=failure)
- Step 5 "Trusted product, privacy and cost gates": SUCCESS
- Step 6 "Locate and hash APK": SUCCESS  
- Step 7 "Android API 35 install, launch and golden path": FAILURE (~23m15s)

The step-7 failure is the same emulator E2E step that has failed in all 6 actual emulator runs. The diagnostic instrumentation now captures the exact failure cause via artifacts echoed by `scripts/finalizer-e2e.sh`.

**Required actions for the next cycle:**

1. **Retrieve diagnostic evidence** from run 35505122996 step 7 logs — look for artifacts echoed by `scripts/finalizer-e2e.sh`:
   - `audit/android-e2e/result.json`
   - `logcat-finalizer.txt`
   - `logcat-failure.txt`
   - `dumpsys-activities-failure.txt`
   - `logcat-wait-*` dumps
   - UI dump XML files

2. **Identify the concrete cause** — determine which of these it is:
   - Emulator boot timeout/failure
   - `adb install` failure (APK signing, storage, ABI mismatch)
   - App launch crash (native crash, JS bundle error)
   - Golden-path assertion timeout (UI element not found)
   - ADB transport disconnect/timeout

3. **Repair only the concrete blocker** in product/config/test/scripts while preserving V3-01..V3-07. Protected control-plane files remain trusted-shell owned.

## Verification

- `npx expo install --check` exits 0 (no outdated dependencies)
- `npm run check` (typecheck + 446 tests) PASS
- `privacy:check` PASS (71 tests)
- `cost:check` PASS (21 tests, 10 gates)
- `expo export --platform android` and `--platform ios` PASS
- `expo prebuild --platform android --no-install` PASS
- `assembleDebug` builds successfully
- WIP delta preserved (e2e scripts, finalizer scripts, regression guard test)
- V3-01 through V3-07 regression suites pass
- No prohibited patterns introduced

V3-08 final completion belongs to the trusted release finalizer after privacy/cost/APK/install/golden-path/iOS-readiness evidence. The trusted shell owns final state transitions and V3-08 release handoff.
