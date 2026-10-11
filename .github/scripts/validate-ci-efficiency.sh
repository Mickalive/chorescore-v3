#!/usr/bin/env bash
set -euo pipefail

fail() { echo "::error::CI efficiency invariant failed: $*" >&2; exit 1; }

manual_only() {
  local f="$1"
  grep -q '^  workflow_dispatch:' "$f" || fail "$f must remain manually dispatchable"
  ! grep -q '^  schedule:' "$f" || fail "$f must not have a schedule"
  ! grep -q '^  push:' "$f" || fail "$f must not run on ordinary pushes"
}

manual_only .github/workflows/chorescore-v3-factory.yml
manual_only .github/workflows/chorescore-v3-finalize.yml
manual_only .github/workflows/ci.yml
manual_only .github/workflows/chorescore-v4-factory.yml

v4final=.github/workflows/chorescore-v4-finalize.yml
! grep -q '^  schedule:' "$v4final" || fail "V4 finalizer must not have a schedule"
grep -Fq ".github/trigger-v4-finalizer" "$v4final" || fail "V4 finalizer push trigger must be restricted to its explicit trigger file"
grep -Fq 'cancel-in-progress: true' "$v4final" || fail "V4 finalizer must cancel stale runs"

v4factory=.github/workflows/chorescore-v4-factory.yml
! grep -q 'matrix:' "$v4factory" || fail "V4 factory must not probe a model matrix on every cycle"
grep -Fq 'Probe primary model, fallback only if needed' "$v4factory" || fail "V4 factory must use sequential primary/fallback model probing"

director=.github/scripts/integrate-director-v4.sh
! grep -Eqi 'opencode run|OX_MODEL' "$director" || fail "V4 Director state transitions must remain deterministic and token-free"
grep -Fq 'consecutiveNoProgress' "$director" || fail "V4 factory must track no-progress cycles"
grep -Fq 'no_progress >= 2' "$director" || fail "V4 factory must stop after bounded no-progress cycles"

repairwf=.github/workflows/chorescore-v4-release-repair.yml
! grep -Fq './control/.github/actions/setup-opencode' "$repairwf" || fail "Release Repair must not install OpenCode unconditionally"
repair=.github/scripts/release-repair-v4.sh
grep -Fq 'source "$control/.github/scripts/setup-opencode.sh"' "$repair" || fail "Release Repair must install OpenCode only on the restricted LLM repair path"
grep -Fq 'jest __tests__/domain/v3-08-finalizer-wrapper.test.ts --runInBand' "$repair" || fail "Release Repair must use targeted harness validation"
! grep -Fq 'npm run check' "$repair" || fail "Release Repair must not rerun the entire product test suite"

candidate=.github/scripts/candidate-v4.sh
grep -Fq 'verify-v4.sh candidate-fast' "$candidate" || fail "V4 Builder must use fast candidate verification"
grep -Fq 'Candidate fast verification complete' .github/scripts/verify-v4.sh || fail "V4 trusted verifier must distinguish fast Builder checks from full Auditor checks"

echo "CI_EFFICIENCY_INVARIANTS=pass"
