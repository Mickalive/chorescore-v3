# V2 → V3 migration map

Reference upstream: `Mickalive/Chorescore-V2@lab/chorescore-v2`.

This map is based on an audit of the V2 constitution, architecture, domain entities/calculations, application facade, the three household screens, design system, analytics/privacy modules, tests and visual evidence.

## Executive conclusion

V2 already contains the right architectural skeleton. V3 should not copy its product assumptions blindly, but it should preserve its boundaries and proven subsystems.

The major migrations are:

- time-only contribution → generic `minutes | points` contribution ledger;
- one ledger → two independent ledgers (contribution + money);
- optional explicit cross-ledger settlement;
- household-first wording → generic group UX;
- freemium/entitlements → fully free product behavior;
- warm/self-care design → precise/adult/premium design;
- chrono → removed completely;
- analytics/privacy → preserved and extended, not replaced.

---

## 1. Keep essentially unchanged

### Architecture boundaries

Keep the dependency direction and folders:

- `src/domain/`
- `src/application/`
- `src/infrastructure/`
- `src/features/`
- `src/ui/`
- `app/` Expo Router routes

Do not introduce a provider-specific backend into the domain.

### Identity and group membership

Keep/adapt:

- `User`
- `Membership`
- `Household` internally during migration when renaming adds risk
- `Member`
- tenant isolation
- auth abstraction
- invitation abstraction
- secure storage abstraction
- sync abstraction

UX wording becomes `Groupe`.

### Shared product capabilities

Keep/adapt:

- native share boundary
- notification boundary
- calendar boundary
- persistence repositories
- transaction-style history
- member selectors / performed-by / beneficiaries semantics
- `PersistentTask`
- `TodoItem`
- Expo Router three-tab structure

### Analytics/privacy

Preserve the existing privacy stack:

- taxonomy service
- transform pipeline
- query budget
- differential privacy
- release gate
- buyer contracts
- export audit log
- consent policy

The existing rule remains: operational data may be personal/pseudonymized and protected; externally released research data must pass irreversible anonymization/aggregation controls.

---

## 2. Extend / generalize

### `Household`

Add group configuration without forcing an immediate internal rename:

```ts
export type ContributionUnit = 'minutes' | 'points';

export interface Household {
  id: string;
  name: string;
  ownerId: string;
  contributionUnit: ContributionUnit;
  crossLedgerCompensationEnabled: boolean;
  contributionToMoneyRate: ContributionMoneyRate | null;
  createdAt: string;
}
```

The exact rate model must snapshot currency and both quantities rather than storing only a floating multiplier.

### `CompletedEntry` → `ContributionEntry`

Migrate conceptually from duration-specific data to unit-aware contribution data.

Target direction:

```ts
export interface ContributionEntry {
  id: string;
  householdId: string;
  label: string;
  performedByMemberId: string;
  beneficiaryMemberIds: string[];
  value: number;
  unit: 'minutes' | 'points';
  persistentTaskId: string | null;
  occurredAt: string;
  createdBy: string;
  modifiedBy?: string;
}
```

Historical entries must carry their own unit so a later group-unit change never silently reinterprets them.

### `PersistentTask`

Replace duration/weight assumptions with a default contribution value and optional defaults:

```ts
export interface PersistentTask {
  id: string;
  householdId: string;
  name: string;
  defaultValue: number;
  defaultUnit: 'minutes' | 'points';
  defaultBeneficiaryMemberIds?: string[];
  createdAt: string;
}
```

It remains a convenience shortcut, never a mandatory taxonomy.

### Contribution calculations

Generalize the existing zero-sum formula from minutes to arbitrary contribution value `V`.

For performer `P` and beneficiaries `B`:

- performer receives `+V`;
- each beneficiary receives `-V / |B|`;
- if performer is also a beneficiary, their share cancels naturally;
- total balance must remain zero within numeric tolerance.

Period filtering stays a view. The principal contribution balance is all-time/persistent.

### Expense ledger

Add:

```ts
export type ExpenseSplitMode = 'equal' | 'custom';

export interface ExpenseParticipantShare {
  memberId: string;
  amountMinor: number;
}

export interface ExpenseEntry {
  id: string;
  householdId: string;
  title: string;
  amountMinor: number;
  currency: string;
  paidByMemberId: string;
  participantMemberIds: string[];
  splitMode: ExpenseSplitMode;
  customShares?: ExpenseParticipantShare[];
  note?: string;
  category?: string;
  occurredAt: string;
  createdBy: string;
  modifiedBy?: string;
}
```

Use integer minor currency units in the ledger. Do not make floating-point UI amounts the source of truth.

The expense ledger must be independently zero-sum per currency.

### Cross-ledger settlement

Add an immutable/auditable entry that snapshots the rate used:

```ts
export interface ContributionMoneyRate {
  contributionValue: number;
  contributionUnit: 'minutes' | 'points';
  moneyAmountMinor: number;
  currency: string;
}

export interface CrossLedgerSettlement {
  id: string;
  householdId: string;
  fromMemberId: string;
  toMemberId: string;
  contributionValue: number;
  contributionUnit: 'minutes' | 'points';
  moneyAmountMinor: number;
  currency: string;
  rateSnapshot: ContributionMoneyRate;
  occurredAt: string;
  createdBy: string;
}
```

Changing the group rate later must not alter old settlements.

### `ScoreResult`

Do not preserve the name as the long-term public domain model. Introduce a generic balances representation, optionally with a temporary compatibility wrapper while screens migrate.

Target concepts:

- contribution balances;
- financial balances grouped by currency;
- pairwise suggested settlements;
- filtered activity;
- all-time headline + period views.

---

## 3. Remove from product behavior

### Chrono

Delete all functional dependencies on:

- `ChronoTimerState`
- chrono repository
- `startChrono`
- `stopChrono`
- `getChronoState`
- `ChronoTimer` UI
- manual/chrono mode toggle

Minutes in V3 are user-assigned contribution values, never measured elapsed time.

### Freemium behavior

Remove all product behavior tied to:

- `PlanType`
- pricing constants
- trial startup
- archive restriction
- score archive restriction
- Todo gating
- weighting gating
- additional household gating
- Premium routes / upsells / locks / plan badges

If entitlement/billing ports remain temporarily during migration, they must become behaviorally inert and be removed once no longer needed.

### V2 weighted contribution mode

The V2 `weight`/weighted-balance feature is not part of the V3 product thesis. Do not carry it forward merely because it exists.

### Warm design language

Replace terracotta/cream/sage/self-care tokens and copy. Retain V2's strengths: compact forms, low card count, transaction density, clear hierarchy and restrained motion.

---

## 4. Screen-by-screen migration

### Root `app/index.tsx`

Keep the simple group list structure.

Remove:

- plan badges
- Premium CTA
- creation restrictions

Add/ensure:

- unlimited free groups
- real invitation/share path
- generic group wording

### `AddTaskScreen.tsx` → Ajouter

Keep:

- input-first composition
- quick PersistentTask shortcuts
- performed by / for
- editing / deletion / sharing
- history directly underneath

Change:

- top-level switch `Contribution | Dépense`
- duration field → generic contribution value field
- remove chrono entirely
- add expense form
- unified transaction history with subtle type indication

### `ScoreScreen.tsx` → Balances

Reuse:

- period selector
- compact balance presentation
- filters
- pairwise settlement logic patterns
- bars only where informative
- filtered history
- share capability

Replace:

- Premium locks
- `Score` vocabulary
- weighted section

Add:

- contribution headline balance
- money headline balance(s)
- optional cross-ledger compensation action
- perpetual balance clearly distinct from historical period views

### `TodoScreen.tsx` → À faire

Keep the planning model and atomic completion concept.

Remove Premium gating.

On completion, request/confirm contribution `value` in the group's current unit and create one ContributionEntry atomically.

---

## 5. Analytics migration

### Preserve current protections

Keep the current no-ID/no-free-text external analytics rule and release gate.

### Extend event schema

Contribution analytics must include, when permitted:

- `contributionUnit`
- value
- beneficiary count
- group size bucket
- planned/spontaneous indicator
- generalized time
- downstream taxonomy/classifier metadata

Expense analytics must include, when permitted:

- amount
- currency
- participant count
- split mode
- category only after safe normalization where relevant
- group size bucket
- generalized time

Settlement analytics must include:

- source/target ledger
- contribution unit
- contribution value
- money amount/currency
- group-defined rate snapshot in non-identifying form

### Downstream classifier

V2 taxonomy is deterministic keyword mapping. V3 may later add an AI classifier, but it must remain downstream, versioned and replaceable. Raw labels remain operational only and never appear in external research releases.

---

## 6. Tests to preserve vs replace

### Preserve/adapt

- zero-sum contribution tests
- repository persistence tests
- tenant isolation tests
- invitation tests
- analytics privacy/release-gate tests
- share/notification/calendar adapter contracts
- E2E harness and visual evidence workflow

### Replace

Tests whose assertions encode obsolete product policy:

- Free current-month archive limits
- Premium locks
- Standard/Pro pricing/member thresholds
- trial behavior
- Todo Premium requirement
- chrono persistence
- weighted Premium section

They are not to be simply deleted: replace them with V3 assertions covering free access, persistent balances, generic units, expenses and settlements.

---

## 7. V3-01 acceptance invariants

Before UI migration, the domain tranche is accepted only if tests prove:

1. contribution Minutes is zero-sum;
2. contribution Points is zero-sum;
3. performer-as-beneficiary self-share cancels correctly;
4. expense equal split is zero-sum in integer minor units;
5. expense custom split validates exact total allocation;
6. multiple currencies are never silently netted together;
7. modifying/deleting an entry produces balances equivalent to replaying the remaining ledger;
8. period filtering never mutates all-time balance;
9. changing group contribution unit does not reinterpret historical entries;
10. cross-ledger settlement snapshots its rate and remains stable after later rate changes;
11. cross-ledger settlement preserves each ledger's accounting integrity;
12. no contribution/expense/settlement calculation depends on UI-derived state.

---

## 8. First implementation tranche

Start V3-01 by porting only the architecture needed for the pure domain and its tests. Do not copy the entire V2 product wholesale into the new repository before obsolete freemium/chrono assumptions are separated.

The first code migration should therefore be:

- project TypeScript/Jest configuration required for domain tests;
- V3 domain entities;
- generalized contribution ledger calculations;
- expense ledger calculations;
- cross-ledger settlement calculations;
- property/invariant tests.

Then port application/infrastructure/UI slices vertically.
