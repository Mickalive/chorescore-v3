# Next cycle

Active criterion: **V3-03 — Ajouter + historique unifié** (V3-02 accepted in cycle 35146343615).

## Objective

Build the `Contribution | Dépense` switch in the same product:

1. **Contribution** — free label + PersistentTask + Fait par / Fait pour + date + edit/delete/share, no chrono, Minutes or Points per group unit.
2. **Dépense** — free title, amount/currency, paid by/for, equal/custom split, date/note/category.
3. **Historique** — unified compact list directly under the form, filterable (Tout / Contributions / Dépenses / Compensations).

## Frugal obligations (roadmap-assigned, not optional polish)

- Mutations optimistic and transactional in local storage, updating ledgers/materialized views correctly.
- History paginated/cursor-based and cached — never reloaded integrally, no full download.
- Groups expenses-only and contribution-only both functional.
- Writes bounded and local-first; no network round-trip required to render the tab.

## Preserve

- V3-01 domain untouched (zero-sum ledgers, integer minor units, rate snapshot, Minutes/Points distinct).
- All accepted V3-02 work: expo-sqlite local-first base, RepositoryFactory, demo fixture, three-tab shell, V3 design system, no Premium/paywall/chrono.

## Verification

- `npm run check` green (typecheck + tests).
- Trusted verification: Expo export Android, prebuild, native debug build.
- Required evidence for V3-03: tests, audit, reference-scenarios.