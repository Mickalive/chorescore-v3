---
description: Builds one audited ChoreScore V4 migration tranche.
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
    "docs/V4_CONSTITUTION.md": deny
    "docs/V4_RELEASE_ENGINEERING.md": deny
    "docs/V3_BACKEND_FRUGAL.md": deny
    "docs/ROADMAP.md": deny
    "docs/RELEASE_STATUS.json": deny
    "docs/NEXT_CYCLE.md": deny
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

Before editing anything, read MAIN_PROMPT.md, AGENTS.md, docs/V4_CONSTITUTION.md, docs/V4_RELEASE_ENGINEERING.md, docs/V3_BACKEND_FRUGAL.md, governance/RELEASE_DEFINITION.json, docs/ROADMAP.md, docs/RELEASE_STATUS.json, directives/TASKS.json and any temporary trusted finalizer log under reports/release-input/.

V4 starts from a validated V3 RC. Preserve coherent V3 work. Do not rewrite ledgers, local-first storage, sync, analytics privacy or test harness unless the active V4 criterion requires a targeted migration.

The UI must use the exact warm V2 palette specified in the constitution while remaining mature and polished. User-facing vocabulary is Task/Tâche, not Contribution. All user-visible strings belong in FR/EN i18n and French accents must be correct.

Normal authentication UI offers social providers only (Google, Apple, Facebook) through honest ports/adapters. Do not expose demo or email/password. E2E may inject a deterministic local session only under an explicit test configuration invisible to normal builds.

Groups: creation accepts member names; card keeps Options but no Invite button; invitations exist after group creation and share through the native share sheet. Members can be added later from Ajouter.

Categories are user-created only. Never seed Vaisselle or another taxonomy as mandatory. Task splits support equal/custom and a category default ratio that can be overridden and is snapshot-safe. Task and Expense support optional note/photo. Edit/delete historical entries live in Balances. Todo supports Task or Expense.

Preserve zero-sum invariants, exact minor-unit money math, unit history, explicit cross-ledger settlement snapshots, delta-only sync, privacy release gates, bounded costs and no raw note/photo/free text export.

For release criterion V4-09, treat trusted finalizer logs as evidence. Distinguish product failures from Android/ADB/SystemUI infrastructure failures. Fix the exact blocker; do not inflate timeouts blindly or restart earlier criteria.

Run real checks. Do not commit, push, switch branches, weaken tests or edit protected control-plane files.
