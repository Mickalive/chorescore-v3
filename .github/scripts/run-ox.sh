#!/usr/bin/env bash
set -euo pipefail
max_attempts="${OPENCODE_MAX_ATTEMPTS:-3}"
retry_delay="${OPENCODE_RETRY_DELAY_SECONDS:-300}"
attempt_timeout="${OPENCODE_ATTEMPT_TIMEOUT_SECONDS:-3000}"
label="${OPENCODE_RETRY_LABEL:-agent}"
log_file=$(mktemp "${RUNNER_TEMP:?}/opencode-${label}.XXXXXX.log")
trap 'rm -f "$log_file"' EXIT
for ((attempt=1; attempt<=max_attempts; attempt++)); do
  : >"$log_file"
  echo "OpenCode $label attempt $attempt/$max_attempts"
  set +e
  timeout --signal=TERM --kill-after=30s "$attempt_timeout" "$@" 2>&1 | tee "$log_file"
  status=${PIPESTATUS[0]}
  set -e
  (( status == 0 )) && exit 0
  if ! grep -Eqi 'network_error|network error|server error|temporarily unavailable|service unavailable|bad gateway|gateway timeout|too many requests|connection (reset|closed|refused)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|timed out|timeout|rate[_ -]?limit|HTTP[^0-9]*(429|500|502|503|504)' "$log_file"; then
    exit "$status"
  fi
  (( attempt < max_attempts )) || exit 75
  sleep "$retry_delay"
done
