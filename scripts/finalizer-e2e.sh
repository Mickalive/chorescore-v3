#!/usr/bin/env bash
# ChoreScore V4 — Finalizer E2E single-line invocation
#
# This script runs inside the GitHub Actions android-emulator-runner
# step. The action splits a multi-line `script:` block into separate
# `sh -c` invocations, which breaks variable assignment and `set -o
# pipefail` in dash. This file runs as a SINGLE bash process so all
# variables, options and commands share the same shell.
#
# Usage (workflow):
#   script: bash scripts/finalizer-e2e.sh
#
# The E2E script (npm run e2e:android) already auto-locates the APK
# and skips install when the package is present on the emulator, so
# this wrapper only needs the same logic in one shell.
#
# V4-09: the trusted workflow builds the release APK without
# EXPO_PUBLIC_E2E_AUTH, so the installed app would show the social
# sign-in screen and the golden path could never reach Groups. Expo
# inlines EXPO_PUBLIC_* at bundle time, so the flag cannot be enabled
# at runtime. This wrapper rebuilds the x86_64 release APK with the
# flag set, then clears the E2E-flagged bundle outputs before the
# later arm64 release build so the final artifact never contains the
# deterministic E2E session.

set -euo pipefail

echo "=== ChoreScore V4 finalizer E2E ==="
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── Emulator ownership fallback (V4-09 strategy change) ────────────────
# The trusted workflow historically launched the emulator through
# reactivecircus/android-emulator-runner@v2. That action's own
# launchEmulator() unconditionally runs `adb shell input keyevent 82` right
# after sys.boot_completed flips to 1; on the unaccelerated Linux runner the
# input service is not always live yet, so the call fails with
# "cmd: Failure calling service input: Broken pipe (32)" and @actions/exec
# aborts the WHOLE step with exit 224 — before this wrapper even starts
# (trusted finalizer runs 37909577314, 37976784854). Because that abort
# happens inside the action, hardening this wrapper cannot prevent it.
#
# Strategy change: this wrapper can also OWN the emulator lifecycle. When it
# is invoked from a plain `run:` step (no device attached) it boots and gates
# the emulator itself via scripts/boot-emulator.sh, which waits for a LIVE
# input/settings round-trip before returning. The trusted workflow can then
# drop the fragile action step and run `bash scripts/finalizer-e2e.sh`
# directly. When the action is still used (device already attached) behaviour
# is unchanged.
adb start-server >/dev/null 2>&1 || true
if ! adb get-state 2>/dev/null | grep -q '^device$'; then
  echo "No attached emulator detected — booting one via scripts/boot-emulator.sh"
  bash scripts/boot-emulator.sh
fi
# Bare `adb` calls below then target the booted device deterministically.
export ANDROID_SERIAL="${ANDROID_SERIAL:-emulator-${EMULATOR_PORT:-5554}}"
echo "Target device: ${ANDROID_SERIAL}"

# Probe whether the Android framework command services actually answer a real
# round-trip.  In the trusted finalizer run 37909577314, right after
# sys.boot_completed flipped to 1, the emulator-runner action's own
# `input keyevent 82` and `settings put` both returned
# "cmd: Failure calling service input/settings: Broken pipe (32)".  A service
# can be *listed* by `service check` while system_server is still initializing
# (or restarting), so registration alone is not proof of readiness: probe an
# actual `settings get` AND a no-op `input keyevent` and treat broken-pipe /
# not-found output as not ready.
framework_cmd_ready() {
  local out
  out=$(timeout 30 adb shell settings get system screen_off_timeout 2>&1 | tr -d '\r' || true)
  case "$out" in
    *"Broken pipe"*|*"Failure calling service"*|*"not found"*|*"Unknown"*|*"Error"*) return 1 ;;
  esac
  # An empty answer is also a failure: settings always returns a value.
  [ -n "$out" ] || return 1
  # The exact call that aborted the emulator-runner action was
  # `input keyevent 82`, so probe the input service with a harmless no-op
  # keyevent (KEYCODE_UNKNOWN=0) before letting the golden path start. The
  # gate must never pass while the input service still answers with a
  # broken pipe / failed service call.
  out=$(timeout 30 adb shell input keyevent 0 2>&1 | tr -d '\r' || true)
  case "$out" in
    *"Broken pipe"*|*"Failure calling service"*) return 1 ;;
  esac
  return 0
}

# Wait until Android's framework services are actually available, not merely
# until sys.boot_completed flips to 1. On hosted API 35 emulators adb can be
# reachable while ActivityManager/PackageManager are still absent, and even
# then the command services can fail a live round-trip (runs 37909577314 /
# 37976784854). Require the package/activity/input/settings services to be
# registered AND a real `settings get` + `input keyevent` round-trip to
# succeed before touching the APK.
wait_android_services() {
  local max_checks="${1:-60}"
  local sleep_seconds="${2:-5}"
  local i package_state activity_state input_state settings_state
  echo "Waiting for Android package/activity/input/settings services..."
  for ((i=1; i<=max_checks; i++)); do
    package_state=$(adb shell service check package 2>/dev/null | tr -d '\r' || true)
    activity_state=$(adb shell service check activity 2>/dev/null | tr -d '\r' || true)
    input_state=$(adb shell service check input 2>/dev/null | tr -d '\r' || true)
    settings_state=$(adb shell service check settings 2>/dev/null | tr -d '\r' || true)
    if echo "$package_state" | grep -qi "found" \
      && echo "$activity_state" | grep -qi "found" \
      && echo "$input_state" | grep -qi "found" \
      && echo "$settings_state" | grep -qi "found" \
      && framework_cmd_ready; then
      echo "Android framework services ready on check ${i}/${max_checks}"
      return 0
    fi
    echo "  Services not ready (check ${i}/${max_checks}): package='${package_state:-unavailable}', activity='${activity_state:-unavailable}', input='${input_state:-unavailable}', settings='${settings_state:-unavailable}'"
    sleep "$sleep_seconds"
  done
  echo "ERROR: Android package/activity/input/settings services did not become ready" >&2
  adb shell getprop sys.boot_completed 2>/dev/null || true
  adb shell service list 2>/dev/null | head -40 || true
  return 1
}

# Re-assert the screen unlock with bounded retries.  The emulator-runner action
# sends `input keyevent 82` once after boot, but in run 37909577314 that call
# hit a broken pipe and aborted the step before this wrapper ran.  If a retry
# ever reaches the wrapper with the screen still locked, the golden path's taps
# would land on the keyguard instead of the app, so dismiss it explicitly here
# before install/launch.  Best-effort and bounded: never fails the step.
dismiss_keyguard() {
  local attempt state
  for attempt in 1 2 3 4 5; do
    timeout 20 adb shell input keyevent 82 >/dev/null 2>&1 || true
    timeout 20 adb shell wm dismiss-keyguard >/dev/null 2>&1 || true
    sleep 2
    state=$(timeout 20 adb shell dumpsys window 2>/dev/null | grep -m1 -iE 'mDreamingLockscreen|KeyguardShowing' || true)
    case "$state" in
      *"=true"*) echo "  Keyguard still showing after dismiss attempt ${attempt}/5"; sleep 2 ;;
      *) echo "Keyguard dismissed on attempt ${attempt}/5"; return 0 ;;
    esac
  done
  echo "WARNING: keyguard still showing after dismiss attempts; continuing" >&2
  return 0
}

# 0. Quick boot state check
# The reactivecircus/android-emulator-runner@v2 action already waits for
# sys.boot_completed=1 before running this script.  A short 60s safety loop
# catches the rare case where the action's boot wait returned early (e.g.
# adb transport glitch) while keeping wrapper overhead minimal.  Every
# second saved here is a second available for the E2E golden path.
WRAPPER_START=$(date +%s)
echo "Quick boot state check..."
BOOT_CONFIRMED=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  BOOT_COMPLETED=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)
  if [ "$BOOT_COMPLETED" = "1" ]; then
    echo "Emulator boot confirmed on check ${i}"
    BOOT_CONFIRMED=1
    break
  fi
  echo "  Boot not yet complete (check ${i}/12), waiting 5s..."
  sleep 5
done

if [ "$BOOT_CONFIRMED" -ne 1 ]; then
  echo "WARNING: Emulator boot not confirmed after 60s, proceeding anyway"
  echo "Boot state diagnostics:"
  echo "  sys.boot_completed: $(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || echo 'unavailable')"
  echo "  ro.build.version.sdk: $(adb shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r' || echo 'unavailable')"
  echo "  init.svc.bootanim: $(adb shell getprop init.svc.bootanim 2>/dev/null | tr -d '\r' || echo 'unavailable')"
fi

# Brief settle for package manager (10s vs previous 30s).
# The E2E script's launch() polls dumpsys activity for up to 15s and runs
# a uiautomator warm-up dump, so the wrapper only needs a short settle.
echo "Brief package manager settle (10s)..."
sleep 10

# sys.boot_completed is not sufficient on hosted API 35 runners. Require the
# framework services used by install/launch before touching the APK.
wait_android_services 60 5

# Re-assert the screen unlock before install/launch (see dismiss_keyguard).
dismiss_keyguard

# Suppress ANR/crash dialogs on the emulator.  On unaccelerated API 35
# x86_64 runners (no KVM, swiftshader), SystemUI/Quickstep/launcher3/phone
# ANR dialogs recur every ~30s and stay the FOCUSED window, covering the
# app UI.  Trusted finalizer run 37962372613 burned the entire 21-minute
# golden-path window dismissing dialogs that immediately reappeared while
# the app process stayed healthy (pid alive, MainActivity focused, no app
# ANR).  hide_error_dialogs=1 is the standard CI emulator setting: it
# tells ActivityManagerService not to show ANR/crash dialogs at all, so
# the app UI becomes the top window and uiautomator dumps can see it.
# The E2E script's crash detection uses pidof (process state), not the
# dialog, so crash detection still works.  Best-effort and bounded.
suppress_error_dialogs() {
  timeout 20 adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
  local check
  check=$(timeout 20 adb shell settings get global hide_error_dialogs 2>/dev/null | tr -d '\r' || true)
  echo "hide_error_dialogs set (get -> '${check:-unavailable}')"
}
suppress_error_dialogs

# Verify adb is connected and log device state
adb get-state 2>/dev/null || {
  echo "ERROR: adb device not available after emulator boot" >&2
  exit 1
}
echo "adb device state: $(adb get-state)"
echo "adb devices:"
adb devices -l 2>/dev/null || true

# Quick adb health check (single attempt — the E2E script's own
# adbReconnect() handles truly degraded transport).
echo "Verifying adb connection..."
if adb get-state 2>/dev/null | grep -q device; then
  echo "adb connection healthy"
else
  echo "WARNING: adb state check failed, proceeding anyway"
fi
echo "sys.boot_completed: $(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || echo 'unknown')"
echo "ro.build.version.sdk: $(adb shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r' || echo 'unknown')"

# ── Metro cache invalidation ───────────────────────────────────────────
# Expo inlines EXPO_PUBLIC_* at Babel transform time, but Metro's transform
# cache key does NOT include environment variables (see
# @expo/metro-config/build/babel-transformer.js getCacheKey, which only hashes
# Babel config files).  A warm cache from the earlier non-E2E build would
# therefore be reused and the flag would be silently ignored, leaving the E2E
# session inactive.  Clear the cache before any build whose EXPO_PUBLIC_*
# environment differs from the previous build.
clear_metro_cache() {
  local cache_dir
  cache_dir="$(node -e 'process.stdout.write(require("path").join(require("os").tmpdir(),"metro-cache"))' 2>/dev/null || true)"
  if [ -z "$cache_dir" ]; then
    cache_dir="/tmp/metro-cache"
  fi
  if [ -d "$cache_dir" ]; then
    echo "Clearing Metro transform cache at $cache_dir (EXPO_PUBLIC_* is not part of the cache key)"
    rm -rf "$cache_dir"
  fi
}

# ── E2E session injection (V4-09) ──────────────────────────────────────
# The trusted workflow builds the release APK without EXPO_PUBLIC_E2E_AUTH,
# so the installed app would show the social sign-in screen and the golden
# path could never reach Groups.  Expo inlines EXPO_PUBLIC_* at bundle time,
# so the flag cannot be enabled at runtime.  Rebuild the x86_64 release APK
# here with the flag set, forcing the JS bundle task to re-run (the native
# compile stays cached).  The bundle outputs are deleted again after the E2E
# so the later arm64 release build re-bundles WITHOUT the flag and the final
# artifact never contains the E2E session.
E2E_REBUILT=0
if [ "${EXPO_PUBLIC_E2E_AUTH:-}" != "1" ]; then
  echo "Rebuilding x86_64 release APK with EXPO_PUBLIC_E2E_AUTH=1..."
  export EXPO_PUBLIC_E2E_AUTH=1
  # Delete the JS bundle outputs so Gradle re-runs the bundle task.  Gradle
  # does not track environment variables as task inputs, so without deleting
  # the outputs the task would be UP-TO-DATE and the flag would be ignored.
  rm -rf android/app/build/generated
  rm -rf android/app/build/intermediates/assets
  rm -rf android/app/build/intermediates/merged_assets
  rm -f android/app/build/outputs/apk/release/*.apk
  # Metro's transform cache is keyed independently of EXPO_PUBLIC_* env vars,
  # so the earlier non-E2E build's cached transform of e2eAuthConfig.ts would
  # otherwise be reused and the flag would never reach the bundle.
  clear_metro_cache
  ( cd android && ./gradlew :app:assembleRelease -PreactNativeArchitectures=x86_64 --no-daemon )
  E2E_REBUILT=1
  echo "E2E release APK rebuilt with the deterministic session."
fi

# 1. Locate the release APK
apk=$(find android/app/build/outputs/apk/release -type f -name '*.apk' | head -1)
if [ -z "$apk" ]; then
  echo "ERROR: No release APK found under android/app/build/outputs/apk/release" >&2
  exit 1
fi
if [ ! -s "$apk" ]; then
  echo "ERROR: APK is empty: $apk" >&2
  exit 1
fi
echo "APK: $apk ($(stat -c%s "$apk") bytes)"

# 2. Install on the emulator with retry
# Each install attempt is bounded by timeout(300) to prevent adb hangs
# on degraded emulators.  The previous 120s bound was too short: the API
# 35 x86_64 emulator boots in 5-8 min and a 43MB release APK install
# takes 3-4+ min (observed 208s in run 35650859523).  Runs 35670332996,
# 35678248910, 35684869621 and 35692317866 all failed with 2x120s
# install timeouts and empty output while `pm path` later proved the
# package WAS present — the device-side install completed but the adb
# client was killed before it returned.  The install is therefore bounded
# at 300s per attempt, skipped entirely when the package is already
# present, and falls back to push + pm install via the shell transport.
echo "Installing APK..."
echo "APK file: $apk ($(stat -c%s "$apk") bytes, $(sha256sum "$apk" | awk '{print $1}'))"
INSTALL_ATTEMPTS=0
MAX_ATTEMPTS=2
INSTALLED=0

# Skip install when the package is already present.  The emulator is
# booted fresh by the action (snapshots disabled), so the package can
# only come from a previous install attempt in THIS run — the installed
# APK is the current build.  The E2E script applies the same check.
if adb shell pm list packages app.chorescore.v3 2>/dev/null | grep -q app.chorescore.v3; then
  echo "Package app.chorescore.v3 already installed — skipping install (APK built this run)"
  INSTALLED=1
fi

while [ "$INSTALL_ATTEMPTS" -lt "$MAX_ATTEMPTS" ] && [ "$INSTALLED" -ne 1 ]; do
  INSTALL_ATTEMPTS=$((INSTALL_ATTEMPTS + 1))
  echo "  Install attempt ${INSTALL_ATTEMPTS}/${MAX_ATTEMPTS}..."
  # Restart the adb server before the first install attempt: the emulator
  # start log shows 'Unable to connect to adb daemon on port: 5037' and
  # the adb sync service (used by `adb install`) can hang on degraded
  # API 35 x86_64 emulators.  kill-server + start-server fully restarts
  # the server process; the emulator's adbd re-registers via its
  # broadcast channel.  This is conditional (install only), NOT an
  # unconditional restart before the golden path.
  if [ "$INSTALL_ATTEMPTS" -eq 1 ]; then
    echo "  Restarting adb server before install..."
    timeout 10 adb kill-server >/dev/null 2>&1 || true
    sleep 3
    timeout 10 adb start-server >/dev/null 2>&1 || true
    sleep 2
    timeout 30 adb wait-for-device >/dev/null 2>&1 || true
    sleep 1
    # adb can reconnect before Android's framework services have recovered.
    # Re-gate on PackageManager/ActivityManager after restarting the daemon.
    wait_android_services 60 5
  fi
  INSTALL_OUTPUT=$(timeout 300 adb install -r "$apk" 2>&1) && INSTALL_EXIT=0 || INSTALL_EXIT=$?
  echo "  Install exit: $INSTALL_EXIT"
  echo "  Install output: $INSTALL_OUTPUT"
  if [ "$INSTALL_EXIT" -eq 0 ]; then
    echo "  APK installed successfully on attempt ${INSTALL_ATTEMPTS}"
    INSTALLED=1
    break
  fi
  # Fallback: push + pm install via the shell transport, which is more
  # resilient than the sync service on degraded emulators.
  echo "  adb install failed — trying push + pm install fallback..."
  if timeout 180 adb push "$apk" /data/local/tmp/chorescore-v3.apk >/dev/null 2>&1; then
    PM_OUTPUT=$(timeout 300 adb shell pm install -r /data/local/tmp/chorescore-v3.apk 2>&1) && PM_EXIT=0 || PM_EXIT=$?
    echo "  pm install exit: $PM_EXIT"
    echo "  pm install output: $PM_OUTPUT"
    if [ "$PM_EXIT" -eq 0 ]; then
      echo "  APK installed successfully via push + pm install"
      INSTALLED=1
      break
    fi
  else
    echo "  adb push failed too"
  fi
  if [ "$INSTALL_ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; then
    echo "  Install failed, waiting 10s before retry..."
    sleep 10
  fi
done

if [ "${INSTALLED:-0}" -ne 1 ]; then
  echo "ERROR: APK install failed after ${MAX_ATTEMPTS} attempts" >&2
  echo "--- Device diagnostics ---"
  adb devices -l 2>/dev/null || true
  echo "--- Installed packages (first 10) ---"
  adb shell pm list packages 2>/dev/null | head -10 || true
  echo "--- Disk space ---"
  adb shell df /data 2>/dev/null || true
  echo "--- Package manager state ---"
  adb shell pm path app.chorescore.v3 2>/dev/null || echo "Package not found"
  exit 1
fi

# Post-install: the adb connection is stable after install.  The E2E script's
# adb function handles transient transport issues via its own retry+reconnect
# logic, so an explicit server restart here is unnecessary overhead that
# delays the golden path by ~13s.
echo "Post-install adb state: $(adb get-state 2>/dev/null || echo 'unknown')"

# 3. Run the golden-path E2E
WRAPPER_OVERHEAD=$(($(date +%s) - WRAPPER_START))
echo "Wrapper overhead: ${WRAPPER_OVERHEAD}s (boot check + settle + install)"
echo "Running golden-path E2E... (wrapper overhead included in step timing)"
# Capture pre-E2E logcat for diagnosis of any startup issues
mkdir -p audit/android-e2e
echo "Capturing pre-E2E logcat..."
adb logcat -d -t 200 > audit/android-e2e/logcat-pre-e2e.txt 2>/dev/null || true
set +e
npm run e2e:android
E2E_EXIT=$?
set -e

# Capture logcat for post-mortem regardless of E2E outcome
mkdir -p audit/android-e2e
echo "Capturing logcat for post-mortem..."
adb logcat -d -t 300 > audit/android-e2e/logcat-finalizer.txt 2>/dev/null || true
echo "E2E exit code: $E2E_EXIT"

# ── Diagnostic echo: make evidence survive step failure ────────────────
# GitHub Actions preserves step output (stdout/stderr) in the workflow run
# logs even when a step fails.  Raw step logs require admin API access,
# but the step output IS visible in the GitHub Actions UI and accessible
# via the standard repo token.  By echoing the diagnostic file contents to
# stdout/stderr here, the NEXT Builder cycle can read the actual failure
# cause from the step logs without needing admin rights.
if [ "$E2E_EXIT" -ne 0 ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  E2E FAILED — DIAGNOSTIC EVIDENCE (stdout for step logs)"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""
  echo "--- audit/android-e2e/ directory listing ---"
  ls -la audit/android-e2e/ 2>/dev/null || echo "(directory missing)"
  echo ""
  echo "--- result.json ---"
  cat audit/android-e2e/result.json 2>/dev/null || echo "(result.json missing)"
  echo ""
  echo "--- logcat-finalizer.txt (last 200 lines) ---"
  tail -200 audit/android-e2e/logcat-finalizer.txt 2>/dev/null || echo "(logcat-finalizer.txt missing)"
  echo ""
  echo "--- logcat-failure.txt (last 200 lines) ---"
  tail -200 audit/android-e2e/logcat-failure.txt 2>/dev/null || echo "(logcat-failure.txt missing)"
  echo ""
  echo "--- dumpsys-activities-failure.txt (last 50 lines) ---"
  tail -50 audit/android-e2e/dumpsys-activities-failure.txt 2>/dev/null || echo "(dumpsys-activities-failure.txt missing)"
  echo ""
  echo "--- logcat-wait-* timeout dumps ---"
  for f in audit/android-e2e/logcat-wait-*.txt; do
    if [ -f "$f" ]; then
      echo "=== $(basename "$f") (last 100 lines) ==="
      tail -100 "$f"
    fi
  done
  echo ""
  echo "--- UI dump XML files (screen content at checkpoints) ---"
  for f in audit/android-e2e/*.xml; do
    if [ -f "$f" ]; then
      echo "=== $(basename "$f") ==="
      cat "$f"
    fi
  done
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  END DIAGNOSTIC EVIDENCE"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""
  echo "E2E FAILED — diagnostic evidence echoed to stdout for step logs" >&2
fi

# ── Prevent E2E session leak into the final artifact ───────────────────
# The arm64 release build runs in a later workflow step.  Gradle does not
# track environment variables as task inputs, so if the E2E-flagged bundle
# outputs remain, the arm64 build would reuse the E2E JS bundle.  Delete the
# bundle outputs so the arm64 build re-bundles without EXPO_PUBLIC_E2E_AUTH.
if [ "${E2E_REBUILT:-0}" -eq 1 ]; then
  echo "Clearing E2E-flagged bundle outputs before the arm64 release build..."
  rm -rf android/app/build/generated
  rm -rf android/app/build/intermediates/assets
  rm -rf android/app/build/intermediates/merged_assets
  rm -f android/app/build/outputs/apk/release/*.apk
  # The arm64 build runs in a later workflow step with EXPO_PUBLIC_E2E_AUTH
  # unset.  Metro's cache key ignores env vars, so the E2E-flagged transform
  # must be evicted or the arm64 bundle would embed the E2E session.
  clear_metro_cache
fi

exit "$E2E_EXIT"
