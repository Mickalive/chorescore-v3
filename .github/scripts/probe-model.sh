#!/usr/bin/env bash
set -euo pipefail
model="${1:?model id required}"
out="${RUNNER_TEMP:?}/model-probe-$model"; mkdir -p "$out"
target=.factory-probe-target
nonce="CHORESCORE_V3_PROBE_${GITHUB_RUN_ID:-local}_${RANDOM}_$(date +%s)"
printf '%s\n' "$nonce" > "$target"
log="$out/probe.log"; started=$(date +%s)
set +e
timeout --signal=TERM --kill-after=10s 90s opencode run --model "opencode/$model" --agent model-probe "Use bash to run exactly: cat .factory-probe-target . Then reply with exactly the content." >"$log" 2>&1
status=$?
set -e
healthy=false; (( status == 0 )) && grep -Fq "$nonce" "$log" && healthy=true
elapsed=$(( $(date +%s)-started ))
reason=ok; [[ "$healthy" == true ]] || reason=failed
jq -n --arg model "$model" --argjson healthy "$healthy" --arg reason "$reason" --argjson exitStatus "$status" --argjson elapsedSeconds "$elapsed" '{schemaVersion:1,model:$model,healthy:$healthy,reason:$reason,exitStatus:$exitStatus,elapsedSeconds:$elapsedSeconds}' > "$out/probe.json"
rm -f "$target" "$log"; cat "$out/probe.json"
