#!/usr/bin/env bash
set -euo pipefail
cand="${1:?candidate dir}"
cycle="${CYCLE_KEY:?}"
out="${RUNNER_TEMP:?}/audit-builder"; mkdir -p "$out" reports/audits
meta="$cand/metadata.json"; test -s "$meta"
criterion=$(jq -r .criterionId "$meta")
objective=$(jq -r .objective "$meta")
has=$(jq -r .hasDelta "$meta")
accepted="${RUNNER_TEMP:?}/accepted-pristine"; rm -rf "$accepted"; git worktree add --detach "$accepted" "$ACCEPTED_SHA"
if [[ "$has" == true ]]; then
  git apply --check "$cand/candidate.patch"
  git apply --index "$cand/candidate.patch"
fi

trusted="reports/audits/TRUSTED_${cycle}.md"
set +e
bash .github/scripts/verify-product.sh audit > >(tee "$trusted") 2>&1
verify_rc=$?
set -e
printf '\n\nTrusted verification exit code: %s\n' "$verify_rc" >> "$trusted"

json="reports/audits/RUN_${cycle}.json"
md="reports/audits/RUN_${cycle}.md"
OPENCODE_RETRY_LABEL=auditor bash .github/scripts/run-ox.sh opencode run --model "${OX_MODEL:?}" --agent cycle-auditor "Audit ChoreScore V3 cycle $cycle independently. Active criterion: $criterion. Objective: $objective. Candidate checkout is current; pristine accepted tree is $accepted. Trusted verification exit code is $verify_rc; read $trusted. A nonzero trusted verification exit code is mandatory mustFix and decision MUST NOT be accept. Write exactly $json and $md. JSON schema: schemaVersion=1, cycle='$cycle', role='builder', decision accept/repair/reject, nonempty summary, checks string array, findings array. Each finding has path, problem, evidence, mustFix boolean, requiredFix, verification. Accept iff trusted verification passed AND no mustFix remains."

if (( verify_rc != 0 )); then
  tmp=$(mktemp)
  jq --arg rc "$verify_rc" --arg evidence "$trusted" '
    .decision="repair"
    | .summary=("Trusted verification failed (exit "+$rc+"); candidate retained as WIP for repair. "+(.summary // ""))
    | .checks=((.checks // []) + [("trusted verification: FAIL exit "+$rc+"; see "+$evidence)])
    | .findings=((.findings // []) + [{path:".",problem:"Trusted product verification failed",evidence:("Authoritative verification log: "+$evidence+" (exit "+$rc+")"),mustFix:true,requiredFix:"Resolve the concrete failing trusted check without discarding already-correct candidate work, then rerun the full gate.",verification:"Full trusted V3 verification must return exit code 0."}])
  ' "$json" > "$tmp"
  mv "$tmp" "$json"
fi

bash .github/scripts/validate-audit-json.sh "$json" "$cycle"
cp "$json" "$md" "$trusted" "$out/"
git worktree remove --force "$accepted"; git worktree prune
