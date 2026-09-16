# Next cycle

Active criterion: **V3-03 — Ajouter + historique unifié** (repair on WIP baseline from cycle 35153706191).

## Objective

Fix the two must-fix findings from the V3-03 audit on the existing coherent WIP baseline:

### MF-1 — Unified history pagination

Rewrite the two-repo merged cursor pagination in `app/(tabs)/add.tsx` (`loadHistory` + `activityEntries` merge):

- The merged cursor must advance correctly across both contribution and expense streams (no duplicate rows, no skipped entries).
- Remove the hard 150-entry cap (`PAGE_SIZE*10`) so every loaded page is visible and "Charger plus" only appears when more entries exist.
- Add tests covering the two-repo merged pagination path: seed >PAGE_SIZE interleaved contributions + expenses, load 3+ pages through the screen's loadHistory logic, assert no duplicate ids, no gaps, and oldest loaded entry is visible.

### MF-2 — Contribution form: PersistentTask, date/heure, share

Add the constitutionally-required features to the contribution form (§5A, V3-03 outcome):

- **PersistentTask shortcuts**: surface the PersistentTask list; selecting one prefills label, value, and default beneficiaries.
- **Date/heure selector**: allow changing `occurredAt` (not locked to todayLocal()).
- **Share action**: wire a share action for history entries via the existing share port (honest adapter).

Keep the form compact and chrono-free.

### Minor findings (fix alongside)

1. Remove leading space from `' Loisirs'` in EXPENSE_CATEGORIES.
2. Deduplicate mount/filter-change double-fetch (single effect keyed on `historyFilter`; skip excluded stream when filter is typed).
3. Add inline custom-split sum pre-validation before expense submit; wrap edit/delete mutations in try/catch with user-facing Alert.

## Preserve

- V3-01 domain untouched (zero-sum ledgers, integer minor units, rate snapshot, Minutes/Points distinct).
- All accepted V3-02 work (expo-sqlite local-first base, RepositoryFactory, demo fixture, three-tab shell, V3 design system, no Premium/paywall/chrono).
- Existing V3-03 work: Contribution|Dépense switch, contribution Minutes/Points without chrono, expense equal/custom split domain validation, compact mixed filterable history, edit/delete replay zero-sum tested, expenses-only and contribution-only forms independent, local optimistic writes, cursor-paginated repositories with SQLite indexes.

## Verification

- `npm run check` green (typecheck + tests).
- Trusted verification: Expo export Android, prebuild, native debug build.
- Required evidence for V3-03: tests covering merged pagination and PersistentTask/date/share, audit passing all acceptance criteria.
