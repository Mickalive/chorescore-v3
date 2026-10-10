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
if grep -q 'V4 Android golden path FAIL:' "$log"; then golden_failure=true; fi
infra_signature=false
if grep -Eqi 'adb .*failed|adb.*exit code 224|spawnSync adb ETIMEDOUT|System UI.*not responding|Quickstep.*not responding|emulator.*(failed|ERROR)' "$log"; then infra_signature=true; fi

dispatch_finalizer() {
  # Reuse the failed run's preserved E2E x86 APK when available. If an older
  # run predates APK preservation, the finalizer detects that and falls back
  # to the normal build automatically.
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
  jq '.builder.enabled=false | .builder.criterionId=null | .builder.objective="V4-09 fast repair handed directly back to trusted finalizer." | .builder.scope="Trusted finalizer only." | .builder.acceptance=[]' directives/TASKS.json > "$tmp"; mv "$tmp" directives/TASKS.json

  git config user.name chorescore-v4-release-repair
  git config user.email chorescore-v4-release-repair@users.noreply.github.com
  git add -A
  if ! git diff --cached --quiet; then
    git commit -m "release $run_id: fast V4 E2E repair"
  fi

  auth=$(printf 'x-access-token:%s' "${GH_TOKEN:?}" | base64 -w0)
  git -c "http.extraheader=AUTHORIZATION: basic $auth" fetch origin "+refs/heads/$branch:refs/remotes/origin/$branch"
  [[ "$(git rev-parse refs/remotes/origin/$branch)" == "$base" ]] || {
    echo "::warning::V4 branch advanced during fast repair; discard and let latest state drive the next cycle"
    exit 75
  }
  git -c "http.extraheader=AUTHORIZATION: basic $auth" push origin "HEAD:refs/heads/$branch"
  dispatch_finalizer
}

# Pure Android runner/ADB failures get up to two immediate retries. There is no
# reason to spend an LLM/audit/Gradle cycle when the app never produced a
# product-level golden-path assertion.
if [[ "$golden_failure" == false && "$infra_signature" == true ]]; then
  retries=$(jq -r '.factoryHealth.releaseInfraRetries // 0' docs/RELEASE_STATUS.json)
  if (( retries < 2 )); then
    tmp=$(mktemp)
    jq --argjson n "$((retries+1))" '.factoryHealth.releaseInfraRetries=$n' docs/RELEASE_STATUS.json > "$tmp"; mv "$tmp" docs/RELEASE_STATUS.json
    push_state_and_dispatch_finalizer "pure Android/ADB infrastructure failure; direct retry $((retries+1))/2"
    exit 0
  fi
fi

# Unknown/non-golden failures stay on the conservative full-factory path.
if [[ "$golden_failure" == false ]]; then
  echo "::notice::Failure is not a recognized harness/infra golden-path case; using full V4 factory"
  dispatch_factory
  exit 0
fi

mkdir -p reports/release-input
cp "$log" "reports/release-input/FINALIZER_${run_id}.log"

# Fast lane: ask the Builder only for harness-level repairs. Product/domain/UI
# changes are deliberately forbidden here and are escalated to the full factory.
agent_rc=1
for model in mimo-v2.5-free deepseek-v4-flash-free; do
  set +e
  OPENCODE_MAX_ATTEMPTS=1 OPENCODE_ATTEMPT_TIMEOUT_SECONDS=600 OPENCODE_RETRY_DELAY_SECONDS=5 \
    bash "$control/.github/scripts/run-ox.sh" opencode run --model "$model" --agent v4-builder \
    "Repair ONLY the ChoreScore V4 Android release harness failure from finalizer run $run_id. Read reports/release-input/FINALIZER_${run_id}.log. You may modify only scripts/e2e-android.js and scripts/finalizer-e2e.sh. Do not change app/, src/, domain, repositories, product behavior, governance, docs, workflows, dependencies, or tests. The objective is to eliminate false negatives and make the harness reliably interact with the UI that the diagnostics prove is present. Do not merely increase large timeouts. If the failure requires a product change, make no change and exit."
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
    scripts/e2e-android.js|scripts/finalizer-e2e.sh) ;;
    *)
      echo "::notice::Fast repair attempted product/non-harness change $p; discarding and escalating to full factory"
      git reset --hard "$base"
      dispatch_factory
      exit 0
      ;;
  esac
done

if (( ${#changed_files[@]} == 0 )); then
  retries=$(jq -r '.factoryHealth.releaseInfraRetries // 0' docs/RELEASE_STATUS.json)
  if (( retries < 2 )); then
    tmp=$(mktemp)
    jq --argjson n "$((retries+1))" '.factoryHealth.releaseInfraRetries=$n' docs/RELEASE_STATUS.json > "$tmp"; mv "$tmp" docs/RELEASE_STATUS.json
    push_state_and_dispatch_finalizer "golden-path failure produced no safe harness delta; one direct retry"
    exit 0
  fi
  echo "::notice::No safe fast-lane delta after retries; escalating to full factory"
  dispatch_factory
  exit 0
fi

echo "Fast-lane harness delta:"
printf '  %s\n' "${changed_files[@]}"

# Targeted trusted validation only. The finalizer itself immediately repeats the
# full product/privacy/cost/i18n/export/native gates, so doing Gradle + exports
# here would be pure duplication.
test -s package-lock.json
npm ci --ignore-scripts --no-audit --no-fund
npm run check
if jq -e '.scripts["privacy:check"]' package.json >/dev/null 2>&1; then npm run privacy:check; fi
if jq -e '.scripts["cost:check"]' package.json >/dev/null 2>&1; then npm run cost:check; fi
if jq -e '.scripts["i18n:check"]' package.json >/dev/null 2>&1; then npm run i18n:check; fi
node --check scripts/e2e-android.js
bash -n scripts/finalizer-e2e.sh

tmp=$(mktemp)
jq '.factoryHealth.releaseInfraRetries=0' docs/RELEASE_STATUS.json > "$tmp"; mv "$tmp" docs/RELEASE_STATUS.json
push_state_and_dispatch_finalizer "harness-only patch passed targeted trusted checks; full gates deferred to immediate finalizer"
