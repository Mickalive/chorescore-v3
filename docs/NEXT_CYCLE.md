# Next cycle

Active criterion: **V3-03 — Ajouter + historique unifié** (repair on WIP baseline from cycle 35158693615).

## Objective

Fix the four must-fix findings from the V3-03 audit on the existing coherent WIP baseline:

### MF-1 — Equal-timestamp pagination gap

The cursor is exclusive on `occurredAt` alone with no secondary sort key. When >PAGE_SIZE entries share one timestamp, overflow entries are permanently unreachable.

**Fix:** Implement composite cursor (occurredAt + id) with deterministic secondary sort key in both `InMemoryRepositories.ts` and `SqliteRepositories.ts` (`getByHouseholdPaginated`):
- `ORDER BY occurredAt DESC, id DESC`
- Cursor predicate: `(occurredAt < c.occurredAt OR (occurredAt = c.occurredAt AND id < c.id))`

**Test:** Seed ≥PAGE_SIZE+5 entries with one identical occurredAt plus older entries. Page through until `hasMore=false`. Assert every seeded id is reachable exactly once.

### MF-2 — 'Charger plus' race produces duplicate ids

No in-flight guard on `loadHistory(true)` — two concurrent calls append the same page twice, producing duplicate ids in the merged view.

**Fix:** Add an `isLoadingMore` ref guard in `add.tsx` (skip second call while first is in flight) OR dedupe by entry id in the `paginateActivityLog` merge step.

**Test:** Fire two concurrent `loadHistory(true)` calls. Assert the merged list has no duplicate ids.

### MF-3 — Share message uses current household unit instead of entry unit

The share message and history row display use the current `householdUnit` instead of the entry's stored `unit` field, silently mislabeling entries after a group unit change (constitution §18).

**Fix:** Use `e.unit` (the per-entry stored unit) in `handleShare` and in the history row display, not the current household unit.

**Test:** Create a contribution with unit 'minutes'. Set household unit to 'points'. Share the entry and assert the message shows 'min'. Same for history row display.

### MF-4 — Custom-split validation does not block submit

The inline error is displayed but submit stays enabled; invalid expenses can enter the ledger.

**Fix:** Block submit when `sum(customShares) != amountMinor`:
- Disable the Button when split is custom and sum ≠ amount
- OR early-return in `submitExpense` with the inline error

**Test:** Enter custom shares that do not sum to the amount. Assert submit is disabled / no write occurs.

### Minor findings (fix alongside)

1. Use `services.share` from `useApp()` instead of `new LocalSystemShareAdapter()` in `handleShare`.
2. Reduce Alert date buttons to ≤3 on Android (platform-conditional or merge 'Il y a 1h' + 'Hier' into 'Plus tot').

## Preserve

- V3-01 domain untouched (zero-sum ledgers, integer minor units, rate snapshot, Minutes/Points distinct).
- All accepted V3-02 work (expo-sqlite local-first base, RepositoryFactory, demo fixture, three-tab shell, V3 design system, no Premium/paywall/chrono).
- Previous cycle fixes: independent per-repo cursors, no systematic duplicates, no 150 cap, PersistentTask shortcuts, date/heure selector, share action, leading space fix, double-fetch dedup, custom-split inline validation, try/catch error handling.

## Verification

- `npm run check` green (typecheck + tests).
- Trusted verification: Expo export Android, prebuild, native debug build.
- Required evidence for V3-03: tests covering equal-timestamp pagination, concurrent load-more, entry-stored unit in share/display, and custom-split submit blocking; audit passing all acceptance criteria.
