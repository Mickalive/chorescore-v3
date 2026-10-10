#!/usr/bin/env bash
set -euo pipefail
cycle="${CYCLE_KEY:?}"
out="${RUNNER_TEMP:?}/candidate-builder"
mkdir -p "$out"
criterion=$(jq -r '.builder.criterionId' directives/TASKS.json)
objective=$(jq -r '.builder.objective' directives/TASKS.json)
acceptance=$(jq -c '.builder.acceptance' directives/TASKS.json)

# Read-only references.
git fetch origin +refs/heads/lab/chorescore-v3:refs/remotes/origin/lab/chorescore-v3 || true
if ! git remote get-url v2-reference >/dev/null 2>&1; then
  git remote add v2-reference https://github.com/Mickalive/Chorescore-V2.git
fi
git fetch --depth=1 v2-reference lab/chorescore-v2:refs/remotes/v2-reference/lab/chorescore-v2 || true

# When V4-09 was reopened by the finalizer, make the exact failed logs readable
# to the Builder instead of asking it to guess from a run number.
release_input=""
if [[ "$criterion" == "V4-09" ]]; then
  run_id=$(printf '%s' "$objective" | grep -oE '[0-9]{8,}' | head -1 || true)
  if [[ -n "$run_id" ]]; then
    mkdir -p reports/release-input
    release_input="reports/release-input/FINALIZER_${run_id}.log"
    GH_TOKEN="${GH_TOKEN:?}" gh run view "$run_id" --repo "${GITHUB_REPOSITORY:?}" --log-failed > "$release_input" 2>&1 || true
  fi
fi

set +e
OPENCODE_RETRY_LABEL=builder bash .github/scripts/run-ox.sh opencode run --model "${OX_MODEL:?}" --agent v4-builder "Build ChoreScore V4 factory cycle $cycle. Active criterion: $criterion. Objective: $objective. Acceptance: $acceptance. Start from the validated V3-derived V4 baseline; extend or repair it, never rebuild coherent accepted work. V3 reference: origin/lab/chorescore-v3. V2 visual reference: v2-reference/lab/chorescore-v2. Read every V4 canonical file first. If reports/release-input exists, treat it as trusted failure evidence. Finish one coherent tested tranche."
agent_rc=$?
set -e

verify_log="$out/trusted-verification.log"
set +e
bash .github/scripts/verify-v4.sh candidate > >(tee "$verify_log") 2>&1
verify_rc=$?
set -e

# Ephemeral trusted input and verification artefacts are not product delta.
rm -rf reports/release-input node_modules .expo .expo-shared coverage dist android/.gradle android/app/build android/build ios/Pods ios/build 2>/dev/null || true

git add -A
mapfile -d '' changed < <(git diff --cached --name-only -z HEAD)
count=${#changed[@]}
(( count <= 180 )) || { echo "::error::V4 candidate changed $count files"; exit 4; }
for p in "${changed[@]}"; do
  case "$p" in
    MAIN_PROMPT.md|AGENTS.md|governance/*|directives/*|docs/V4_CONSTITUTION.md|docs/V4_RELEASE_ENGINEERING.md|docs/CI_EFFICIENCY_POLICY.md|docs/V3_BACKEND_FRUGAL.md|docs/ROADMAP.md|docs/RELEASE_STATUS.json|docs/NEXT_CYCLE.md|.github/*|.opencode/*|opencode.json|reports/*)
      echo "::error::V4 Builder changed protected path $p"; exit 5;;
  esac
done

if (( agent_rc != 0 )) && (( count == 0 )); then
  echo "::warning::V4 Builder exited $agent_rc with no delta; continuing to audit evidence"
fi
(( agent_rc == 0 )) || (( count == 0 )) || echo "::warning::Builder exited $agent_rc after producing $count files; preserving candidate"

has=false; verify_only=true; : > "$out/candidate.patch"
if (( count > 0 )); then
  has=true; verify_only=false; git diff --cached --binary HEAD > "$out/candidate.patch"
fi
[[ $verify_rc -eq 0 ]] && verify_passed=true || verify_passed=false
jq -n --arg cycle "$cycle" --arg baseSha "$(git rev-parse HEAD)" --arg criterion "$criterion" --arg objective "$objective" --argjson changedFiles "$count" --argjson hasDelta "$has" --argjson verificationOnly "$verify_only" --argjson agentExitCode "$agent_rc" --argjson trustedVerificationPassed "$verify_passed" --argjson trustedVerificationExitCode "$verify_rc" '{schemaVersion:1,cycle:$cycle,role:"builder",baseSha:$baseSha,criterionId:$criterion,objective:$objective,changedFiles:$changedFiles,hasDelta:$hasDelta,verificationOnly:$verificationOnly,agentExitCode:$agentExitCode,trustedVerificationPassed:$trustedVerificationPassed,trustedVerificationExitCode:$trustedVerificationExitCode}' > "$out/metadata.json"
exit 0
