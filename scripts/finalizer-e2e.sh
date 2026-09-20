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

# 0. Wait for emulator to be fully booted
# API 35 x86_64 emulators on GitHub Actions can take 120-240s to boot.
# We use 300s (5 min) to handle slow cold starts.
echo "Waiting for emulator to be fully booted..."
TIMEOUT=300
ELAPSED=0
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  BOOT_COMPLETED=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)
  if [ "$BOOT_COMPLETED" = "1" ]; then
    echo "Emulator boot completed after ${ELAPSED}s"
    break
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  # Log every 30s to avoid excessive output
  if [ $((ELAPSED % 30)) -eq 0 ]; then
    echo "  Waiting for boot... (${ELAPSED}s/${TIMEOUT}s)"
  fi
done

if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
  echo "WARNING: Emulator boot timeout after ${TIMEOUT}s, proceeding anyway"
  echo "Boot state diagnostics:"
  echo "  sys.boot_completed: $(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || echo 'unavailable')"
  echo "  ro.build.version.sdk: $(adb shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r' || echo 'unavailable')"
  echo "  init.svc.bootanim: $(adb shell getprop init.svc.bootanim 2>/dev/null | tr -d '\r' || echo 'unavailable')"
fi

# Additional wait for package manager and runtime to settle (API 35 x86_64 can be slow)
# 15s is sufficient — the E2E script's launch() polls dumpsys activity for up
# to 60s and provides additional headroom for any remaining initialization.
echo "Waiting for package manager to settle (15s)..."
sleep 15

# Verify adb is connected and log device state
adb get-state 2>/dev/null || {
  echo "ERROR: adb device not available after emulator boot" >&2
  exit 1
}
echo "adb device state: $(adb get-state)"
echo "adb devices:"
adb devices -l 2>/dev/null || true

# Verify adb connection health WITHOUT restarting the server.
# Previous cycles restarted the adb server here to "ensure a clean connection
# after the heavy boot phase", but this actually destabilised a healthy
# connection: kill-server + start-server takes 6+s and the subsequent
# uiautomator server initialization on the device can stall, causing the
# golden-path waitFor('Demarrer') to time out because every dumpUi() call
# in the E2E script returns empty XML (the uiautomator server hasn't
# re-registered with the new adb server yet).  The E2E script's own
# adbReconnect() already handles truly degraded transport, so an
# unconditional restart here is counter-productive.
echo "Verifying adb connection health..."
for i in 1 2 3; do
  if adb get-state 2>/dev/null | grep -q device; then
    echo "adb connection healthy on attempt ${i}"
    break
  fi
  echo "  adb state check attempt ${i} failed, waiting 3s..."
  sleep 3
done
echo "adb device state: $(adb get-state 2>/dev/null || echo 'unknown')"
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
echo "Installing APK..."
echo "APK file: $apk ($(stat -c%s "$apk") bytes, $(sha256sum "$apk" | awk '{print $1}'))"
INSTALL_ATTEMPTS=0
MAX_ATTEMPTS=3
INSTALLED=0
while [ "$INSTALL_ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
  INSTALL_ATTEMPTS=$((INSTALL_ATTEMPTS + 1))
  echo "  Install attempt ${INSTALL_ATTEMPTS}/${MAX_ATTEMPTS}..."
  INSTALL_OUTPUT=$(adb install -r "$apk" 2>&1) && INSTALL_EXIT=0 || INSTALL_EXIT=$?
  echo "  Install exit: $INSTALL_EXIT"
  echo "  Install output: $INSTALL_OUTPUT"
  if [ "$INSTALL_EXIT" -eq 0 ]; then
    echo "  APK installed successfully on attempt ${INSTALL_ATTEMPTS}"
    INSTALLED=1
    break
  fi
  if [ "$INSTALL_ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; then
    echo "  Install failed, waiting 15s before retry..."
    sleep 15
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
echo "Running golden-path E2E..."
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
