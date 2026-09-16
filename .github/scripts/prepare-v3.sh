#!/usr/bin/env bash
set -euo pipefail
main_sha=$(git rev-parse HEAD)
auth=$(printf 'x-access-token:%s' "${GH_TOKEN:?}" | base64 -w0)
branch=lab/chorescore-v3

if git ls-remote --exit-code --heads origin "refs/heads/$branch" >/dev/null 2>&1; then
  git -c "http.extraheader=AUTHORIZATION: basic $auth" fetch origin "+refs/heads/$branch:refs/remotes/origin/$branch"
  accepted_sha=$(git rev-parse "refs/remotes/origin/$branch")
else
  accepted_sha="$main_sha"
  git -c "http.extraheader=AUTHORIZATION: basic $auth" push origin "$main_sha:refs/heads/$branch"
fi

work="${RUNNER_TEMP:?}/v3-prepare"; rm -rf "$work"; git worktree add --detach "$work" "$accepted_sha"
human_paths=(
  MAIN_PROMPT.md
  AGENTS.md
  governance/RELEASE_DEFINITION.json
  docs/V3_CONSTITUTION.md
  docs/V2_TO_V3_MIGRATION.md
  docs/ROADMAP.md
  docs/agent-workflow.md
  directives/DIRECTOR.md
  .opencode
  .github
  opencode.json
)
for path in "${human_paths[@]}"; do
  rm -rf "$work/$path"
  if git cat-file -e "$main_sha:$path" 2>/dev/null; then
    mkdir -p "$work/$(dirname "$path")"
    git archive "$main_sha" "$path" | tar -x -C "$work"
  fi
done

git -C "$work" config user.name chorescore-v3-factory
git -C "$work" config user.email chorescore-v3-factory@users.noreply.github.com
git -C "$work" add -A
if ! git -C "$work" diff --cached --quiet; then
  git -C "$work" commit -m "factory: sync V3 trusted control plane"
  git -c "http.extraheader=AUTHORIZATION: basic $auth" -C "$work" push origin "HEAD:refs/heads/$branch"
fi
accepted_sha=$(git -C "$work" rev-parse HEAD)
status="$work/docs/RELEASE_STATUS.json"; tasks="$work/directives/TASKS.json"

jq -e '.milestone=="v3-rc" and ([.criteria[].id]|sort)==(["V3-01","V3-02","V3-03","V3-04","V3-05","V3-06","V3-07","V3-08"]|sort)' "$status" >/dev/null
final=$(jq -r 'all(.criteria[];.status=="complete") and .pendingArtifact==null and (.activeCriteria|length)==0' "$status")
pending=$(jq -r '.pendingArtifact=="V3-08-RELEASE"' "$status")
stalled=$(jq -r '.factoryHealth.stalled // false' "$status")
builder=$(jq -r '.builder.enabled' "$tasks")

if [[ "$final" == true ]]; then
  jq -e '.builder.enabled==false' "$tasks" >/dev/null
elif [[ "$pending" == true ]]; then
  jq -e '.builder.enabled==false and .builder.criterionId==null and (.activeCriteria|length)==0' "$tasks" "$status" >/dev/null 2>&1 || true
elif [[ "$stalled" == true ]]; then
  jq -e '.builder.enabled==false' "$tasks" >/dev/null
else
  jq -e '(.activeCriteria|length)==1' "$status" >/dev/null
  jq -e '.builder.enabled==true and (.builder.criterionId|type=="string")' "$tasks" >/dev/null
  active=$(jq -r '.activeCriteria[0]' "$status")
  taskcriterion=$(jq -r '.builder.criterionId' "$tasks")
  [[ "$active" == "$taskcriterion" ]] || { echo "::error::Active criterion/task mismatch: $active vs $taskcriterion"; exit 1; }
fi

git worktree remove --force "$work"; git worktree prune
echo "accepted_sha=$accepted_sha" >> "$GITHUB_OUTPUT"
echo "pending_artifact=$pending" >> "$GITHUB_OUTPUT"
echo "builder_enabled=$builder" >> "$GITHUB_OUTPUT"
echo "final=$final" >> "$GITHUB_OUTPUT"
echo "stalled=$stalled" >> "$GITHUB_OUTPUT"
