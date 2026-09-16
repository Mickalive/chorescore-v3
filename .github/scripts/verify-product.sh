#!/usr/bin/env bash
set -euo pipefail
label="${1:-verification}"
echo "=== ChoreScore V3 trusted $label ==="
if [[ ! -f package.json ]]; then
  echo "No package.json yet; nothing to verify."
  exit 0
fi

if [[ -s package-lock.json ]]; then
  npm ci --ignore-scripts --no-audit --no-fund
else
  npm install --ignore-scripts --no-audit --no-fund
fi
npm run check

if jq -e '.scripts["privacy:check"]' package.json >/dev/null 2>&1; then
  npm run privacy:check
fi
if jq -e '.scripts["cost:check"]' package.json >/dev/null 2>&1; then
  npm run cost:check
fi

if jq -e '.dependencies.expo or .devDependencies.expo' package.json >/dev/null && [[ -f app.json || -f app.config.js || -f app.config.ts ]]; then
  test -s package-lock.json || { echo "::error::Expo application must commit package-lock.json"; exit 1; }
  npx --no-install expo install --check
  npx --no-install expo export --platform android --output-dir "${RUNNER_TEMP:?}/v3-${label}-export"
  npx --no-install expo prebuild --platform android --no-install
  (cd android && ./gradlew :app:assembleDebug --no-daemon)
fi
