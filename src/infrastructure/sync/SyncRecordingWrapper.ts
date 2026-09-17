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
 */

import {
  SyncRecord,
  SyncCollection,
  ContributionEntry,
  ExpenseEntry,
  TodoItem,
  Member,
} from '../../domain/entities';
import {
  ContributionEntryRepository,
  ExpenseEntryRepository,
  TodoRepository,
  MemberRepository,
  SettlementRepository,
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

export function resetRevisions(): void {
  globalRevision = 0;
}

/**
 * Wraps a ContributionEntryRepository to record dirty sync records after writes.
 */
export class SyncRecordingContributionRepository implements ContributionEntryRepository {
  constructor(
    private inner: ContributionEntryRepository,
    private syncState: SyncStateRepository,
  ) {}

  seed(items: ContributionEntry[]): void { this.inner.seed(items); }
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
    // Find the entity before deletion so we can create a tombstone
    const existing = await this.inner.getById(id);
    await this.inner.delete(id);
    if (existing) {
      await this.recordDirty(existing, true);
    }
  }

  private async recordDirty(entity: ContributionEntry, deleted: boolean): Promise<void> {
    const record = createSyncRecordForEntity(
      entity.householdId,
      'contribution_entries',
      entity.id,
      entity as unknown as Record<string, unknown>,
      nextRevision(),
      deleted,
    );
    await this.syncState.storeLocalRecords(entity.householdId, 'contribution_entries', [record]);
  }
}

/**
 * Wraps an ExpenseEntryRepository to record dirty sync records after writes.
 */
export class SyncRecordingExpenseRepository implements ExpenseEntryRepository {
  constructor(
    private inner: ExpenseEntryRepository,
    private syncState: SyncStateRepository,
  ) {}

  seed(items: ExpenseEntry[]): void { this.inner.seed(items); }
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
    const record = createSyncRecordForEntity(
      entity.householdId,
      'expense_entries',
      entity.id,
      entity as unknown as Record<string, unknown>,
      nextRevision(),
      deleted,
    );
    await this.syncState.storeLocalRecords(entity.householdId, 'expense_entries', [record]);
  }
}

/**
 * Wraps a TodoRepository to record dirty sync records after writes.
 */
export class SyncRecordingTodoRepository implements TodoRepository {
  constructor(
    private inner: TodoRepository,
    private syncState: SyncStateRepository,
  ) {}

  seed(items: TodoItem[]): void { this.inner.seed(items); }
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
    const record = createSyncRecordForEntity(
      entity.householdId,
      'todo_items',
      entity.id,
      entity as unknown as Record<string, unknown>,
      nextRevision(),
      deleted,
    );
    await this.syncState.storeLocalRecords(entity.householdId, 'todo_items', [record]);
  }
}

/**
 * Wraps a SettlementRepository to record dirty sync records after writes.
 */
export class SyncRecordingSettlementRepository implements SettlementRepository {
  constructor(
    private inner: SettlementRepository,
    private syncState: SyncStateRepository,
  ) {}

  seed(items: any[]): void { this.inner.seed(items); }
  getByHousehold(householdId: string): Promise<any[]> { return this.inner.getByHousehold(householdId); }
  getByHouseholdPaginated(householdId: string, query?: PaginatedQuery): Promise<PaginatedResult<any>> { return this.inner.getByHouseholdPaginated(householdId, query); }
  getById(id: string): Promise<any | null> { return this.inner.getById(id); }

  async create(settlement: Omit<any, 'id'>): Promise<any> {
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

  private async recordDirty(entity: any, deleted: boolean): Promise<void> {
    const record = createSyncRecordForEntity(
      entity.householdId,
      'settlements',
      entity.id,
      entity as unknown as Record<string, unknown>,
      nextRevision(),
      deleted,
    );
    await this.syncState.storeLocalRecords(entity.householdId, 'settlements', [record]);
  }
}
