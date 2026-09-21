# Next Cycle — 35555772885

## Decision: continue

V3-08 audit decision is **repair**. The cycle produced no delta (changedFiles=0, hasDelta=false). The trusted finalizer failure from run 35552961193 remains unaddressed. The emulator E2E golden-path step has failed 15 consecutive dispatched finalizer runs while all other gates pass.

## Must-fix finding

The stuck-app detector in `scripts/e2e-android.js` uses `STUCK_APP_THRESHOLD=4` consecutive real dumps with no label match to force-stop the app. On a slow API 35 x86_64 emulator (cold start up to 240s, dump latency 30-60s each), 4 real dumps = 2-4 minutes, which can kill a healthy app during cold start before "Demarrer (demo)" renders. The cold start resets each force-stop, creating an infinite kill loop.

## What the next Builder must do

1. **Inspect step-7 evidence** of run 35552961193 (logcat-wait-*.txt, logcat-failure.txt, dump-*.xml, step logs — accessible via factory token) to confirm the hypothesis.
2. **Repair the stuck-app detector** — primary approaches:
   - Time-based guard: only trigger stuck detection after the app has been launched for at least N seconds (e.g. 300s).
   - Higher threshold: increase `STUCK_APP_THRESHOLD` beyond 4 (e.g. 8-10).
   - Process-liveness check: skip force-stop if the app process is alive and dumps are healthy (not empty).
3. If the evidence shows an **infrastructure-only failure** (emulator boot/KVM), document it explicitly so the trusted shell can decide on a workflow-level remedy.
4. Preserve V3-01 through V3-07 and all accepted invariants.
5. Full trusted verification must exit 0.

## All criteria status

| Criterion | Status |
|-----------|--------|
| V3-01 | complete |
| V3-02 | complete |
| V3-03 | complete |
| V3-04 | complete |
| V3-05 | complete |
| V3-06 | complete |
| V3-07 | complete |
| V3-08 | in_progress — audit repair, 1 mustFix (E2E stuck-app detector) pending fix |

## Factory status

Builder is enabled. The next cycle targets V3-08 repair of the E2E stuck-app detector false-positive.
