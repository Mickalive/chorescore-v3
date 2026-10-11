#!/usr/bin/env bash
set -euo pipefail

run_id="${FAILED_RUN_ID:?}"
repo="${GITHUB_REPOSITORY:?}"
control="${CONTROL_DIR:?}"
branch="lab/chorescore-v4"
base="$(git rev-parse HEAD)"
log="${RUNNER_TEMP:?}/v4-finalizer-${run_id}.log"

gh run view "$run_id" --repo "$repo" --log-failed > "$log" 2>&1 || true
test -s "$log" || { echo "::error::Could not retrieve failed finalizer log $run_id"; exit 2; }

golden_failure=false
if grep -Eqi 'V4 Android golden path FAIL|FAILURE_CLASS=product_e2e|UI node not found by testID|Create-group form did not open|Text input failed for' "$log"; then
  golden_failure=true
fi

infra_failure=false
if grep -Eqi 'FAILURE_CLASS=infra_android_adb_emulator|adb .*failed|adb.*exit code 224|spawnSync adb ETIMEDOUT|System UI.*not responding|Quickstep.*not responding|emulator.*(failed|ERROR|not found|did not reach)|Broken pipe \(32\)' "$log"; then
  infra_failure=true
fi

harness_static_failure=false
if grep -Eqi 'v3-08-finalizer-wrapper\.test\.ts|scripts/(finalizer-e2e|boot-emulator)\.sh: line [0-9]+: syntax error|SyntaxError.*scripts/e2e-android|Command failed: bash -n .*scripts/(finalizer-e2e|boot-emulator)\.sh' "$log"; then
  harness_static_failure=true
fi

dispatch_finalizer() {
  gh workflow run chorescore-v4-finalize.yml --repo "$repo" --ref main -f reuse_run="$run_id"
}

dispatch_factory() {
  gh workflow run chorescore-v4-factory.yml --repo "$repo" --ref main
}

push_state_and_dispatch_finalizer() {
  local reason="$1"
  tmp=$(mktemp)
  jq --arg run "$run_id" --arg reason "$reason" '
    (.criteria[] | select(.id=="V4-09") | .status)="in_progress" |
    .activeCriteria=[] |
    .pendingArtifact="V4-09-RELEASE" |
    .openFindings=[] |
    .progressSummary=("V4-09 fast release repair ready after finalizer "+$run+": "+$reason) |
    .factoryHealth.stalled=false |
    .factoryHealth.reason=null
  ' docs/RELEASE_STATUS.json > "$tmp"; mv "$tmp" docs/RELEASE_STATUS.json

  tmp=$(mktemp)
  jq '.builder.enabled=false | .builder.criterionId=null |
      .builder.objective="V4-09 fast repair handed directly back to trusted finalizer." |
      .builder.scope="Trusted finalizer only." | .builder.acceptance=[]' directives/TASKS.json > "$tmp"
  mv "$tmp" directives/TASKS.json

  git config user.name chorescore-v4-release-repair
  git config user.email chorescore-v4-release-repair@users.noreply.github.com
  git add -A
  if ! git diff --cached --quiet; then
    git commit -m "release $run_id: targeted V4 release repair"
  fi

  auth=$(printf 'x-access-token:%s' "${GH_TOKEN:?}" | base64 -w0)
  git -c "http.extraheader=AUTHORIZATION: basic $auth" fetch origin "+refs/heads/$branch:refs/remotes/origin/$branch"
  [[ "$(git rev-parse refs/remotes/origin/$branch)" == "$base" ]] || {
    echo "::warning::V4 branch advanced during release repair; discard stale repair"
    exit 75
  }
  git -c "http.extraheader=AUTHORIZATION: basic $auth" push origin "HEAD:refs/heads/$branch"
  dispatch_finalizer
}

stall_release_lane() {
  local reason="$1"
  tmp=$(mktemp)
  jq --arg run "$run_id" --arg reason "$reason" '
    (.criteria[] | select(.id=="V4-09") | .status)="in_progress" |
    .activeCriteria=[] |
    .pendingArtifact=null |
    .openFindings=[{
      path:"release-infra",
      problem:"Trusted V4 release harness/infrastructure requires a new repair strategy",
      evidence:("GitHub Actions V4 finalizer run "+$run),
      mustFix:true,
      requiredFix:$reason,
      verification:"Pass the targeted harness checks, then the trusted Android API35 golden path and clean production arm64 build."
    }] |
    .progressSummary=("V4-09 release lane stalled safely after run "+$run+": "+$reason) |
    .factoryHealth.stalled=true |
    .factoryHealth.reason=$reason
  ' docs/RELEASE_STATUS.json > "$tmp"; mv "$tmp" docs/RELEASE_STATUS.json

  tmp=$(mktemp)
  jq '.builder.enabled=false | .builder.criterionId=null |
      .builder.objective="Release harness/infrastructure repair only." |
      .builder.scope="No product changes." | .builder.acceptance=[]' directives/TASKS.json > "$tmp"
  mv "$tmp" directives/TASKS.json

  git config user.name chorescore-v4-release-repair
  git config user.email chorescore-v4-release-repair@users.noreply.github.com
  git add docs/RELEASE_STATUS.json directives/TASKS.json
  if ! git diff --cached --quiet; then
    git commit -m "release $run_id: stall V4 release lane safely"
    auth=$(printf 'x-access-token:%s' "${GH_TOKEN:?}" | base64 -w0)
    git -c "http.extraheader=AUTHORIZATION: basic $auth" fetch origin "+refs/heads/$branch:refs/remotes/origin/$branch"
    [[ "$(git rev-parse refs/remotes/origin/$branch)" == "$base" ]] || exit 75
    git -c "http.extraheader=AUTHORIZATION: basic $auth" push origin "HEAD:refs/heads/$branch"
  fi
  exit 1
}

repair_kind=""
if [[ "$infra_failure" == true && "$golden_failure" == false ]]; then
  retries=$(jq -r '.factoryHealth.releaseInfraRetries // 0' docs/RELEASE_STATUS.json)
  if (( retries == 0 )); then
    tmp=$(mktemp)
    jq '.factoryHealth.releaseInfraRetries=1' docs/RELEASE_STATUS.json > "$tmp"; mv "$tmp" docs/RELEASE_STATUS.json
    push_state_and_dispatch_finalizer "transient Android/ADB infrastructure failure; one direct artifact-reusing retry"
    exit 0
  fi
  repair_kind="infra"
elif [[ "$harness_static_failure" == true ]]; then
  repair_kind="harness-static"
elif [[ "$golden_failure" == true ]]; then
  repair_kind="golden-harness"
else
  echo "::notice::Failure is not release-harness/infra evidence; escalating to the product factory"
  dispatch_factory
  exit 0
fi

mkdir -p reports/release-input
cp "$log" "reports/release-input/FINALIZER_${run_id}.log"

source "$control/.github/scripts/setup-opencode.sh"

case "$repair_kind" in
  infra)
    prompt="Repair ONLY the ChoreScore V4 Android release infrastructure failure from finalizer run $run_id. Read reports/release-input/FINALIZER_${run_id}.log. You may modify only scripts/boot-emulator.sh, scripts/finalizer-e2e.sh, scripts/e2e-android.js, and __tests__/domain/v3-08-finalizer-wrapper.test.ts. Do not change app/, src/, domain, repositories, dependencies, governance, product behavior, or product tests. Change strategy based on exact evidence; do not merely increase timeouts."
    ;;
  harness-static)
    prompt="Repair ONLY the ChoreScore V4 release harness syntax/contract failure from finalizer run $run_id. Read reports/release-input/FINALIZER_${run_id}.log. You may modify only scripts/boot-emulator.sh, scripts/finalizer-e2e.sh, scripts/e2e-android.js, and __tests__/domain/v3-08-finalizer-wrapper.test.ts. Make the wrapper canonical, syntactically valid, non-duplicated and aligned with its harness contract. Do not change product code."
    ;;
  *)
    prompt="Repair ONLY a demonstrable ChoreScore V4 Android E2E harness false negative from finalizer run $run_id. Read reports/release-input/FINALIZER_${run_id}.log. You may modify only scripts/boot-emulator.sh, scripts/finalizer-e2e.sh, scripts/e2e-android.js, and __tests__/domain/v3-08-finalizer-wrapper.test.ts. If the evidence instead requires a real product change, make no change and exit. Do not paper over failures with large timeout increases."
    ;;
esac

agent_rc=1
for model in mimo-v2.5-free deepseek-v4-flash-free; do
  set +e
  OPENCODE_MAX_ATTEMPTS=1 OPENCODE_ATTEMPT_TIMEOUT_SECONDS=600 OPENCODE_RETRY_DELAY_SECONDS=5     bash "$control/.github/scripts/run-ox.sh" opencode run --model "$model" --agent v4-builder "$prompt"
  agent_rc=$?
  set -e
  git add -A
  changed=$(git diff --cached --name-only HEAD | grep -v '^reports/release-input/' || true)
  if [[ -n "$changed" || "$agent_rc" -eq 0 ]]; then break; fi
done

rm -rf reports/release-input
git add -A
mapfile -t changed_files < <(git diff --cached --name-only HEAD)

for p in "${changed_files[@]}"; do
  case "$p" in
    scripts/boot-emulator.sh|scripts/finalizer-e2e.sh|scripts/e2e-android.js|__tests__/domain/v3-08-finalizer-wrapper.test.ts) ;;
    *)
      echo "::warning::Restricted release repair attempted forbidden path $p"
      git reset --hard "$base"
      if [[ "$repair_kind" == "golden-harness" ]]; then
        dispatch_factory
        exit 0
      fi
      stall_release_lane "Restricted $repair_kind repair attempted a product/non-harness change; product factory intentionally not invoked."
      ;;
  esac
done

if (( ${#changed_files[@]} == 0 )); then
  if [[ "$repair_kind" == "golden-harness" ]]; then
    echo "::notice::No safe harness delta; treating the golden-path blocker as a product issue"
    dispatch_factory
    exit 0
  fi
  stall_release_lane "No safe $repair_kind delta was produced from the exact failure evidence."
fi

echo "Restricted release-repair delta ($repair_kind):"
printf '  %s\n' "${changed_files[@]}"

# Targeted harness proof only. Full product/privacy/cost/i18n/mobile gates are
# deliberately deferred to the immediate trusted finalizer.
bash -n scripts/boot-emulator.sh
bash -n scripts/finalizer-e2e.sh
node --check scripts/e2e-android.js

test -s package-lock.json
npm ci --ignore-scripts --no-audit --no-fund
npx --no-install jest __tests__/domain/v3-08-finalizer-wrapper.test.ts --runInBand

tmp=$(mktemp)
jq '.factoryHealth.releaseInfraRetries=0' docs/RELEASE_STATUS.json > "$tmp"; mv "$tmp" docs/RELEASE_STATUS.json
push_state_and_dispatch_finalizer "$repair_kind patch passed targeted harness checks; full gates deferred to immediate trusted finalizer"
