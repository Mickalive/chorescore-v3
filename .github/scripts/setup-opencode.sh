#!/usr/bin/env bash
set -euo pipefail

OPENCODE_INSTALL_COMMIT="${OPENCODE_INSTALL_COMMIT:-03bba464d46f3eddf74195919b1344aa937f7b11}"
OPENCODE_INSTALL_BLOB="${OPENCODE_INSTALL_BLOB:-b0716d532082c6f7a59348fbda53915bacd86db8}"
OPENCODE_VERSION="${OPENCODE_VERSION:-1.18.21}"

if [[ -x "$HOME/.opencode/bin/opencode" ]] && [[ "$("$HOME/.opencode/bin/opencode" --version 2>/dev/null || true)" == "$OPENCODE_VERSION" ]]; then
  export PATH="$HOME/.opencode/bin:$PATH"
  [[ -n "${GITHUB_PATH:-}" ]] && echo "$HOME/.opencode/bin" >> "$GITHUB_PATH"
  return 0 2>/dev/null || exit 0
fi

installer="${RUNNER_TEMP:?}/opencode-install"
curl --proto '=https' --tlsv1.2 -fsSLo "$installer" "https://raw.githubusercontent.com/anomalyco/opencode/${OPENCODE_INSTALL_COMMIT}/install"
actual_blob=$(git hash-object "$installer")
[[ "$actual_blob" == "$OPENCODE_INSTALL_BLOB" ]] || { echo "::error::OpenCode installer integrity check failed"; exit 1; }
bash "$installer" --version "$OPENCODE_VERSION" --no-modify-path
installed=$("$HOME/.opencode/bin/opencode" --version)
[[ "$installed" == "$OPENCODE_VERSION" ]] || { echo "::error::Expected OpenCode $OPENCODE_VERSION, got $installed"; exit 1; }
export PATH="$HOME/.opencode/bin:$PATH"
[[ -n "${GITHUB_PATH:-}" ]] && echo "$HOME/.opencode/bin" >> "$GITHUB_PATH"
