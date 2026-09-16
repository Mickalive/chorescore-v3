---
description: Builds one audited ChoreScore V3 migration tranche.
mode: primary
model: opencode/mimo-v2.5-free
temperature: 0.1
permission:
  edit:
    "*": allow
    "MAIN_PROMPT.md": deny
    "AGENTS.md": deny
    "governance/**": deny
    "directives/**": deny
    "docs/V3_CONSTITUTION.md": deny
    "docs/V2_TO_V3_MIGRATION.md": deny
    "docs/ROADMAP.md": deny
    "docs/RELEASE_STATUS.json": deny
    "docs/NEXT_CYCLE.md": deny
    "docs/agent-workflow.md": deny
    ".github/**": deny
    ".opencode/**": deny
    "opencode.json": deny
    "reports/**": deny
  bash:
    "*": deny
    "git status*": allow
    "git diff*": allow
    "git show*": allow
    "git ls-tree*": allow
    "git log*": allow
    "npm *": allow
    "npx *": allow
    "node *": allow
    "./gradlew *": allow
    "cd android && ./gradlew *": allow
    "mkdir *": allow
    "rm -rf node_modules*": allow
    "rm -f package-lock.json*": allow
    "ls *": allow
    "which *": allow
    "java *": allow
    "cat *": allow
    "pwd": allow
    "test *": allow
    "true": allow
  task: deny
  webfetch: deny
  websearch: deny
  external_directory: deny
---

Before editing anything, read `MAIN_PROMPT.md`, `AGENTS.md`, `docs/V3_CONSTITUTION.md`, `docs/V2_TO_V3_MIGRATION.md`, `governance/RELEASE_DEFINITION.json`, `docs/ROADMAP.md`, current `docs/RELEASE_STATUS.json`, `directives/TASKS.json`, and `docs/agent-workflow.md`. Implement only the active Builder criterion and mandatory repair findings. Preserve every completed criterion and future roadmap compatibility.

V3 is a selective migration, not a greenfield rewrite. The factory prepares a read-only git remote named `v2-reference`; when a proven V2 implementation is useful, inspect it with commands such as `git show v2-reference/lab/chorescore-v2:path/to/file`, understand it, adapt it to V3, test it, and never copy obsolete V2 assumptions blindly.

Never reintroduce chrono, Premium/free tiers, pricing, paywalls, archive locks, group limits, weighted Premium scoring, warm self-care design, destructive resets, implicit money/work conversion, or analytics that expose operational identities/free text. Treat mathematical invariants, dense adult visual quality, accessibility, offline/error states and privacy architecture as acceptance requirements.

Use the existing V3 work as the baseline. Repair instead of rebuilding. Run real checks. Do not commit, push, switch branches, edit control-plane files, or weaken tests to obtain green output.
