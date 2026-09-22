/**
 * ChoreScore V3 — SyncRecording seed regression tests
 *
 * V3-08 REPAIR: The SyncRecording*Repository.seed() methods previously
 * returned `void` and discarded the inner async Promise:
 *
 *   seed(items: T[]): void { this.inner.seed(items); }
 *
 * Callers such as ensureDemoFixture do `await repos.households.seed(...)`
 * etc. With a fire-and-forget seed, the await resolved immediately while
 * the SQLite INSERTs were still in flight. The fixture then performed
 * membership-checked reads (tasks.getByHousehold → checkMembership →
 * memberships.getByHousehold); if the memberships INSERT had not yet
 * committed, the read returned [] and requireHouseholdMembership threw
 * CROSS_TENANT, rejecting the whole demo sign-in (observed on device:
 * signed in but "Aucun groupe" forever).
 *
 * These tests use an inner repository whose seed() is genuinely async
 * (deferred), so the old void-returning wrapper would fail them:
 *   - old code: wrapper.seed() returns undefined → not a Promise;
 *   - broken async-but-not-awaited code: the wrapper promise resolves
 *     before the inner seed completes.
 * The in-memory repositories cannot catch this bug because their seed
 * is synchronous.
 */

import {
  SyncRecordingContributionRepository,
  SyncRecordingExpenseRepository,
  SyncRecordingTodoRepository,
  SyncRecordingSettlementRepository,
  SyncRecordingPersistentTaskRepository,
  SyncRecordingMemberRepository,
  SyncRecordingMembershipRepository,
  SyncRecordingHouseholdRepository,
} from '../../src/infrastructure/sync/SyncRecordingWrapper';
import {
  ContributionEntryRepository,
  ExpenseEntryRepository,
  TodoRepository,
  SettlementRepository,
  PersistentTaskRepository,
  MemberRepository,
  MembershipRepository,
  HouseholdRepository,
  SyncStateRepository,
} from '../../src/infrastructure/repositories/index';

/**
 * Build a fake inner repository whose seed() is genuinely asynchronous:
 * it records the call, then completes only after a deferred promise
 * resolves. This mirrors the SQLite repositories (async INSERTs) and
 * exposes any wrapper that fails to await the inner seed.
 */
function makeAsyncSeedRepo<T>() {
  let resolveSeed!: () => void;
  const seedGate = new Promise<void>((resolve) => { resolveSeed = resolve; });
  const calls: T[][] = [];
  let completed = false;
  const repo = {
    seed: async (items: T[]): Promise<void> => {
      calls.push(items);
      await seedGate;
      completed = true;
    },
    seedCalls: calls,
    seedCompleted: (): boolean => completed,
    releaseSeed: (): void => resolveSeed(),
  };
  return repo;
}

const syncStateStub = {} as unknown as SyncStateRepository;

/**
 * Shared assertion: the wrapper's seed() must return a real promise that
 * stays pending until the inner async seed completes.
 */
async function assertSeedAwaitsInner(
  wrapperSeed: (items: never[]) => unknown,
  inner: ReturnType<typeof makeAsyncSeedRepo<never>>,
): Promise<void> {
  const result = wrapperSeed([]);
  // Old fire-and-forget code returned undefined — not a promise.
  expect(result).toBeInstanceOf(Promise);
  let resolved = false;
  (result as Promise<void>).then(() => { resolved = true; });
  // Yield to the microtask/macrotask queues: a wrapper that does not await
  // the inner seed would already have resolved here.
  await new Promise((r) => setTimeout(r, 0));
  expect(resolved).toBe(false);
  expect(inner.seedCompleted()).toBe(false);
  inner.releaseSeed();
  await (result as Promise<void>);
  expect(resolved).toBe(true);
  expect(inner.seedCompleted()).toBe(true);
}

describe('SyncRecording wrappers await the inner seed (V3-08 repair)', () => {
  test('contribution wrapper: await seed() waits for the async inner seed', async () => {
    const inner = makeAsyncSeedRepo<Parameters<ContributionEntryRepository['seed']>[0]>();
    const wrapper = new SyncRecordingContributionRepository(
      inner as unknown as ContributionEntryRepository,
      syncStateStub,
    );
    await assertSeedAwaitsInner((items) => wrapper.seed(items as never), inner as never);
  });

  test('expense wrapper: await seed() waits for the async inner seed', async () => {
    const inner = makeAsyncSeedRepo<Parameters<ExpenseEntryRepository['seed']>[0]>();
    const wrapper = new SyncRecordingExpenseRepository(
      inner as unknown as ExpenseEntryRepository,
      syncStateStub,
    );
    await assertSeedAwaitsInner((items) => wrapper.seed(items as never), inner as never);
  });

  test('todo wrapper: await seed() waits for the async inner seed', async () => {
    const inner = makeAsyncSeedRepo<Parameters<TodoRepository['seed']>[0]>();
    const wrapper = new SyncRecordingTodoRepository(
      inner as unknown as TodoRepository,
      syncStateStub,
    );
    await assertSeedAwaitsInner((items) => wrapper.seed(items as never), inner as never);
  });

  test('settlement wrapper: await seed() waits for the async inner seed', async () => {
    const inner = makeAsyncSeedRepo<Parameters<SettlementRepository['seed']>[0]>();
    const wrapper = new SyncRecordingSettlementRepository(
      inner as unknown as SettlementRepository,
      syncStateStub,
    );
    await assertSeedAwaitsInner((items) => wrapper.seed(items as never), inner as never);
  });

  test('persistent task wrapper: await seed() waits for the async inner seed', async () => {
    const inner = makeAsyncSeedRepo<Parameters<PersistentTaskRepository['seed']>[0]>();
    const wrapper = new SyncRecordingPersistentTaskRepository(
      inner as unknown as PersistentTaskRepository,
      syncStateStub,
    );
    await assertSeedAwaitsInner((items) => wrapper.seed(items as never), inner as never);
  });

  test('member wrapper: await seed() waits for the async inner seed', async () => {
    const inner = makeAsyncSeedRepo<Parameters<MemberRepository['seed']>[0]>();
    const wrapper = new SyncRecordingMemberRepository(
      inner as unknown as MemberRepository,
      syncStateStub,
    );
    await assertSeedAwaitsInner((items) => wrapper.seed(items as never), inner as never);
  });

  test('membership wrapper: await seed() waits for the async inner seed', async () => {
    const inner = makeAsyncSeedRepo<Parameters<MembershipRepository['seed']>[0]>();
    const wrapper = new SyncRecordingMembershipRepository(
      inner as unknown as MembershipRepository,
      syncStateStub,
    );
    await assertSeedAwaitsInner((items) => wrapper.seed(items as never), inner as never);
  });

  test('household wrapper: await seed() waits for the async inner seed', async () => {
    const inner = makeAsyncSeedRepo<Parameters<HouseholdRepository['seed']>[0]>();
    const wrapper = new SyncRecordingHouseholdRepository(
      inner as unknown as HouseholdRepository,
      syncStateStub,
    );
    await assertSeedAwaitsInner((items) => wrapper.seed(items as never), inner as never);
  });

  test('demo fixture ordering: awaited seed forwards the exact payload', async () => {
    // End-to-end guard for the exact on-device failure: after awaiting
    // seed() on the wrapped membership repo, the inner repo must have
    // received the full membership payload (no fire-and-forget loss).
    const inner = makeAsyncSeedRepo<Parameters<MembershipRepository['seed']>[0]>();
    const wrapper = new SyncRecordingMembershipRepository(
      inner as unknown as MembershipRepository,
      syncStateStub,
    );
    const membership = {
      id: 'membership-demo-alex',
      userId: 'demo-user-alex',
      householdId: 'h-core',
      role: 'OWNER',
      joinedAt: '2026-09-22T00:00:00.000Z',
    };
    const pending = wrapper.seed([membership] as never);
    inner.releaseSeed();
    await pending;
    expect(inner.seedCalls[0]).toEqual([membership]);
    expect(inner.seedCompleted()).toBe(true);
  });
});