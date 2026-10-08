#!/usr/bin/env bash
set -euo pipefail
main_sha=$(git rev-parse HEAD)
auth=$(printf 'x-access-token:%s' "${GH_TOKEN:?}" | base64 -w0)
branch=lab/chorescore-v4

if git ls-remote --exit-code --heads origin "refs/heads/$branch" >/dev/null 2>&1; then
  git -c "http.extraheader=AUTHORIZATION: basic $auth" fetch origin "+refs/heads/$branch:refs/remotes/origin/$branch"
  accepted_sha=$(git rev-parse "refs/remotes/origin/$branch")
else
  git -c "http.extraheader=AUTHORIZATION: basic $auth" fetch origin "+refs/heads/lab/chorescore-v3:refs/remotes/origin/lab/chorescore-v3"
  accepted_sha=$(git rev-parse refs/remotes/origin/lab/chorescore-v3)
  git -c "http.extraheader=AUTHORIZATION: basic $auth" push origin "$accepted_sha:refs/heads/$branch"
fi

work="${RUNNER_TEMP:?}/v4-prepare"
rm -rf "$work"
git worktree add --detach "$work" "$accepted_sha"

# Sync only trusted execution machinery from main. V4 product constitution/state
# lives on lab/chorescore-v4 and is never overwritten by V3 control files.
for path in .github .opencode opencode.json; do
  rm -rf "$work/$path"
  if git cat-file -e "$main_sha:$path" 2>/dev/null; then
    mkdir -p "$work/$(dirname "$path")"
    git archive "$main_sha" "$path" | tar -x -C "$work"
  fi
done

git -C "$work" config user.name chorescore-v4-factory
git -C "$work" config user.email chorescore-v4-factory@users.noreply.github.com
git -C "$work" add -A
if ! git -C "$work" diff --cached --quiet; then
  git -C "$work" commit -m "factory: sync V4 execution control plane"
  git -c "http.extraheader=AUTHORIZATION: basic $auth" -C "$work" push origin "HEAD:refs/heads/$branch"
fi
accepted_sha=$(git -C "$work" rev-parse HEAD)
status="$work/docs/RELEASE_STATUS.json"
tasks="$work/directives/TASKS.json"

jq -e '.milestone=="v4-rc" and ([.criteria[].id]|sort)==(["V4-01","V4-02","V4-03","V4-04","V4-05","V4-06","V4-07","V4-08","V4-09"]|sort)' "$status" >/dev/null
final=$(jq -r 'all(.criteria[];.status=="complete") and .pendingArtifact==null and (.activeCriteria|length)==0' "$status")
pending=$(jq -r '.pendingArtifact=="V4-09-RELEASE"' "$status")
stalled=$(jq -r '.factoryHealth.stalled // false' "$status")
builder=$(jq -r '.builder.enabled' "$tasks")

if [[ "$final" == true ]]; then
  jq -e '.builder.enabled==false' "$tasks" >/dev/null
elif [[ "$pending" == true ]]; then
  jq -e '.builder.enabled==false' "$tasks" >/dev/null
  jq -e '(.activeCriteria|length)==0' "$status" >/dev/null
else
  jq -e '(.activeCriteria|length)==1' "$status" >/dev/null
  jq -e '.builder.enabled==true and (.builder.criterionId|type=="string")' "$tasks" >/dev/null
  active=$(jq -r '.activeCriteria[0]' "$status")
  taskcriterion=$(jq -r '.builder.criterionId' "$tasks")
  [[ "$active" == "$taskcriterion" ]] || { echo "::error::Active V4 criterion/task mismatch: $active vs $taskcriterion"; exit 1; }
fi

git worktree remove --force "$work"
git worktree prune
echo "accepted_sha=$accepted_sha" >> "$GITHUB_OUTPUT"
echo "pending_artifact=$pending" >> "$GITHUB_OUTPUT"
echo "builder_enabled=$builder" >> "$GITHUB_OUTPUT"
echo "final=$final" >> "$GITHUB_OUTPUT"
echo "stalled=$stalled" >> "$GITHUB_OUTPUT"
