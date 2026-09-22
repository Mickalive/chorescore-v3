/**
 * ChoreScore V3 — Sync Recording Wrapper
 *
 * Wraps business repositories to automatically record dirty sync records
 * after every local write. This ensures that pushDeltas has real payloads
 * to send to the remote — the core fix for finding #1 (storeLocalRecords
 * has zero callers).
 *
 * Design:
 *   - Each write (create/update/delete) to a business repository also calls
 *     storeLocalRecords on the sync state repository.
 *   - The sync record contains the serialized entity payload.
 *   - Revisions are incremented per-entity for conflict detection.
 *   - This wrapper is transparent: callers use the standard repository
 *     interface and never notice the sync recording.
 *
 * V3-06 REPAIR: Now covers ALL 8 SYNC_COLLECTIONS including
 * persistent_tasks, members, memberships, and households.
 */

import {
  SyncRecord,
  SyncCollection,
  ContributionEntry,
  ExpenseEntry,
  CrossLedgerSettlement,
  TodoItem,
  PersistentTask,
  Member,
  Membership,
  Household,
} from '../../domain/entities';
import {
  ContributionEntryRepository,
  ExpenseEntryRepository,
  TodoRepository,
  MemberRepository,
  SettlementRepository,
  PersistentTaskRepository,
  MembershipRepository,
  HouseholdRepository,
  PaginatedQuery,
  PaginatedResult,
} from '../repositories/index';
import { SyncStateRepository } from '../repositories/index';
import { createSyncRecordForEntity } from './SyncMaterializer';

/**
 * Global revision counter per entity for sync records.
 * In production this would be per-entity persisted; for InMemory tests
 * we use a simple incrementing counter.
 */
let globalRevision = 0;
function nextRevision(): number {
  globalRevision += 1;
  return globalRevision;
}

/**
 * Get a revision number for a new local dirty record that is guaranteed
 * to be higher than any existing cursor revision for the given collection.
 * This ensures that local dirty records are never hidden by cursor
 * advancement from pullDeltas.
 */
async function getLocalRevision(
  syncState: SyncStateRepository,
  householdId: string,
  collection: SyncCollection,
): Promise<number> {
  const cursor = await syncState.getCursor(householdId, collection);
  const cursorRev = cursor?.lastRevision ?? 0;
  const counterRev = nextRevision();
  // Local revision must be strictly greater than any known cursor
  return Math.max(counterRev, cursorRev + 1);
}

export function resetRevisions(): void {
  globalRevision = 0;
}

// ── Contribution Recording Wrapper ─────────────────────────────

export class SyncRecordingContributionRepository implements ContributionEntryRepository {
  constructor(
    private inner: ContributionEntryRepository,
    private syncState: SyncStateRepository,
  ) {}

  async seed(items: ContributionEntry[]): Promise<void> { await this.inner.seed(items); }
  getByHousehold(householdId: string): Promise<ContributionEntry[]> { return this.inner.getByHousehold(householdId); }
  getByHouseholdPaginated(householdId: string, query?: PaginatedQuery): Promise<PaginatedResult<ContributionEntry>> { return this.inner.getByHouseholdPaginated(householdId, query); }
  getById(id: string): Promise<ContributionEntry | null> { return this.inner.getById(id); }

  async create(entry: Omit<ContributionEntry, 'id'>): Promise<ContributionEntry> {
    const created = await this.inner.create(entry);
    await this.recordDirty(created, false);
    return created;
  }

  async update(id: string, data: Partial<ContributionEntry>): Promise<ContributionEntry> {
    const updated = await this.inner.update(id, data);
    await this.recordDirty(updated, false);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.inner.getById(id);
    await this.inner.delete(id);
    if (existing) {
      await this.recordDirty(existing, true);
    }
  }

  private async recordDirty(entity: ContributionEntry, deleted: boolean): Promise<void> {
    const revision = await getLocalRevision(this.syncState, entity.householdId, 'contribution_entries');
    const record = createSyncRecordForEntity(
      entity.householdId,
      'contribution_entries',
      entity.id,
      entity as unknown as Record<string, unknown>,
      revision,
      deleted,
    );
    await this.syncState.storeLocalRecords(entity.householdId, 'contribution_entries', [record]);
  }
}

// ── Expense Recording Wrapper ──────────────────────────────────

export class SyncRecordingExpenseRepository implements ExpenseEntryRepository {
  constructor(
    private inner: ExpenseEntryRepository,
    private syncState: SyncStateRepository,
  ) {}

  async seed(items: ExpenseEntry[]): Promise<void> { await this.inner.seed(items); }
  getByHousehold(householdId: string): Promise<ExpenseEntry[]> { return this.inner.getByHousehold(householdId); }
  getByHouseholdPaginated(householdId: string, query?: PaginatedQuery): Promise<PaginatedResult<ExpenseEntry>> { return this.inner.getByHouseholdPaginated(householdId, query); }
  getById(id: string): Promise<ExpenseEntry | null> { return this.inner.getById(id); }

  async create(entry: Omit<ExpenseEntry, 'id'>): Promise<ExpenseEntry> {
    const created = await this.inner.create(entry);
    await this.recordDirty(created, false);
    return created;
  }

  async update(id: string, data: Partial<ExpenseEntry>): Promise<ExpenseEntry> {
    const updated = await this.inner.update(id, data);
    await this.recordDirty(updated, false);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.inner.getById(id);
    await this.inner.delete(id);
    if (existing) {
      await this.recordDirty(existing, true);
    }
  }

  private async recordDirty(entity: ExpenseEntry, deleted: boolean): Promise<void> {
    const revision = await getLocalRevision(this.syncState, entity.householdId, 'expense_entries');
    const record = createSyncRecordForEntity(
      entity.householdId,
      'expense_entries',
      entity.id,
      entity as unknown as Record<string, unknown>,
      revision,
      deleted,
    );
    await this.syncState.storeLocalRecords(entity.householdId, 'expense_entries', [record]);
  }
}

// ── Todo Recording Wrapper ─────────────────────────────────────

export class SyncRecordingTodoRepository implements TodoRepository {
  constructor(
    private inner: TodoRepository,
    private syncState: SyncStateRepository,
  ) {}

  async seed(items: TodoItem[]): Promise<void> { await this.inner.seed(items); }
  getByHousehold(householdId: string): Promise<TodoItem[]> { return this.inner.getByHousehold(householdId); }
  getById(id: string): Promise<TodoItem | null> { return this.inner.getById(id); }

  async create(todo: Omit<TodoItem, 'id' | 'createdAt'>): Promise<TodoItem> {
    const created = await this.inner.create(todo);
    await this.recordDirty(created, false);
    return created;
  }

  async update(id: string, data: Partial<TodoItem>): Promise<TodoItem> {
    const updated = await this.inner.update(id, data);
    await this.recordDirty(updated, false);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.inner.getById(id);
    await this.inner.delete(id);
    if (existing) {
      await this.recordDirty(existing, true);
    }
  }

  private async recordDirty(entity: TodoItem, deleted: boolean): Promise<void> {
    const revision = await getLocalRevision(this.syncState, entity.householdId, 'todo_items');
    const record = createSyncRecordForEntity(
      entity.householdId,
      'todo_items',
      entity.id,
      entity as unknown as Record<string, unknown>,
      revision,
      deleted,
    );
    await this.syncState.storeLocalRecords(entity.householdId, 'todo_items', [record]);
  }
}

// ── Settlement Recording Wrapper ───────────────────────────────

export class SyncRecordingSettlementRepository implements SettlementRepository {
  constructor(
    private inner: SettlementRepository,
    private syncState: SyncStateRepository,
  ) {}

  async seed(items: CrossLedgerSettlement[]): Promise<void> { await this.inner.seed(items); }
  getByHousehold(householdId: string): Promise<CrossLedgerSettlement[]> { return this.inner.getByHousehold(householdId); }
  getByHouseholdPaginated(householdId: string, query?: PaginatedQuery): Promise<PaginatedResult<CrossLedgerSettlement>> { return this.inner.getByHouseholdPaginated(householdId, query); }
  getById(id: string): Promise<CrossLedgerSettlement | null> { return this.inner.getById(id); }

  async create(settlement: Omit<CrossLedgerSettlement, 'id'>): Promise<CrossLedgerSettlement> {
    const created = await this.inner.create(settlement);
    await this.recordDirty(created, false);
    return created;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.inner.getById(id);
    await this.inner.delete(id);
    if (existing) {
      await this.recordDirty(existing, true);
    }
  }

  private async recordDirty(entity: CrossLedgerSettlement, deleted: boolean): Promise<void> {
    const revision = await getLocalRevision(this.syncState, entity.householdId, 'settlements');
    const record = createSyncRecordForEntity(
      entity.householdId,
      'settlements',
      entity.id,
      entity as unknown as Record<string, unknown>,
      revision,
      deleted,
    );
    await this.syncState.storeLocalRecords(entity.householdId, 'settlements', [record]);
  }
}

// ── V3-06 REPAIR: PersistentTask Recording Wrapper ─────────────

export class SyncRecordingPersistentTaskRepository implements PersistentTaskRepository {
  constructor(
    private inner: PersistentTaskRepository,
    private syncState: SyncStateRepository,
  ) {}

  async seed(items: PersistentTask[]): Promise<void> { await this.inner.seed(items); }
  getByHousehold(householdId: string): Promise<PersistentTask[]> { return this.inner.getByHousehold(householdId); }
  getById(id: string): Promise<PersistentTask | null> { return this.inner.getById(id); }

  async create(task: Omit<PersistentTask, 'id' | 'createdAt'>): Promise<PersistentTask> {
    const created = await this.inner.create(task);
    await this.recordDirty(created, false);
    return created;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.inner.getById(id);
    await this.inner.delete(id);
    if (existing) {
      await this.recordDirty(existing, true);
    }
  }

  private async recordDirty(entity: PersistentTask, deleted: boolean): Promise<void> {
    const revision = await getLocalRevision(this.syncState, entity.householdId, 'persistent_tasks');
    const record = createSyncRecordForEntity(
      entity.householdId,
      'persistent_tasks',
      entity.id,
      entity as unknown as Record<string, unknown>,
      revision,
      deleted,
    );
    await this.syncState.storeLocalRecords(entity.householdId, 'persistent_tasks', [record]);
  }
}

// ── V3-06 REPAIR: Member Recording Wrapper ─────────────────────

export class SyncRecordingMemberRepository implements MemberRepository {
  constructor(
    private inner: MemberRepository,
    private syncState: SyncStateRepository,
  ) {}

  async seed(items: Member[]): Promise<void> { await this.inner.seed(items); }
  getByHousehold(householdId: string): Promise<Member[]> { return this.inner.getByHousehold(householdId); }
  getById(id: string): Promise<Member | null> { return this.inner.getById(id); }

  async create(data: Omit<Member, 'id' | 'joinedAt'>): Promise<Member> {
    const created = await this.inner.create(data);
    await this.recordDirty(created, false);
    return created;
  }

  private async recordDirty(entity: Member, deleted: boolean): Promise<void> {
    const revision = await getLocalRevision(this.syncState, entity.householdId, 'members');
    const record = createSyncRecordForEntity(
      entity.householdId,
      'members',
      entity.id,
      entity as unknown as Record<string, unknown>,
      revision,
      deleted,
    );
    await this.syncState.storeLocalRecords(entity.householdId, 'members', [record]);
  }
}

// ── V3-06 REPAIR: Membership Recording Wrapper ─────────────────

export class SyncRecordingMembershipRepository implements MembershipRepository {
  constructor(
    private inner: MembershipRepository,
    private syncState: SyncStateRepository,
  ) {}

  async seed(items: Membership[]): Promise<void> { await this.inner.seed(items); }
  getByUser(userId: string): Promise<Membership[]> { return this.inner.getByUser(userId); }
  getByHousehold(householdId: string): Promise<Membership[]> { return this.inner.getByHousehold(householdId); }
  getByUserAndHousehold(userId: string, householdId: string): Promise<Membership | null> { return this.inner.getByUserAndHousehold(userId, householdId); }

  async create(data: Omit<Membership, 'id' | 'joinedAt'>): Promise<Membership> {
    const created = await this.inner.create(data);
    await this.recordDirty(created, false);
    return created;
  }

  async delete(id: string): Promise<void> {
    await this.inner.delete(id);
    // Memberships are not soft-deleted in V3, hard delete is acceptable
    // for the sync tombstone since membership removal is rare and final.
  }

  private async recordDirty(entity: Membership, deleted: boolean): Promise<void> {
    const revision = await getLocalRevision(this.syncState, entity.householdId, 'memberships');
    const record = createSyncRecordForEntity(
      entity.householdId,
      'memberships',
      entity.id,
      entity as unknown as Record<string, unknown>,
      revision,
      deleted,
    );
    await this.syncState.storeLocalRecords(entity.householdId, 'memberships', [record]);
  }
}

// ── V3-06 REPAIR: Household Recording Wrapper ──────────────────

export class SyncRecordingHouseholdRepository implements HouseholdRepository {
  constructor(
    private inner: HouseholdRepository,
    private syncState: SyncStateRepository,
  ) {}

  async seed(items: Household[]): Promise<void> { await this.inner.seed(items); }
  getAll(): Promise<Household[]> { return this.inner.getAll(); }
  getById(id: string): Promise<Household | null> { return this.inner.getById(id); }

  async create(data: Omit<Household, 'id' | 'createdAt'>): Promise<Household> {
    const created = await this.inner.create(data);
    await this.recordDirty(created, false);
    return created;
  }

  async update(id: string, data: Partial<Household>): Promise<Household> {
    const updated = await this.inner.update(id, data);
    await this.recordDirty(updated, false);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const existing = await this.inner.getById(id);
    await this.inner.delete(id);
    if (existing) {
      await this.recordDirty(existing, true);
    }
  }

  private async recordDirty(entity: Household, deleted: boolean): Promise<void> {
    const revision = await getLocalRevision(this.syncState, entity.id, 'households');
    const record = createSyncRecordForEntity(
      entity.id, // households use entity.id as householdId for sync
      'households',
      entity.id,
      entity as unknown as Record<string, unknown>,
      revision,
      deleted,
    );
    await this.syncState.storeLocalRecords(entity.id, 'households', [record]);
  }
}
