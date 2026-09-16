#!/usr/bin/env bash
set -euo pipefail
cycle="${CYCLE_KEY:?}"
base="${ACCEPTED_SHA:?}"
branch=lab/chorescore-v3
cand=/tmp/factory/candidate-builder
audit=/tmp/factory/audit-builder
meta="$cand/metadata.json"
report=$(find "$audit" -maxdepth 1 -name 'RUN_*.json' | head -1)
test -s "$meta"; test -s "$report"
bash .github/scripts/validate-audit-json.sh "$report" "$cycle"
decision=$(jq -r .decision "$report")
has=$(jq -r .hasDelta "$meta")
criterion=$(jq -r .criterionId "$meta")
mkdir -p reports/audits reports/director
cp "$audit"/*.json "$audit"/*.md reports/audits/

if [[ ( "$decision" == accept || "$decision" == repair ) && "$has" == true ]]; then
  git apply --check "$cand/candidate.patch"
  git apply --index "$cand/candidate.patch"
fi
if [[ "$decision" == accept ]]; then
  bash .github/scripts/verify-product.sh integration
fi

git config user.name chorescore-v3-factory
git config user.email chorescore-v3-factory@users.noreply.github.com
auth=$(printf 'x-access-token:%s' "${GH_TOKEN:?}" | base64 -w0)
git -c "http.extraheader=AUTHORIZATION: basic $auth" fetch origin "+refs/heads/$branch:refs/remotes/origin/$branch"
[[ "$(git rev-parse refs/remotes/origin/$branch)" == "$base" ]] || { echo "::error::Accepted V3 advanced; stale integration"; exit 75; }

# Persist exact independently audited product/WIP delta before Director. Reject discards candidate.
if [[ "$decision" == accept || "$decision" == repair ]]; then
  git add -A
  if ! git diff --cached --quiet; then
    if [[ "$decision" == repair ]]; then msg="factory $cycle: persist audited V3 repair baseline"; else msg="factory $cycle: audited V3 product tranche"; fi
    git commit -m "$msg"
    git -c "http.extraheader=AUTHORIZATION: basic $auth" push origin "HEAD:refs/heads/$branch"
  fi
fi
product_sha=$(git rev-parse HEAD)
before="${RUNNER_TEMP:?}/release-before.json"; cp docs/RELEASE_STATUS.json "$before"
manifest=$(jq -n --arg decision "$decision" --arg criterion "$criterion" --argjson hasDelta "$has" '{auditDecision:$decision,criterionId:$criterion,hasDelta:$hasDelta}')

OPENCODE_RETRY_LABEL=director bash .github/scripts/run-ox.sh opencode run --model "${OX_MODEL:?}" --agent cycle-director "Direct ChoreScore V3 cycle $cycle. Trusted manifest: $manifest. Read current audit reports. Write reports/director/RUN_${cycle}.json and .md. JSON: schemaVersion=1, cycle='$cycle', decision continue/stop, nonempty reason, progressEvidence array. For accept, describe the next roadmap criterion; for repair/reject, focus on actual mustFix findings. Do not invent evidence. Trusted shell owns final state transitions and V3-08 release handoff."

git add -A
mapfile -d '' directed < <(git diff --cached --name-only -z HEAD)
for p in "${directed[@]}"; do
  case "$p" in
    docs/RELEASE_STATUS.json|docs/NEXT_CYCLE.md|directives/TASKS.json|reports/director/*|reports/audits/*) ;;
    *) echo "::error::Director changed forbidden path $p"; exit 20;;
  esac
done
r="reports/director/RUN_${cycle}.json"
jq -e --arg cycle "$cycle" '.schemaVersion==1 and (.cycle|tostring)==$cycle and (.decision=="continue" or .decision=="stop") and (.reason|type=="string" and length>0) and (.progressEvidence|type=="array")' "$r" >/dev/null

# Completed criteria may never regress.
jq -e -n --slurpfile b "$before" --slurpfile a docs/RELEASE_STATUS.json '[$b[0].criteria[]|select(.status=="complete")] as $done | all($done[]; . as $old | any($a[0].criteria[]; .id==$old.id and .status=="complete"))' >/dev/null

if [[ "$decision" == accept ]]; then
  if [[ "$criterion" == "V3-08" ]]; then
    tmp=$(mktemp)
    jq --arg cycle "$cycle" --arg sha "$product_sha" '
      (.criteria[] | select(.id=="V3-08") | .status)="in_progress" |
      (.criteria[] | select(.id=="V3-08") | .evidence) += ["audit-accepted-"+$cycle] |
      .activeCriteria=[] | .pendingArtifact="V3-08-RELEASE" | .openFindings=[] | .lastCycle=$cycle |
      .progressSummary="V3-08 independently accepted; trusted mobile finalizer owns APK/install/runtime/E2E completion." |
      .factoryHealth.consecutiveNoProgress=0 | .factoryHealth.stalled=false | .factoryHealth.reason=null | .factoryHealth.lastProductSha=$sha
    ' docs/RELEASE_STATUS.json > "$tmp"; mv "$tmp" docs/RELEASE_STATUS.json
    tmp=$(mktemp); jq '.builder.enabled=false | .builder.criterionId=null | .builder.objective="V3-08 handed to trusted release finalizer." | .builder.scope="Trusted finalizer only." | .builder.acceptance=[]' directives/TASKS.json > "$tmp"; mv "$tmp" directives/TASKS.json
    pending=true; stalled=false; continue=false
  else
    tmp=$(mktemp)
    jq --arg c "$criterion" --arg cycle "$cycle" --arg sha "$product_sha" '
      (.criteria[] | select(.id==$c) | .status)="complete" |
      (.criteria[] | select(.id==$c) | .evidence) += ["audit-accepted-"+$cycle] |
      .openFindings=[] | .pendingArtifact=null | .lastCycle=$cycle |
      .factoryHealth.consecutiveNoProgress=0 | .factoryHealth.stalled=false | .factoryHealth.reason=null | .factoryHealth.lastProductSha=$sha
    ' docs/RELEASE_STATUS.json > "$tmp"; mv "$tmp" docs/RELEASE_STATUS.json
    next=$(jq -r '.criteria[] | select(.status!="complete") | .id' docs/RELEASE_STATUS.json | head -1)
    test -n "$next"; [[ "$next" != "null" ]]
    tmp=$(mktemp); jq --arg n "$next" '(.criteria[] | select(.id==$n) | .status)="in_progress" | .activeCriteria=[$n]' docs/RELEASE_STATUS.json > "$tmp"; mv "$tmp" docs/RELEASE_STATUS.json
    title=$(jq -r --arg n "$next" '.criteria[]|select(.id==$n)|.title' governance/RELEASE_DEFINITION.json)
    outcome=$(jq -r --arg n "$next" '.criteria[]|select(.id==$n)|.outcome' governance/RELEASE_DEFINITION.json)
    acceptance=$(jq -c --arg n "$next" '.criteria[]|select(.id==$n)|.acceptance' governance/RELEASE_DEFINITION.json)
    preserved=$(jq -c '[.criteria[]|select(.status=="complete")|(.id+": accepted and must not regress")]' docs/RELEASE_STATUS.json)
    tmp=$(mktemp)
    jq --arg n "$next" --arg obj "Implement $next — $title. $outcome" --arg scope "Work only on $next and directly necessary migrations/repairs. Preserve every completed V3 criterion." --argjson acceptance "$acceptance" --argjson preserved "$preserved" '.builder.enabled=true | .builder.criterionId=$n | .builder.objective=$obj | .builder.scope=$scope | .builder.acceptance=$acceptance | .builder.previousCriteriaPreserved=$preserved' directives/TASKS.json > "$tmp"; mv "$tmp" directives/TASKS.json
    pending=false; stalled=false; continue=true
  fi
else
  findings=$(jq -c '[.findings[]|select(.mustFix==true)]' "$report")
  fixes=$(jq -r '[.findings[]|select(.mustFix==true)|.requiredFix]|join("; ")' "$report")
  current_np=$(jq -r '.factoryHealth.consecutiveNoProgress // 0' docs/RELEASE_STATUS.json)
  if [[ "$has" == true ]]; then no_progress=0; else no_progress=$((current_np+1)); fi
  if (( no_progress >= 2 )); then stalled=true; continue=false; else stalled=false; continue=true; fi
  tmp=$(mktemp)
  jq --arg c "$criterion" --arg cycle "$cycle" --arg sha "$product_sha" --argjson findings "$findings" --argjson np "$no_progress" --argjson stalled "$stalled" '
    (.criteria[] | select(.id==$c) | .status)="in_progress" |
    .activeCriteria=[$c] | .pendingArtifact=null | .openFindings=$findings | .lastCycle=$cycle |
    .factoryHealth.consecutiveNoProgress=$np | .factoryHealth.stalled=$stalled | .factoryHealth.lastProductSha=$sha |
    .factoryHealth.reason=(if $stalled then "Two consecutive non-accepted cycles produced no product delta; human/control-plane review required." else null end) |
    .progressSummary=(if $stalled then "Factory STALLED on "+$c+" after repeated no-delta repair/reject cycles." else "Audited "+$c+" requires repair; WIP baseline preserved when a safe delta existed." end)
  ' docs/RELEASE_STATUS.json > "$tmp"; mv "$tmp" docs/RELEASE_STATUS.json
  acceptance=$(jq -c '.builder.acceptance' directives/TASKS.json)
  tmp=$(mktemp)
  jq --arg c "$criterion" --arg obj "REPAIR $criterion: $fixes" --arg scope "Repair only the audited must-fix findings on the preserved V3 baseline; do not rebuild accepted work." --argjson enabled "$continue" --argjson acceptance "$acceptance" '.builder.enabled=$enabled | .builder.criterionId=(if $enabled then $c else null end) | .builder.objective=$obj | .builder.scope=$scope | .builder.acceptance=$acceptance' directives/TASKS.json > "$tmp"; mv "$tmp" directives/TASKS.json
  pending=false
fi

# Trusted shell controls whether self-relaunch is permitted.
tmp=$(mktemp)
if [[ "$continue" == true ]]; then jq '.decision="continue"' "$r" > "$tmp"; else jq '.decision="stop"' "$r" > "$tmp"; fi
mv "$tmp" "$r"

git -c "http.extraheader=AUTHORIZATION: basic $auth" fetch origin "+refs/heads/$branch:refs/remotes/origin/$branch"
[[ "$(git rev-parse refs/remotes/origin/$branch)" == "$product_sha" ]] || { echo "::error::Accepted V3 advanced during Director"; exit 75; }
git add -A
if ! git diff --cached --quiet; then
  git commit -m "factory $cycle: V3 director state"
  git -c "http.extraheader=AUTHORIZATION: basic $auth" push origin "HEAD:refs/heads/$branch"
fi

echo "accepted_sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
echo "pending_artifact=$pending" >> "$GITHUB_OUTPUT"
echo "continue=$continue" >> "$GITHUB_OUTPUT"
echo "stalled=$stalled" >> "$GITHUB_OUTPUT"
