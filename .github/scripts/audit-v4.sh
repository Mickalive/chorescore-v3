#!/usr/bin/env bash
set -euo pipefail
cand="${1:?candidate dir}"
cycle="${CYCLE_KEY:?}"
out="${RUNNER_TEMP:?}/audit-builder"
mkdir -p "$out" reports/audits
meta="$cand/metadata.json"; test -s "$meta"
criterion=$(jq -r .criterionId "$meta")
objective=$(jq -r .objective "$meta")
has=$(jq -r .hasDelta "$meta")
accepted="${RUNNER_TEMP:?}/accepted-pristine"
rm -rf "$accepted"
git worktree add --detach "$accepted" "$ACCEPTED_SHA"
if [[ "$has" == true ]]; then
  git apply --check "$cand/candidate.patch"
  git apply --index "$cand/candidate.patch"
fi

trusted="reports/audits/TRUSTED_${cycle}.md"
set +e
bash .github/scripts/verify-v4.sh audit > >(tee "$trusted") 2>&1
verify_rc=$?
set -e
printf '\n\nTrusted verification exit code: %s\n' "$verify_rc" >> "$trusted"

json="reports/audits/RUN_${cycle}.json"
md="reports/audits/RUN_${cycle}.md"
set +e
OPENCODE_RETRY_LABEL=auditor bash .github/scripts/run-ox.sh opencode run --model "${OX_MODEL:?}" --agent cycle-auditor "Audit ChoreScore V4 cycle $cycle independently. Active criterion: $criterion. Objective: $objective. Candidate checkout is current; pristine accepted tree is $accepted. Read V4_CONSTITUTION, V4_RELEASE_ENGINEERING and trusted verification $trusted. Trusted verification exit code is $verify_rc. Write exactly $json and $md. JSON schema: schemaVersion=1, cycle='$cycle', role='builder', decision accept/repair/reject, nonempty summary, checks string array, findings array. Each finding has path, problem, evidence, mustFix boolean, requiredFix, verification. Accept iff trusted verification passed AND no mustFix remains."
auditor_rc=$?
set -e

# Some OpenCode providers can exit nonzero after successfully writing a complete
# audit report. The report + trusted verification are the authoritative outputs.
# Only fail here when the report itself is missing/invalid.
if (( auditor_rc != 0 )); then
  echo "::warning::Auditor process exited $auditor_rc; validating written audit artifacts before deciding whether this is fatal"
fi
test -s "$json"
test -s "$md"

if (( verify_rc != 0 )); then
  tmp=$(mktemp)
  jq --arg rc "$verify_rc" --arg evidence "$trusted" '
    .decision="repair"
    | .summary=("Trusted V4 verification failed (exit "+$rc+"); candidate retained as WIP. "+(.summary // ""))
    | .checks=((.checks // []) + [("trusted V4 verification: FAIL exit "+$rc+"; see "+$evidence)])
    | .findings=((.findings // []) + [{path:".",problem:"Trusted V4 product verification failed",evidence:("Authoritative verification log: "+$evidence+" (exit "+$rc+")"),mustFix:true,requiredFix:"Resolve the concrete failing check without discarding correct work, then rerun.",verification:"Full trusted V4 verification must return exit code 0."}])
  ' "$json" > "$tmp"
  mv "$tmp" "$json"
fi

bash .github/scripts/validate-audit-json.sh "$json" "$cycle"
cp "$json" "$md" "$trusted" "$out/"
git worktree remove --force "$accepted"
git worktree prune
