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
echo "Waiting for emulator to be fully booted..."
TIMEOUT=180
ELAPSED=0
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  BOOT_COMPLETED=$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)
  if [ "$BOOT_COMPLETED" = "1" ]; then
    echo "Emulator boot completed after ${ELAPSED}s"
    break
  fi
  sleep 5
  ELAPSED=$((ELAPSED + 5))
  echo "  Waiting... (${ELAPSED}s/${TIMEOUT}s)"
done

if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
  echo "WARNING: Emulator boot timeout after ${TIMEOUT}s, proceeding anyway"
fi

# Additional wait for package manager to settle
echo "Waiting for package manager to settle..."
sleep 10

# Verify adb is connected
adb get-state 2>/dev/null || {
  echo "ERROR: adb device not available after emulator boot" >&2
  exit 1
}
echo "adb device state: $(adb get-state)"

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
INSTALL_ATTEMPTS=0
MAX_ATTEMPTS=3
INSTALLED=0
while [ "$INSTALL_ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
  INSTALL_ATTEMPTS=$((INSTALL_ATTEMPTS + 1))
  echo "  Install attempt ${INSTALL_ATTEMPTS}/${MAX_ATTEMPTS}..."
  if adb install -r "$apk" 2>&1; then
    echo "  APK installed successfully on attempt ${INSTALL_ATTEMPTS}"
    INSTALLED=1
    break
  fi
  if [ "$INSTALL_ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; then
    echo "  Install failed, waiting 10s before retry..."
    sleep 10
  fi
done

if [ "${INSTALLED:-0}" -ne 1 ]; then
  echo "ERROR: APK install failed after ${MAX_ATTEMPTS} attempts" >&2
  adb devices -l 2>/dev/null || true
  adb shell pm list packages 2>/dev/null | head -5 || true
  exit 1
fi

# 3. Run the golden-path E2E
echo "Running golden-path E2E..."
npm run e2e:android
