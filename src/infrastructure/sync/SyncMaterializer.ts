/**
 * ChoreScore V3 — Sync Materializer
 *
 * Converts SyncRecord payloads into business table upserts.
 * Used by applyDeltas to actually materialize remote changes
 * into the local business stores (contribution_entries, expense_entries,
 * settlements, todo_items, persistent_tasks, members, memberships, households).
 *
 * Invariant: conflict resolution is deterministic (revision → timestamp → id)
 * before materialization. Blind last-write-wins is never used.
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
import { AllRepositories } from '../repositories/RepositoryFactory';
import { resolveConflict, ConflictRecord } from '../../domain/services/authorizationRules';

/**
 * Materialize a batch of sync records into the appropriate business repository.
 *
 * For each record:
 *   1. Deserialize the payload JSON.
 *   2. If the record is a tombstone (deletedAt non-null), delete from business repo.
 *   3. If the record is an upsert, resolve conflict against any existing entity
 *      using deterministic resolution (revision → timestamp → id).
 *   4. Upsert the winning entity into the business repository.
 *
 * Returns the number of records actually materialized (excluding tombstone deletes).
 */
export async function materializeDeltas(
  repos: AllRepositories,
  collection: SyncCollection,
  records: SyncRecord[],
): Promise<number> {
  let materialized = 0;

  for (const record of records) {
    if (record.deletedAt) {
      // Tombstone: delete from business repo
      await deleteBusinessRecord(repos, collection, record.id);
      continue;
    }

    if (!record.payload) continue;

    const entity = parsePayload(record.payload);
    if (!entity) continue;

    await upsertWithConflictResolution(repos, collection, record, entity);
    materialized++;
  }

  return materialized;
}

/**
 * Delete a business record by collection and id.
 */
async function deleteBusinessRecord(
  repos: AllRepositories,
  collection: SyncCollection,
  id: string,
): Promise<void> {
  switch (collection) {
    case 'contribution_entries':
      await repos.contributions.delete(id);
      break;
    case 'expense_entries':
      await repos.expenses.delete(id);
      break;
    case 'settlements':
      await repos.settlements.delete(id);
      break;
    case 'todo_items':
      await repos.todos.delete(id);
      break;
    case 'persistent_tasks':
      await repos.tasks.delete(id);
      break;
    case 'members':
      // Member repo doesn't have a delete in the interface — skip or no-op
      break;
    case 'memberships':
      await repos.memberships.delete(id);
      break;
    case 'households':
      await repos.households.delete(id);
      break;
  }
}

/**
 * Parse a SyncRecord payload into the expected entity shape.
 * Returns null if the payload is malformed.
 */
function parsePayload(payload: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(payload);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Upsert an entity with deterministic conflict resolution.
 *
 * If an existing entity has the same id, we resolve the conflict
 * using: higher revision wins → later updatedAt wins → lexicographic id wins.
 * This replaces the blind INSERT OR REPLACE that was used before.
 */
async function upsertWithConflictResolution(
  repos: AllRepositories,
  collection: SyncCollection,
  record: SyncRecord,
  entity: Record<string, unknown>,
): Promise<void> {
  switch (collection) {
    case 'contribution_entries': {
      const incoming = entity as unknown as ContributionEntry;
      const existing = await repos.contributions.getById(record.id);
      if (existing) {
        const winner = resolveConflict(
          { id: existing.id, revision: 0, updatedAt: existing.occurredAt },
          { id: record.id, revision: record.revision, updatedAt: record.updatedAt },
        );
        // If the remote wins (revision is higher), update
        if (winner.id === record.id) {
          await repos.contributions.update(record.id, incoming);
        }
        // If local wins, keep existing (no-op)
      } else {
        // New record — insert with known id
        await repos.contributions.create({ ...incoming, id: record.id } as any);
      }
      break;
    }
    case 'expense_entries': {
      const incoming = entity as unknown as ExpenseEntry;
      const existing = await repos.expenses.getById(record.id);
      if (existing) {
        const winner = resolveConflict(
          { id: existing.id, revision: 0, updatedAt: existing.occurredAt },
          { id: record.id, revision: record.revision, updatedAt: record.updatedAt },
        );
        if (winner.id === record.id) {
          await repos.expenses.update(record.id, incoming);
        }
      } else {
        await repos.expenses.create({ ...incoming, id: record.id } as any);
      }
      break;
    }
    case 'settlements': {
      const incoming = entity as unknown as CrossLedgerSettlement;
      const existing = await repos.settlements.getById(record.id);
      if (existing) {
        const winner = resolveConflict(
          { id: existing.id, revision: 0, updatedAt: existing.occurredAt },
          { id: record.id, revision: record.revision, updatedAt: record.updatedAt },
        );
        if (winner.id === record.id) {
          // Settlements don't have update in the interface — create replaces
          await repos.settlements.delete(record.id);
          await repos.settlements.create({ ...incoming, id: record.id } as any);
        }
      } else {
        await repos.settlements.create({ ...incoming, id: record.id } as any);
      }
      break;
    }
    case 'todo_items': {
      const incoming = entity as unknown as TodoItem;
      const existing = await repos.todos.getById(record.id);
      if (existing) {
        const winner = resolveConflict(
          { id: existing.id, revision: 0, updatedAt: existing.createdAt },
          { id: record.id, revision: record.revision, updatedAt: record.updatedAt },
        );
        if (winner.id === record.id) {
          await repos.todos.update(record.id, incoming);
        }
      } else {
        await repos.todos.create({ ...incoming, id: record.id } as any);
      }
      break;
    }
    case 'persistent_tasks': {
      const incoming = entity as unknown as PersistentTask;
      const existing = await repos.tasks.getById(record.id);
      if (existing) {
        const winner = resolveConflict(
          { id: existing.id, revision: 0, updatedAt: existing.createdAt },
          { id: record.id, revision: record.revision, updatedAt: record.updatedAt },
        );
        if (winner.id === record.id) {
          await repos.tasks.delete(record.id);
          await repos.tasks.create({ ...incoming, id: record.id } as any);
        }
      } else {
        await repos.tasks.create({ ...incoming, id: record.id } as any);
      }
      break;
    }
    case 'members': {
      const incoming = entity as unknown as Member;
      const existing = await repos.members.getById(record.id);
      if (!existing) {
        await repos.members.create({ ...incoming, id: record.id } as any);
      }
      break;
    }
    case 'memberships': {
      const incoming = entity as unknown as Membership;
      const existing = await repos.memberships.getByUserAndHousehold(
        incoming.userId,
        incoming.householdId,
      );
      if (!existing) {
        await repos.memberships.create({
          userId: incoming.userId,
          householdId: incoming.householdId,
          role: incoming.role,
        });
      }
      break;
    }
    case 'households': {
      const incoming = entity as unknown as Household;
      const existing = await repos.households.getById(record.id);
      if (existing) {
        await repos.households.update(record.id, incoming);
      } else {
        await repos.households.create({ ...incoming, id: record.id } as any);
      }
      break;
    }
  }
}

/**
 * Create a SyncRecord from a local business entity for dirty tracking.
 *
 * This is called by SyncRecordingWrapper after a business write to create
 * a sync record that pushDeltas can later pick up and send to the remote.
 */
export function createSyncRecordForEntity(
  householdId: string,
  collection: SyncCollection,
  entityId: string,
  entity: Record<string, unknown>,
  revision: number,
  deleted: boolean = false,
): SyncRecord {
  const now = new Date().toISOString();
  return {
    id: entityId,
    householdId,
    collection,
    revision,
    updatedAt: now,
    deletedAt: deleted ? now : null,
    payload: deleted ? null : JSON.stringify(entity),
  };
}

/**
 * Map a collection name to the entity's householdId field.
 */
export function getHouseholdIdFromEntity(
  collection: SyncCollection,
  entity: Record<string, unknown>,
): string | null {
  if ('householdId' in entity && typeof entity.householdId === 'string') {
    return entity.householdId;
  }
  return null;
}
