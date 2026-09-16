# Agent workflow — ChoreScore V3

Each cycle is intentionally narrow and auditable:

1. **Prepare** resolves the accepted V3 baseline on `lab/chorescore-v3`, syncs only the trusted human control plane from `main`, and refuses malformed/final/stalled states.
2. **Probe** tests currently available free OpenCode models. Selection chooses separate Builder and Auditor models when possible.
3. **Builder** works on exactly one active criterion. The V2 repo is available only as read-only git reference. Builder cannot edit governance/workflow/state/report files.
4. **Trusted verification** runs the repository checks. Once an Expo app exists it also checks Expo alignment, Android export/prebuild and a native debug build.
5. **Auditor** independently evaluates the exact candidate delta against the V3 constitution, active gate and regressions. Decision is `accept`, `repair` or `reject`.
6. **Integration** keeps exact audited deltas for `accept` and `repair`; only `reject` discards them. This makes repair iterative instead of reconstructive.
7. **Director** summarizes the audit and next task. Trusted shell normalizes criterion transitions, so model output can never skip a gate.
8. **Relaunch** immediately dispatches the next factory cycle while work remains. A 5-minute schedule is a watchdog. Two non-accepted no-delta cycles set `factoryHealth.stalled=true` and stop Builder loops.
9. **Finalizer** owns final V3-08 completion. The factory can prepare/repair V3-08, but only trusted APK/install/runtime/E2E evidence marks it complete.

The product branch is `lab/chorescore-v3`. `main` is the trusted control-plane/source branch until final promotion. No agent commits or pushes directly; trusted shell alone persists audited state.
