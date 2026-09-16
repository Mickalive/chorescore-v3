# ChoreScore V3

ChoreScore V3 is a shared ledger for what a group pays and what its members do.

## Product thesis

One place to balance two independent ledgers:

- **Contribution ledger** — group-defined Minutes or Points, zero-sum.
- **Financial ledger** — shared expenses, zero-sum.

Cross-ledger compensation is optional, explicit and auditable. The product is 100% free: no Premium tier, paywall, archive lock, group limit or feature gate.

## Migration source

V3 is **not** a greenfield rewrite. The reference implementation is:

- repository: `Mickalive/Chorescore-V2`
- branch: `lab/chorescore-v2`

The V2 domain/application/infrastructure/UI boundaries, Expo Router structure, transaction history, PersistentTask, Todo, invitations, persistence/sync abstractions, privacy analytics architecture, tests and E2E harness are migration assets.

## V3 source of truth

See:

- `docs/V3_CONSTITUTION.md`
- `docs/V2_TO_V3_MIGRATION.md`

## Migration sequence

1. V3-01 — domain: generic contribution unit, expense ledger, settlement, invariants
2. V3-02 — UI structure: V3 theme, no Premium UX, Groups root, Ajouter / Balances / À faire
3. V3-03 — Ajouter: Contribution / Dépense, no chrono, unified history
4. V3-04 — Balances: both ledgers, periods, filters, settlements
5. V3-05 — À faire: Points/Minutes completion
6. V3-06 — invitations and multi-group flow
7. V3-07 — analytics/privacy extensions
8. V3-08 — accessibility, offline/error states, Android golden path and iOS readiness

## Core invariant

Do not turn V3 into “V2 plus an expenses screen”. Transform V2 into one coherent shared-ledger product while preserving proven architecture and privacy boundaries.
