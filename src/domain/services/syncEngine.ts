/**
 * ChoreScore V3 — Sync Engine
 *
 * Delta-only sync with per-group revision cursors.
 *
 * Design principles (from V3_BACKEND_FRUGAL.md §2-3):
 *   - Each client stores a cursor per household per collection.
 *   - Sync fetches only records with revision > local cursor.
 *   - A single lightweight change signal replaces per-collection listeners.
 *   - Push sends local dirty records since last push revision.
 *   - No full-collection downloads, no N+1 reads.
 *
 * This is a pure domain service.  It operates on SyncStateRepository
 * and never imports Firebase, Firestore, or any provider-specific code.
 */

import { SyncCollection, SyncCursor, SyncRecord, SyncChangeSignal } from '../entities';
import { SyncStateRepository } from '../../infrastructure/repositories';

/** All collections that participate in delta sync. */
export const SYNC_COLLECTIONS: SyncCollection[] = [
  'contribution_entries',
  'expense_entries',
  'settlements',
  'todo_items',
  'persistent_tasks',
  'members',
  'memberships',
  'households',
];

export interface PullResult {
  /** Total records applied across all collections. */
  totalApplied: number;
  /** Per-collection applied counts. */
  perCollection: Record<SyncCollection, number>;
  /** Change signal to emit to the UI. */
  signal: SyncChangeSignal | null;
}

export interface PushResult {
  /** Total records pushed across all collections. */
  totalPushed: number;
  /** Per-collection pushed counts. */
  perCollection: Record<SyncCollection, number>;
}

/**
 * Pull deltas for a single household.
 *
 * For each collection: read the local cursor, request remote changes
 * since that cursor, apply them locally, advance the cursor.
 *
 * The `fetchRemoteDeltas` callback abstracts the network/provider layer.
 * It receives the collection and the last known revision and must return
 * records with revision > lastKnownRevision.
 */
export async function pullDeltas(
  syncState: SyncStateRepository,
  householdId: string,
  fetchRemoteDeltas: (collection: SyncCollection, sinceRevision: number) => Promise<SyncRecord[]>,
): Promise<PullResult> {
  const perCollection: Record<string, number> = {};
  const changedCollections: SyncCollection[] = [];
  let totalApplied = 0;

  for (const collection of SYNC_COLLECTIONS) {
    const cursor = await syncState.getCursor(householdId, collection);
    const sinceRevision = cursor?.lastRevision ?? 0;

    const remoteRecords = await fetchRemoteDeltas(collection, sinceRevision);

    if (remoteRecords.length > 0) {
      await syncState.applyDeltas(householdId, collection, remoteRecords);
      totalApplied += remoteRecords.length;
      perCollection[collection] = remoteRecords.length;
      changedCollections.push(collection);
    } else {
      perCollection[collection] = 0;
    }
  }

  const signal: SyncChangeSignal | null = changedCollections.length > 0
    ? { householdId, collections: changedCollections, receivedAt: new Date().toISOString() }
    : null;

  return {
    totalApplied,
    perCollection: perCollection as Record<SyncCollection, number>,
    signal,
  };
}

/**
 * Push local changes for a single household.
 *
 * For each collection: get dirty records since last push revision,
 * send them to the remote, and advance the local cursor.
 *
 * The `pushRemoteRecords` callback abstracts the network/provider layer.
 * It receives the collection and the records to push, and should return
 * the server-assigned revisions (or throw on failure).
 */
export async function pushDeltas(
  syncState: SyncStateRepository,
  householdId: string,
  pushRemoteRecords: (collection: SyncCollection, records: SyncRecord[]) => Promise<SyncRecord[]>,
): Promise<PushResult> {
  const perCollection: Record<string, number> = {};
  let totalPushed = 0;

  for (const collection of SYNC_COLLECTIONS) {
    const cursor = await syncState.getCursor(householdId, collection);
    const sinceRevision = cursor?.lastRevision ?? 0;

    const dirtyRecords = await syncState.getDirtyRecords(householdId, collection, sinceRevision);

    if (dirtyRecords.length > 0) {
      const pushedRecords = await pushRemoteRecords(collection, dirtyRecords);

      if (pushedRecords.length > 0) {
        const maxRev = pushedRecords.reduce((max, r) => Math.max(max, r.revision), 0);
        await syncState.setCursor({
          householdId,
          collection,
          lastRevision: Math.max(maxRev, cursor?.lastRevision ?? 0),
          lastSyncedAt: new Date().toISOString(),
        });
        totalPushed += pushedRecords.length;
        perCollection[collection] = pushedRecords.length;
      }
    } else {
      perCollection[collection] = 0;
    }
  }

  return {
    totalPushed,
    perCollection: perCollection as Record<SyncCollection, number>,
  };
}

/**
 * Full bidirectional sync for a household: pull then push.
 */
export async function syncHousehold(
  syncState: SyncStateRepository,
  householdId: string,
  fetchRemoteDeltas: (collection: SyncCollection, sinceRevision: number) => Promise<SyncRecord[]>,
  pushRemoteRecords: (collection: SyncCollection, records: SyncRecord[]) => Promise<SyncRecord[]>,
): Promise<{ pull: PullResult; push: PushResult }> {
  const pull = await pullDeltas(syncState, householdId, fetchRemoteDeltas);
  const push = await pushDeltas(syncState, householdId, pushRemoteRecords);
  return { pull, push };
}
