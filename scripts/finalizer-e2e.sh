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
echo "APK: $apk"

# 2. Install on the emulator (idempotent — the E2E script also checks)
adb install -r "$apk"

# 3. Run the golden-path E2E
npm run e2e:android
