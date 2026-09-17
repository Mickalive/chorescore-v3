# Next cycle

Active criterion: **V3-07 — Data product, privacy plane et pipeline frugale** (repair).

## Objective

Repair the 5 must-fix findings in the existing V3-07 WIP delta. Do not rebuild — the candidate baseline (12 new files, 1151-line test suite, 60/70 tests pass) is the starting point.

## Must-fix findings

### F1 — Test-file type errors (trusted exit 2)
8 TypeScript errors in `__tests__/domain/v3-07-analytics-privacy.test.ts`:
- Line 434: `label` not in anonymous event union → use `as unknown as` cast
- Lines 501–505: partial records missing required fields → use full valid event shapes or casts
- Line 730: `'commercial-use'` not a `DataProcessingPurpose` → replace with valid purpose or cast
- Line 870: invalid cast to `Record<string, unknown>` → use `as unknown as`

### F2 — Pipeline label contradiction (core broken path)
`validateNoOperationalIds` (pipeline.ts) forbids `label` as input, but `transformContributionCreated` and `transformEntryCreated` require `label` for classification. All contribution/entry facts are rejected at stage 1 — transforms are dead code.

**Fix:** Remove `label`/`title`/`notes` from the input-forbidden list. These are consumed for classification and never emitted — rely on output event types + PrivacyReleaseGate to guarantee no free text in outputs. Add a test proving a labeled contribution transforms successfully with no text in the emitted event.

### F3 — Gate tests unpassable
`assessReIdentificationRisk` flags datasets < 10 records with `re_identification_risk` (high), blocking approval. Tests use 5 records and empty data expecting `approved=true`.

**Fix:** Use ≥10 records with repeated (category, month, beneficiaryCount) combinations so `combinations.size ≤ facts.length * 0.8` and `facts.length ≥ minCohortSize * 2`. Do not weaken the gate.

### F4 — Query budget mismatch
Test expects `remainingQueriesThisMinute=1` but service returns 2 (`limit - used - 1`).

**Fix:** Align test and implementation on one documented semantic.

### F5 — Consent expiry race
`retentionDays: 0` with strict `<` comparison fails in same-millisecond jest execution.

**Fix:** Use negative retentionDays (e.g. `-1`) or change comparison to `<=`. Make deterministic.

## Verification

- `npx tsc --noEmit` exits 0
- All 70+ tests pass (no new failures)
- All V3-01 through V3-06 regression suites pass (380+ tests)
- Contribution/entry pipeline path proven functional with no free text in output events
