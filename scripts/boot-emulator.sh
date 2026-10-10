#!/usr/bin/env bash
# ChoreScore V4 — self-contained Android emulator boot + readiness gate.
#
# WHY THIS EXISTS (V4-09 infrastructure repair, strategy change)
# -------------------------------------------------------------
# The trusted finalizer launched the emulator through
# reactivecircus/android-emulator-runner@v2. That action's own
# launchEmulator() runs, immediately after `sys.boot_completed` flips to 1:
#
#     adb -s emulator-5554 shell input keyevent 82
#
# On the unaccelerated GitHub Linux runner (no /dev/kvm, swiftshader GPU)
# the Android `input` service is not always live yet at that instant, so the
# call fails with
#
#     cmd: Failure calling service input: Broken pipe (32)
#
# @actions/exec treats the non-zero exit as fatal, so the WHOLE step aborts
# with exit code 224 — before `scripts/finalizer-e2e.sh` is ever invoked
# (trusted finalizer runs 37909577314, 37976784854 and 38034294332). Run
# 38034294332 is the latest confirmation and adds two facts:
#   * the emulator took 498359 ms to boot (log line "Boot completed in
#     498359 ms"), so the action's 600 s boot budget had almost no margin;
#   * after `sys.boot_completed=1`, the action's own `settings put` returned
#     "cmd: Failure calling service settings: Broken pipe (32)" twice and its
#     `input keyevent 82` returned the same broken pipe, then the step aborted
#     (exit 224) at 07:43:09 — while the x86_64 release build had already
#     succeeded at 07:34:10. Last product step reached: the x86_64 release
#     build. Everything after it failed in Android/ADB infrastructure.
# This is an emulator/ADB infrastructure failure, not a product failure, and
# it cannot be repaired from inside the wrapper because the wrapper never runs.
#
# The strategy therefore changes: instead of depending on the action's
# fragile built-in unlock, the repository owns the emulator lifecycle.
# `scripts/finalizer-e2e.sh` calls this script when no device is attached, so
# the trusted workflow can drop the action step and run the wrapper directly.
# This script waits for a LIVE `input`/`settings` round-trip before returning;
# no `input keyevent 82` is issued until the input service answers for real.
# It also ACTIVELY RECOVERS a dead adb transport instead of only waiting: the
# proven broken-pipe signature is a transport/service failure, so the script
# reconnects and, if needed, restarts the adb server before re-gating. Blind
# waiting (and simply raising timeouts) does not clear it; reconnecting does.
#
# The current action-driven path is unchanged: the wrapper only calls this
# script when `adb get-state` shows no attached device, so existing behaviour
# is preserved while the workflow migrates.
#
# Environment (defaults mirror the finalizer's emulator-runner configuration):
#   API_LEVEL              35
#   ARCH                   x86_64
#   TARGET                 default
#   PROFILE                pixel_6
#   AVD_NAME               chorescore_v4
#   EMULATOR_PORT          5554
#   EMULATOR_BOOT_TIMEOUT  900  (raised from 600 after the 498359 ms boot in
#                                run 38034294332; 600 s left ~100 s margin and
#                                the framework readiness gate runs after it)

set -euo pipefail

API_LEVEL="${API_LEVEL:-35}"
ARCH="${ARCH:-x86_64}"
TARGET="${TARGET:-default}"
PROFILE="${PROFILE:-pixel_6}"
AVD_NAME="${AVD_NAME:-chorescore_v4}"
EMULATOR_PORT="${EMULATOR_PORT:-5554}"
EMULATOR_BOOT_TIMEOUT="${EMULATOR_BOOT_TIMEOUT:-900}"
SERIAL="emulator-${EMULATOR_PORT}"

echo "=== ChoreScore V4 emulator boot ==="
echo "API ${API_LEVEL} / ${TARGET} / ${ARCH} / ${PROFILE} / avd ${AVD_NAME} / ${SERIAL}"

# ── SDK tooling ────────────────────────────────────────────────────────
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$ANDROID_HOME" ]; then
  echo "ERROR: ANDROID_HOME/ANDROID_SDK_ROOT is not set" >&2
  exit 1
fi
export ANDROID_HOME
export ANDROID_SDK_ROOT="$ANDROID_HOME"

resolve_tool() {
  local name="$1" candidate
  candidate="$(command -v "$name" 2>/dev/null || true)"
  if [ -n "$candidate" ]; then
    printf '%s' "$candidate"
    return 0
  fi
  candidate="$ANDROID_HOME/cmdline-tools/latest/bin/$name"
  if [ -x "$candidate" ]; then
    printf '%s' "$candidate"
    return 0
  fi
  echo "ERROR: $name not found (PATH and \$ANDROID_HOME/cmdline-tools/latest/bin)" >&2
  return 1
}

SDKMANAGER="$(resolve_tool sdkmanager)"
AVDMANAGER="$(resolve_tool avdmanager)"
EMULATOR_BIN="$ANDROID_HOME/emulator/emulator"
if [ ! -x "$EMULATOR_BIN" ]; then
  EMULATOR_BIN="$(resolve_tool emulator)"
fi

# ── SDK packages ───────────────────────────────────────────────────────
echo "Installing SDK packages (platform-tools, emulator, platform, system image)..."
yes | "$SDKMANAGER" --sdk_root="$ANDROID_HOME" --licenses >/dev/null 2>&1 || true
"$SDKMANAGER" --sdk_root="$ANDROID_HOME" --install \
  "platform-tools" \
  "emulator" \
  "platforms;android-${API_LEVEL}" \
  "system-images;android-${API_LEVEL};${TARGET};${ARCH}" >/dev/null

# ── AVD creation ───────────────────────────────────────────────────────
export ANDROID_AVD_HOME="${ANDROID_AVD_HOME:-$HOME/.android/avd}"
mkdir -p "$ANDROID_AVD_HOME"
echo "Creating AVD ${AVD_NAME}..."
echo no | "$AVDMANAGER" create avd --force -n "$AVD_NAME" \
  --package "system-images;android-${API_LEVEL};${TARGET};${ARCH}" \
  --device "$PROFILE" >/dev/null
if [ -f "$ANDROID_AVD_HOME/${AVD_NAME}.avd/config.ini" ]; then
  # Match the emulator-runner default of two cores (deterministic slow CI boot).
  printf 'hw.cpu.ncore=2\n' >> "$ANDROID_AVD_HOME/${AVD_NAME}.avd/config.ini"
fi

# ── Launch ─────────────────────────────────────────────────────────────
ACCEL_OPT=""
if [ "$(uname -s)" = "Linux" ] && [ ! -r /dev/kvm ]; then
  ACCEL_OPT="-accel off"
fi
EMULATOR_LOG="${TMPDIR:-/tmp}/chorescore-emulator.log"
echo "Launching emulator (log: $EMULATOR_LOG)..."
# shellcheck disable=SC2086 # ACCEL_OPT must word-split when set
"$EMULATOR_BIN" -port "$EMULATOR_PORT" -avd "$AVD_NAME" \
  -no-window -gpu swiftshader_indirect -no-snapshot -noaudio -no-boot-anim \
  $ACCEL_OPT >"$EMULATOR_LOG" 2>&1 &
EMULATOR_PID=$!
echo "Emulator pid ${EMULATOR_PID}"

# ── Wait for sys.boot_completed ────────────────────────────────────────
echo "Waiting for sys.boot_completed=1 (timeout ${EMULATOR_BOOT_TIMEOUT}s)..."
deadline=$(( $(date +%s) + EMULATOR_BOOT_TIMEOUT ))
booted=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if [ "$(adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)" = "1" ]; then
    booted=1
    break
  fi
  sleep 2
done
if [ "$booted" -ne 1 ]; then
  echo "ERROR: emulator did not reach sys.boot_completed=1 within ${EMULATOR_BOOT_TIMEOUT}s" >&2
  tail -50 "$EMULATOR_LOG" >&2 || true
  exit 1
fi
echo "Emulator booted."

# ── Live readiness gate ────────────────────────────────────────────────
# sys.boot_completed alone is NOT proof that the framework command services
# answer; the exact failure that killed the action was the `input` service.
# Require ADB state=device, the package/activity/input/settings services to be
# registered, and a REAL settings + input round-trip before returning.
live_probe() {
  local out
  out=$(timeout 30 adb -s "$SERIAL" shell settings get system screen_off_timeout 2>&1 | tr -d '\r' || true)
  case "$out" in
    *"Broken pipe"*|*"Failure calling service"*|*"not found"*|*"Unknown"*|*"Error"*) return 1 ;;
  esac
  [ -n "$out" ] || return 1
  # No-op keyevent (KEYCODE_UNKNOWN=0): exercises the exact service whose
  # broken pipe aborted runs 37909577314 / 37976784854.
  out=$(timeout 30 adb -s "$SERIAL" shell input keyevent 0 2>&1 | tr -d '\r' || true)
  case "$out" in
    *"Broken pipe"*|*"Failure calling service"*) return 1 ;;
  esac
  return 0
}

# ── Active adb transport recovery ──────────────────────────────────────
# The exact failure in runs 37909577314, 37976784854 and 38034294332 is
# "Failure calling service input/settings: Broken pipe (32)" immediately
# after boot. Re-issuing the same probe on the same dead transport never
# recovers it, so actively reconnect the adb transport (and restart the
# server when the device stops answering) before re-gating. Bounded: the
# caller decides how many times to invoke this.
recover_adb_transport() {
  local attempt="$1"
  echo "  adb transport recovery ${attempt}: reconnect (broken-pipe signature)" >&2
  timeout 15 adb -s "$SERIAL" reconnect offline >/dev/null 2>&1 || true
  sleep 2
  timeout 15 adb -s "$SERIAL" wait-for-device >/dev/null 2>&1 || true
  # If the transport is still dead, restart the server so the emulator
  # re-registers a fresh transport from scratch.
  if ! timeout 15 adb -s "$SERIAL" get-state >/dev/null 2>&1; then
    echo "  adb transport recovery ${attempt}: restarting adb server" >&2
    timeout 10 adb kill-server >/dev/null 2>&1 || true
    sleep 3
    timeout 15 adb start-server >/dev/null 2>&1 || true
    sleep 2
    timeout 30 adb -s "$SERIAL" wait-for-device >/dev/null 2>&1 || true
  fi
  sleep 2
}

echo "Waiting for framework services (package/activity/input/settings + live probe)..."
ready=0
recoveries=0
for attempt in $(seq 1 120); do
  state=$(adb -s "$SERIAL" get-state 2>/dev/null | tr -d '\r' || true)
  package_state=$(adb -s "$SERIAL" shell service check package 2>/dev/null | tr -d '\r' || true)
  activity_state=$(adb -s "$SERIAL" shell service check activity 2>/dev/null | tr -d '\r' || true)
  input_state=$(adb -s "$SERIAL" shell service check input 2>/dev/null | tr -d '\r' || true)
  settings_state=$(adb -s "$SERIAL" shell service check settings 2>/dev/null | tr -d '\r' || true)
  if [ "$state" = "device" ] \
    && echo "$package_state" | grep -qi found \
    && echo "$activity_state" | grep -qi found \
    && echo "$input_state" | grep -qi found \
    && echo "$settings_state" | grep -qi found \
    && live_probe; then
    echo "Android framework services ready on check ${attempt}/120"
    ready=1
    break
  fi
  echo "  not ready (${attempt}/120): state='${state:-unavailable}' package='${package_state:-unavailable}' activity='${activity_state:-unavailable}' input='${input_state:-unavailable}' settings='${settings_state:-unavailable}'"
  # After a first waiting window, actively recover the transport instead of
  # only polling (bounded to 4 recoveries).
  if [ "$attempt" -ge 20 ] && [ "$recoveries" -lt 4 ] && [ $(( attempt % 20 )) -eq 0 ]; then
    recoveries=$((recoveries + 1))
    recover_adb_transport "$recoveries"
  fi
  sleep 3
done

if [ "$ready" -ne 1 ]; then
  echo "FAILURE_CLASS=infra_android_adb_emulator (emulator/framework services never became live)" >&2
  echo "ERROR: Android framework services did not become ready" >&2
  adb -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null || true
  adb -s "$SERIAL" shell service list 2>/dev/null | head -40 || true
  tail -50 "$EMULATOR_LOG" >&2 || true
  exit 1
fi

# Best-effort unlock; the wrapper's dismiss_keyguard() re-asserts it with
# bounded retries after install. Safe here because the input service just
# answered a live round-trip.
timeout 20 adb -s "$SERIAL" shell input keyevent 82 >/dev/null 2>&1 || true
timeout 20 adb -s "$SERIAL" shell wm dismiss-keyguard >/dev/null 2>&1 || true

echo "EMULATOR_READY=1 serial=${SERIAL}"
echo "Emulator ${SERIAL} is booted and framework services are live."
