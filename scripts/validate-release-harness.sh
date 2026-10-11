#!/usr/bin/env bash
set -euo pipefail

fail() { echo "::error::V4 release harness invariant failed: $*" >&2; exit 1; }

for f in scripts/boot-emulator.sh scripts/finalizer-e2e.sh scripts/e2e-android.js; do
  test -s "$f" || fail "missing $f"
done

bash -n scripts/boot-emulator.sh
bash -n scripts/finalizer-e2e.sh
node --check scripts/e2e-android.js

wrapper=scripts/finalizer-e2e.sh
count_exact() {
  local pattern="$1" expected="$2" label="$3" actual
  actual=$(grep -F -c "$pattern" "$wrapper" || true)
  [[ "$actual" == "$expected" ]] || fail "$label expected $expected occurrence(s), found $actual"
}

count_exact 'mark_step "boot_or_attach"' 1 "boot path"
count_exact 'recover_adb_transport()' 1 "ADB recovery function"
count_exact 'E2E_REBUILT=0' 1 "E2E APK path"
count_exact 'mark_step "apk_locate"' 1 "APK locate path"
count_exact 'echo "Installing APK..."' 1 "APK install path"
count_exact 'mark_step "golden_path"' 1 "golden path"
count_exact 'exit "$E2E_EXIT"' 1 "wrapper terminal exit"

if grep -Fq 'adb kill-server' scripts/boot-emulator.sh scripts/finalizer-e2e.sh; then
  fail "destructive adb kill-server is forbidden after emulator launch"
fi
if grep -Fq "['kill-server']" scripts/e2e-android.js; then
  fail "E2E driver must not kill the adb server"
fi

line_count=$(wc -l < "$wrapper")
(( line_count < 900 )) || fail "finalizer wrapper unexpectedly large ($line_count lines), possible duplicated execution blocks"

echo "V4_RELEASE_HARNESS_INVARIANTS=pass wrapper_lines=$line_count"
