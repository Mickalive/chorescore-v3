# Next cycle

Active criterion: **V3-02 — REPAIR: demo fixture regression + SQLite repository tests**.

Two remaining must-fix findings on the preserved WIP baseline:

1. **Demo fixture regression** (`src/features/app/AppContext.tsx`): `ensureDemoFixture` creates the demo household via `create()` (generated id) but all subsequent fixture records and `signIn`/`loadHouseholds` reference constant `DEMO_HOUSEHOLD_ID 'h-core'` → root Groups list empty after sign-in. Fix: seed/create under consistent canonical ids; consume `reposReady` or retry fixture after repo init. Verify: root Groups shows "Appartement" after demo sign-in; second sign-in doesn't duplicate demo user.

2. **No SQLite-backed repository tests** (`__tests__/infrastructure/repositories.test.ts`): `SqliteRepositories` (781 lines) and `RepositoryFactory` have zero test coverage. Fix: add tests covering CRUD round-trips and factory fallback selection. Verify: `npm test` green with new SQLite tests included.

Preserve: V3-01 domain untouched, all previously accepted V3-02 work (expo-sqlite ~57.0.3, bare '>' fix, tabLabel, assets/icon.png, openHousehold fix, RepositoryFactory wiring). Re-run `npm run check` and trusted verification.
