# Next cycle

Active criterion: **V3-05 — À faire** (new criterion after V3-04 accepted).

## Objective

Migrate `TodoScreen.tsx` from V2 as a direct evolution. Build the "À faire" tab with full todo lifecycle: creation, assignment, scheduling, completion, and integration with the contribution ledger.

### Requirements (from roadmap §V3-05 and constitution §11)

1. **TodoScreen migration**: Preserve title, assignee (Fait par), beneficiaries (Fait pour), due date, reminder, note, PersistentTask integration, creation, deletion, and completion via mini-formula.
2. **Atomic completion**: When a task is completed:
   - Confirm `Fait par` (who did it)
   - Confirm value (minutes or points based on group unit)
   - Confirm `Fait pour` (who benefits)
   - Create atomically exactly one `ContributionEntry`
   - Update contribution ledger
   - Mark todo as completed
3. **Unit-aware**: If group is in Minutes → ask value in minutes. If group is in Points → ask value in points.
4. **No chrono**: Zero chrono references anywhere in the todo flow.
5. **Data-change signal**: Completed tasks emit `data-change` signal so Balances tab reflects the new contribution without full reload.
6. **Free**: All todo functionality is free — no paywall, no restrictions, no premium gating.
7. **Local-first**: Todo creation and completion work offline; sync queue handles remote persistence.
8. **PersistentTask**: Default value can come from the PersistentTask template.

### Acceptance criteria

- TodoScreen renders within the "À faire" tab with V3 design system
- Creation form accepts title, assignee, beneficiaries, due date, value, PersistentTask
- Completion flow asks for Fait par, value, Fait pour, then creates ContributionEntry atomically
- Unit is respected: group Points → points input; group Minutes → minutes input
- No chrono anywhere in the file or its imports
- Completion emits data-change signal
- Existing V3-01/V3-02/V3-03/V3-04 tests remain green
- Todo-specific tests cover: create, complete, unit-aware value, ledger integration
- No regressions on balances, contribution, expense, or settlement logic

## Preserve

- V3-01 domain untouched (zero-sum ledgers, integer minor units, rate snapshot, Minutes/Points distinct).
- V3-02 accepted work (expo-sqlite local-first base, RepositoryFactory, three-tab shell, V3 design system).
- V3-03 accepted work (Contribution|Expense switch, contribution without chrono, expense entry, unified history).
- V3-04 accepted work (dual ledger balances, period views, settlement, currency detection, data-level delta handler).

## Verification

- `npm run check` green (typecheck + tests).
- Trusted verification: Expo export Android, prebuild, native debug build.
- Required evidence for V3-05: tests covering todo create, todo complete with ledger integration, unit-aware value input, data-change signal emission, no chrono references.
