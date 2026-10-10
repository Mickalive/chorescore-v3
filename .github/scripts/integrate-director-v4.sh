#!/usr/bin/env bash
set -euo pipefail
cycle="${CYCLE_KEY:?}"
base="${ACCEPTED_SHA:?}"
branch=lab/chorescore-v4
cand=/tmp/factory-v4/candidate-builder
audit=/tmp/factory-v4/audit-builder
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
  bash .github/scripts/verify-v4.sh integration
fi

git config user.name chorescore-v4-factory
git config user.email chorescore-v4-factory@users.noreply.github.com
auth=$(printf 'x-access-token:%s' "${GH_TOKEN:?}" | base64 -w0)
git -c "http.extraheader=AUTHORIZATION: basic $auth" fetch origin "+refs/heads/$branch:refs/remotes/origin/$branch"
[[ "$(git rev-parse refs/remotes/origin/$branch)" == "$base" ]] || { echo "::error::Accepted V4 advanced during Director; discard stale integration and let safety cycle retry"; exit 75; }

if [[ "$decision" == accept || "$decision" == repair ]]; then
  git add -A
  if ! git diff --cached --quiet; then
    if [[ "$decision" == repair ]]; then msg="factory $cycle: persist audited V4 repair baseline"; else msg="factory $cycle: audited V4 product tranche"; fi
    git commit -m "$msg"
    git -c "http.extraheader=AUTHORIZATION: basic $auth" push origin "HEAD:refs/heads/$branch"
  fi
fi

product_sha=$(git rev-parse HEAD)
before="${RUNNER_TEMP:?}/release-before.json"
cp docs/RELEASE_STATUS.json "$before"
manifest=$(jq -n --arg decision "$decision" --arg criterion "$criterion" --argjson hasDelta "$has" '{auditDecision:$decision,criterionId:$criterion,hasDelta:$hasDelta}')

# Director state transition is deterministic from the trusted audit manifest.
# Do not spend an LLM call to restate a decision the shell already owns.
r="reports/director/RUN_${cycle}.json"
md="reports/director/RUN_${cycle}.md"
if [[ "$decision" == "accept" && "$criterion" == "V4-09" ]]; then
  planned="stop"
  reason="V4-09 accepted; hand off directly to the trusted finalizer."
elif [[ "$decision" == "accept" ]]; then
  planned="continue"
  reason="$criterion accepted; activate the next incomplete V4 criterion."
else
  planned="continue"
  reason="$criterion requires targeted repair from the trusted audit findings."
fi
jq -n --arg cycle "$cycle" --arg decision "$planned" --arg reason "$reason" --arg audit "$decision" --arg criterion "$criterion" --argjson hasDelta "$has" '
  {schemaVersion:1,cycle:$cycle,decision:$decision,reason:$reason,
   progressEvidence:[("audit="+$audit),("criterion="+$criterion),("hasDelta="+($hasDelta|tostring))]}
' > "$r"
printf '# V4 Director %s\n\n- decision: %s\n- criterion: %s\n- audit: %s\n- hasDelta: %s\n- reason: %s\n' "$cycle" "$planned" "$criterion" "$decision" "$has" "$reason" > "$md"

git add -A
mapfile -d '' directed < <(git diff --cached --name-only -z HEAD)
for p in "${directed[@]}"; do
  case "$p" in
    docs/RELEASE_STATUS.json|docs/NEXT_CYCLE.md|directives/TASKS.json|reports/director/*|reports/audits/*) ;;
    *) echo "::error::V4 Director changed forbidden path $p"; exit 20;;
  esac
done
jq -e --arg cycle "$cycle" '.schemaVersion==1 and (.cycle|tostring)==$cycle and (.decision=="continue" or .decision=="stop") and (.reason|type=="string" and length>0) and (.progressEvidence|type=="array")' "$r" >/dev/null
jq -e -n --slurpfile b "$before" --slurpfile a docs/RELEASE_STATUS.json '[$b[0].criteria[]|select(.status=="complete")] as $done | all($done[]; . as $old | any($a[0].criteria[]; .id==$old.id and .status=="complete"))' >/dev/null

if [[ "$decision" == accept ]]; then
  if [[ "$criterion" == "V4-09" ]]; then
    tmp=$(mktemp)
    jq --arg cycle "$cycle" --arg sha "$product_sha" '
      (.criteria[] | select(.id=="V4-09") | .status)="in_progress" |
      (.criteria[] | select(.id=="V4-09") | .evidence) += ["audit-accepted-"+$cycle] |
      .activeCriteria=[] | .pendingArtifact="V4-09-RELEASE" | .openFindings=[] | .lastCycle=$cycle |
      .progressSummary="V4-09 accepted; trusted V4 mobile finalizer owns APK/API35/golden-path completion." |
      .factoryHealth.consecutiveNoProgress=0 | .factoryHealth.stalled=false | .factoryHealth.reason=null | .factoryHealth.lastProductSha=$sha
    ' docs/RELEASE_STATUS.json > "$tmp"; mv "$tmp" docs/RELEASE_STATUS.json
    tmp=$(mktemp); jq '.builder.enabled=false | .builder.criterionId=null | .builder.objective="V4-09 handed to trusted finalizer." | .builder.scope="Trusted finalizer only." | .builder.acceptance=[]' directives/TASKS.json > "$tmp"; mv "$tmp" directives/TASKS.json
    pending=true; continue=false
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
    jq --arg n "$next" --arg obj "Implement $next — $title. $outcome" --arg scope "Work only on $next and directly necessary migrations/repairs. Preserve validated V3 foundations and every completed V4 criterion." --argjson acceptance "$acceptance" --argjson preserved "$preserved" '.builder.enabled=true | .builder.criterionId=$n | .builder.objective=$obj | .builder.scope=$scope | .builder.acceptance=$acceptance | .builder.previousCriteriaPreserved=$preserved' directives/TASKS.json > "$tmp"; mv "$tmp" directives/TASKS.json
    pending=false; continue=true
  fi
else
  findings=$(jq -c '[.findings[]|select(.mustFix==true)]' "$report")
  fixes=$(jq -r '[.findings[]|select(.mustFix==true)|.requiredFix]|join("; ")' "$report")
  current_np=$(jq -r '.factoryHealth.consecutiveNoProgress // 0' docs/RELEASE_STATUS.json)
  if [[ "$has" == true ]]; then no_progress=0; else no_progress=$((current_np+1)); fi
  tmp=$(mktemp)
  jq --arg c "$criterion" --arg cycle "$cycle" --arg sha "$product_sha" --argjson findings "$findings" --argjson np "$no_progress" '
    (.criteria[] | select(.id==$c) | .status)="in_progress" |
    .activeCriteria=[$c] | .pendingArtifact=null | .openFindings=$findings | .lastCycle=$cycle |
    .factoryHealth.consecutiveNoProgress=$np | .factoryHealth.stalled=false | .factoryHealth.lastProductSha=$sha | .factoryHealth.reason=null |
    .progressSummary=("Audited "+$c+" requires targeted repair; safe WIP retained and autonomous loop continues.")
  ' docs/RELEASE_STATUS.json > "$tmp"; mv "$tmp" docs/RELEASE_STATUS.json
  acceptance=$(jq -c '.builder.acceptance' directives/TASKS.json)
  tmp=$(mktemp)
  jq --arg c "$criterion" --arg obj "REPAIR $criterion: $fixes" --arg scope "Repair only audited must-fix findings on the preserved V4 baseline. Use new evidence/strategy rather than merely increasing timeouts." --argjson acceptance "$acceptance" '.builder.enabled=true | .builder.criterionId=$c | .builder.objective=$obj | .builder.scope=$scope | .builder.acceptance=$acceptance' directives/TASKS.json > "$tmp"; mv "$tmp" directives/TASKS.json
  pending=false; continue=true
fi

tmp=$(mktemp)
if [[ "$continue" == true ]]; then jq '.decision="continue"' "$r" > "$tmp"; else jq '.decision="stop"' "$r" > "$tmp"; fi
mv "$tmp" "$r"

git -c "http.extraheader=AUTHORIZATION: basic $auth" fetch origin "+refs/heads/$branch:refs/remotes/origin/$branch"
[[ "$(git rev-parse refs/remotes/origin/$branch)" == "$product_sha" ]] || { echo "::error::Accepted V4 advanced during Director state update"; exit 75; }
git add -A
if ! git diff --cached --quiet; then
  git commit -m "factory $cycle: V4 director state"
  git -c "http.extraheader=AUTHORIZATION: basic $auth" push origin "HEAD:refs/heads/$branch"
fi

echo "accepted_sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
echo "pending_artifact=$pending" >> "$GITHUB_OUTPUT"
echo "continue=$continue" >> "$GITHUB_OUTPUT"
echo "stalled=false" >> "$GITHUB_OUTPUT"
