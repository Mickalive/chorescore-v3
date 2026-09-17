# Next cycle

Active criterion: **V3-08 — Finition, accessibilite, cout et release mobile** (repair).

## Objective

Repair the single must-fix finding in the existing V3-08 WIP delta. Do not rebuild — the candidate baseline (880-line cost-gate test suite, 10 gates) is the starting point.

## Must-fix finding

### F1 — Unescaped apostrophe in describe string literal

**Path:** `__tests__/domain/cost-gates-v3-08.test.ts` line 205

```
describe('V3-08 Gate 2: Tab switching doesn't reload same objects', () => {
```

The `'` in `doesn't` terminates the single-quoted string literal prematurely. TypeScript sees `doesn` as a complete string, then `t` as an unexpected identifier, producing 10 cascading parse errors (TS1005, TS1002, TS1128) across lines 205-260. Typecheck exits 2 and the full test suite never runs.

**Fix:** Escape the apostrophe or switch the outer quotes to backtick:
```
describe(`V3-08 Gate 2: Tab switching doesn't reload same objects`, () => {
```

The comment on line 202 should also be updated for consistency (no TS impact).

## Verification

- `npx tsc --noEmit` exits 0
- All 391+ tests pass (19+ suites)
- All V3-01 through V3-07 regression suites pass
- V3-08 cost-gate test suite runs green covering: 50k reads, tab switching, sync deltas, bounded writes, classification cache, privacy gate, cost budgets, offline fallback, golden path E2E, accessibility/design system
