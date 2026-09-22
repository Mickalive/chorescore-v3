#!/usr/bin/env bash
# ChoreScore V3 — Finalizer E2E single-line invocation
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

set -euo pipefail

echo "=== ChoreScore V3 finalizer E2E ==="
echo "Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

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

exit "$E2E_EXIT"
