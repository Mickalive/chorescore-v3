#!/usr/bin/env bash
set -euo pipefail
cycle="${CYCLE_KEY:?}"
out="${RUNNER_TEMP:?}/candidate-builder"; mkdir -p "$out"
criterion=$(jq -r '.builder.criterionId' directives/TASKS.json)
objective=$(jq -r '.builder.objective' directives/TASKS.json)
acceptance=$(jq -c '.builder.acceptance' directives/TASKS.json)

# Read-only V2 reference for selective migration. Never merge/cherry-pick it wholesale.
if ! git remote get-url v2-reference >/dev/null 2>&1; then
  git remote add v2-reference https://github.com/Mickalive/Chorescore-V2.git
fi
git fetch --depth=1 v2-reference lab/chorescore-v2:refs/remotes/v2-reference/lab/chorescore-v2

set +e
OPENCODE_RETRY_LABEL=builder bash .github/scripts/run-ox.sh opencode run --model "${OX_MODEL:?}" --agent v3-builder "Build ChoreScore V3 factory cycle $cycle. Active criterion: $criterion. Objective: $objective. Acceptance: $acceptance. Start from the existing accepted V3 baseline; repair or extend it, never rebuild coherent accepted work. The read-only V2 reference is v2-reference/lab/chorescore-v2 and may be inspected with git show when useful. Read every canonical file first and finish one coherent tested tranche."
agent_rc=$?
set -e

verify_log="$out/trusted-verification.log"
set +e
bash .github/scripts/verify-product.sh candidate > >(tee "$verify_log") 2>&1
verify_rc=$?
set -e

git add -A
mapfile -d '' changed < <(git diff --cached --name-only -z HEAD)
count=${#changed[@]}
(( count <= 160 )) || { echo "::error::Candidate changed $count files"; exit 4; }
for p in "${changed[@]}"; do
  case "$p" in
    MAIN_PROMPT.md|AGENTS.md|governance/*|directives/*|docs/V3_CONSTITUTION.md|docs/V2_TO_V3_MIGRATION.md|docs/ROADMAP.md|docs/RELEASE_STATUS.json|docs/NEXT_CYCLE.md|docs/agent-workflow.md|.github/*|.opencode/*|opencode.json|reports/*)
      echo "::error::Builder changed protected path $p"; exit 5;;
  esac
done

if (( agent_rc != 0 )) && (( count == 0 )); then
  echo "::error::Builder exited $agent_rc and produced no candidate delta"
  exit "$agent_rc"
fi
(( agent_rc == 0 )) || echo "::warning::Builder exited $agent_rc after producing $count changed files; preserving candidate for audit"
(( verify_rc == 0 )) || echo "::warning::Trusted verification exited $verify_rc; Auditor must classify repair"

has=false; verify_only=true; : > "$out/candidate.patch"
if (( count > 0 )); then
  has=true; verify_only=false; git diff --cached --binary HEAD > "$out/candidate.patch"
fi
[[ $verify_rc -eq 0 ]] && verify_passed=true || verify_passed=false
jq -n --arg cycle "$cycle" --arg baseSha "$(git rev-parse HEAD)" --arg criterion "$criterion" --arg objective "$objective" --argjson changedFiles "$count" --argjson hasDelta "$has" --argjson verificationOnly "$verify_only" --argjson agentExitCode "$agent_rc" --argjson trustedVerificationPassed "$verify_passed" --argjson trustedVerificationExitCode "$verify_rc" '{schemaVersion:1,cycle:$cycle,role:"builder",baseSha:$baseSha,criterionId:$criterion,objective:$objective,changedFiles:$changedFiles,hasDelta:$hasDelta,verificationOnly:$verificationOnly,agentExitCode:$agentExitCode,trustedVerificationPassed:$trustedVerificationPassed,trustedVerificationExitCode:$trustedVerificationExitCode}' > "$out/metadata.json"
exit 0
