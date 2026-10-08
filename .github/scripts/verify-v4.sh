#!/usr/bin/env bash
set -euo pipefail
label="${1:-verification}"
criterion=$(jq -r '.builder.criterionId // ""' directives/TASKS.json 2>/dev/null || true)
echo "=== ChoreScore V4 trusted $label ($criterion) ==="

if [[ ! -f package.json ]]; then
  echo "No package.json; nothing to verify."
  exit 0
fi

if [[ -s package-lock.json ]]; then
  npm ci --ignore-scripts --no-audit --no-fund
else
  npm install --ignore-scripts --no-audit --no-fund
fi

npm run check
if jq -e '.scripts["privacy:check"]' package.json >/dev/null 2>&1; then npm run privacy:check; fi
if jq -e '.scripts["cost:check"]' package.json >/dev/null 2>&1; then npm run cost:check; fi
if jq -e '.scripts["i18n:check"]' package.json >/dev/null 2>&1; then npm run i18n:check; fi

if jq -e '.dependencies.expo or .devDependencies.expo' package.json >/dev/null && [[ -f app.json || -f app.config.js || -f app.config.ts ]]; then
  test -s package-lock.json || { echo "::error::Expo application must commit package-lock.json"; exit 1; }
  npx --no-install expo install --check
  npx --no-install expo export --platform android --output-dir "${RUNNER_TEMP:?}/v4-${label}-android-export"

  if [[ "$criterion" == "V4-08" || "$criterion" == "V4-09" ]]; then
    npx --no-install expo export --platform ios --output-dir "${RUNNER_TEMP:?}/v4-${label}-ios-export"
  fi

  native_sensitive=false
  if [[ "$criterion" == "V4-09" ]]; then
    native_sensitive=true
  elif ! git diff --quiet HEAD -- package.json package-lock.json app.json app.config.js app.config.ts android ios 2>/dev/null; then
    native_sensitive=true
  fi

  if [[ "$native_sensitive" == true ]]; then
    echo "Native-sensitive delta: running Android prebuild/debug compile"
    npx --no-install expo prebuild --platform android --no-install
    (cd android && ./gradlew :app:assembleDebug --no-daemon)
  else
    echo "Skipping expensive native Gradle compile for non-native V4 tranche"
  fi
fi
