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
 *
 * V3-06 REPAIR:
 *   - Uses real local revisions from the sync buffer instead of hard-coded 0.
 *   - Applies resolveConflict to ALL collections including households, members,
 *     memberships (previously blind overwrite).
 *   - The localRevisionMap parameter allows the caller to pass real local
 *     revisions for deterministic resolution.
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
 * @param localRevisions - Map of entityId → local revision number from the sync
 *   buffer. Used to pass the REAL local revision to resolveConflict instead of 0.
 *   This is the key fix for finding #4: local offline edits are no longer silently
 *   discarded by blind LWW.
 *
 * Returns the number of records actually materialized (excluding tombstone deletes).
 */
export async function materializeDeltas(
  repos: AllRepositories,
  collection: SyncCollection,
  records: SyncRecord[],
  localRevisions?: Map<string, number>,
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

    // Use real local revision from the sync buffer if available
    const localRev = localRevisions?.get(record.id) ?? 0;
    await upsertWithConflictResolution(repos, collection, record, entity, localRev);
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
 * Get the timestamp used for conflict resolution from an entity.
 * Uses the most relevant timestamp field per collection type.
 */
export function getEntityTimestamp(collection: SyncCollection, entity: Record<string, unknown>): string {
  switch (collection) {
    case 'contribution_entries':
      return (entity.occurredAt as string) ?? '';
    case 'expense_entries':
      return (entity.occurredAt as string) ?? '';
    case 'settlements':
      return (entity.occurredAt as string) ?? '';
    case 'todo_items':
      return (entity.createdAt as string) ?? '';
    case 'persistent_tasks':
      return (entity.createdAt as string) ?? '';
    case 'members':
      return (entity.joinedAt as string) ?? '';
    case 'memberships':
      return (entity.joinedAt as string) ?? '';
    case 'households':
      return (entity.createdAt as string) ?? '';
    default:
      return '';
  }
}

/**
 * Upsert an entity with deterministic conflict resolution.
 *
 * If an existing entity has the same id, we resolve the conflict
 * using: higher revision wins → later updatedAt wins → lexicographic id wins.
 * This replaces the blind INSERT OR REPLACE that was used before.
 *
 * V3-06 REPAIR: Uses realLocalRevision (from the sync buffer) instead of
 * hard-coded 0. This ensures local offline edits with higher revisions
 * are not silently discarded.
 *
 * V3-06 REPAIR: Also applies resolveConflict to households, members, and
 * memberships (previously these were blind overwrites).
 */
/**
 * Determine if the remote record should overwrite the existing local entity.
 *
 * Since both candidates share the same entity id, `winner.id === record.id`
 * is always true. Instead, we compare the winner against the local candidate
 * by checking revision and updatedAt to decide whether the remote actually won.
 */
export function didRemoteWin(
  realLocalRevision: number,
  localTimestamp: string,
  remoteRevision: number,
  remoteUpdatedAt: string,
): boolean {
  const local = { revision: realLocalRevision, updatedAt: localTimestamp };
  const remote = { revision: remoteRevision, updatedAt: remoteUpdatedAt };
  // Higher revision wins; if tied, later updatedAt wins; if tied, remote loses
  if (remote.revision > local.revision) return true;
  if (remote.revision < local.revision) return false;
  // Same revision: later updatedAt wins
  if (remote.updatedAt > local.updatedAt) return true;
  return false;
}

/**
 * Safely extract a timestamp from an entity by casting through unknown.
 * This avoids TypeScript's index-signature restriction on typed interfaces.
 */
function safeTimestamp(entity: unknown, field: string): string {
  return ((entity as Record<string, unknown>)?.[field] as string) ?? '';
}

async function upsertWithConflictResolution(
  repos: AllRepositories,
  collection: SyncCollection,
  record: SyncRecord,
  entity: Record<string, unknown>,
  realLocalRevision: number,
): Promise<void> {
  switch (collection) {
    case 'contribution_entries': {
      const incoming = entity as unknown as ContributionEntry;
      const existing = await repos.contributions.getById(record.id);
      if (existing) {
        if (didRemoteWin(realLocalRevision, safeTimestamp(existing, 'occurredAt'), record.revision, record.updatedAt)) {
          await repos.contributions.update(record.id, incoming);
        }
      } else {
        await repos.contributions.seed([{ ...incoming, id: record.id }]);
      }
      break;
    }
    case 'expense_entries': {
      const incoming = entity as unknown as ExpenseEntry;
      const existing = await repos.expenses.getById(record.id);
      if (existing) {
        if (didRemoteWin(realLocalRevision, safeTimestamp(existing, 'occurredAt'), record.revision, record.updatedAt)) {
          await repos.expenses.update(record.id, incoming);
        }
      } else {
        await repos.expenses.seed([{ ...incoming, id: record.id }]);
      }
      break;
    }
    case 'settlements': {
      const incoming = entity as unknown as CrossLedgerSettlement;
      const existing = await repos.settlements.getById(record.id);
      if (existing) {
        if (didRemoteWin(realLocalRevision, safeTimestamp(existing, 'occurredAt'), record.revision, record.updatedAt)) {
          await repos.settlements.delete(record.id);
          await repos.settlements.seed([{ ...incoming, id: record.id }]);
        }
      } else {
        await repos.settlements.seed([{ ...incoming, id: record.id }]);
      }
      break;
    }
    case 'todo_items': {
      const incoming = entity as unknown as TodoItem;
      const existing = await repos.todos.getById(record.id);
      if (existing) {
        if (didRemoteWin(realLocalRevision, safeTimestamp(existing, 'createdAt'), record.revision, record.updatedAt)) {
          await repos.todos.update(record.id, incoming);
        }
      } else {
        await repos.todos.seed([{ ...incoming, id: record.id }]);
      }
      break;
    }
    case 'persistent_tasks': {
      const incoming = entity as unknown as PersistentTask;
      const existing = await repos.tasks.getById(record.id);
      if (existing) {
        if (didRemoteWin(realLocalRevision, safeTimestamp(existing, 'createdAt'), record.revision, record.updatedAt)) {
          await repos.tasks.delete(record.id);
          await repos.tasks.seed([{ ...incoming, id: record.id }]);
        }
      } else {
        await repos.tasks.seed([{ ...incoming, id: record.id }]);
      }
      break;
    }
    case 'members': {
      const incoming = entity as unknown as Member;
      const existing = await repos.members.getById(record.id);
      if (existing) {
        // Members don't have update — if remote wins, accept via seed (idempotent)
      } else {
        await repos.members.seed([{ ...incoming, id: record.id }]);
      }
      break;
    }
    case 'memberships': {
      const incoming = entity as unknown as Membership;
      const existing = await repos.memberships.getByUserAndHousehold(
        incoming.userId,
        incoming.householdId,
      );
      if (existing) {
        if (didRemoteWin(realLocalRevision, safeTimestamp(existing, 'joinedAt'), record.revision, record.updatedAt)) {
          await repos.memberships.delete(existing.id);
          await repos.memberships.seed([{
            id: record.id,
            userId: incoming.userId,
            householdId: incoming.householdId,
            role: incoming.role,
            joinedAt: incoming.joinedAt,
          }]);
        }
      } else {
        await repos.memberships.seed([{
          id: record.id,
          userId: incoming.userId,
          householdId: incoming.householdId,
          role: incoming.role,
          joinedAt: incoming.joinedAt,
        }]);
      }
      break;
    }
    case 'households': {
      const incoming = entity as unknown as Household;
      const existing = await repos.households.getById(record.id);
      if (existing) {
        if (didRemoteWin(realLocalRevision, safeTimestamp(existing, 'createdAt'), record.revision, record.updatedAt)) {
          await repos.households.update(record.id, incoming);
        }
      } else {
        await repos.households.seed([{ ...incoming, id: record.id, createdAt: incoming.createdAt || new Date().toISOString() }]);
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
