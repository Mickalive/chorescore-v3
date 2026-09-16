#!/usr/bin/env bash
set -euo pipefail
root="${1:?probe root}"; out="${RUNNER_TEMP:?}/model-selection"; mkdir -p "$out"
mapfile -t files < <(find "$root" -type f -name probe.json -print | sort)
healthy=(); for f in "${files[@]}"; do jq -e '.healthy==true' "$f" >/dev/null && healthy+=("$(jq -r .model "$f")"); done
(( ${#healthy[@]} > 0 )) || { echo "::error::No healthy free model"; exit 75; }
contains(){ local n="$1"; shift; for x in "$@"; do [[ "$x" == "$n" ]] && return 0; done; return 1; }
pref=(mimo-v2.5-free hy3-free big-pickle muse-spark-1.2-contributor-free nemotron-3-ultra-free nemotron-3.5-lightning-free deepseek-v4-flash-free north-mini-code-free laguna-s-2.1-free ling-3.0-flash-free ling-3.0-tiny-free x-preview-f-free)
pick(){ local avoid="${1:-}"; for m in "${pref[@]}"; do contains "$m" "${healthy[@]}" && [[ "$m" != "$avoid" ]] && { echo "$m"; return; }; done; echo "${healthy[0]}"; }
builder=$(pick); auditor=$(pick "$builder"); director=$(pick)
jq -n --arg builder "$builder" --arg auditor "$auditor" --arg director "$director" --argjson healthyCount "${#healthy[@]}" '{schemaVersion:1,healthyCount:$healthyCount,selected:{builder:$builder,auditor:$auditor,director:$director}}' > "$out/selection.json"
echo "builder_model=opencode/$builder" >> "$GITHUB_OUTPUT"
echo "auditor_model=opencode/$auditor" >> "$GITHUB_OUTPUT"
echo "director_model=opencode/$director" >> "$GITHUB_OUTPUT"
echo "healthy_count=${#healthy[@]}" >> "$GITHUB_OUTPUT"
cat "$out/selection.json"
