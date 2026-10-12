/**
 * ChoreScore V3 — Local Sync Adapter
 *
 * No-op sync. Real sync is V3-06 territory.
 * This adapter is honest about being unconfigured.
 */

import { SyncGateway, SyncStatus } from '../../application/ports';

export class LocalSyncAdapter implements SyncGateway {
  isAvailable(): boolean {
    return false;
  }

  async startSync(_householdId: string): Promise<void> {
    // No-op
  }

  async stopSync(_householdId: string): Promise<void> {
    // No-op
  }

  async pushChanges(_householdId: string): Promise<void> {
    // No-op
  }

  async pullChanges(_householdId: string): Promise<void> {
    // No-op
  }

  async getStatus(_householdId: string): Promise<SyncStatus> {
    return {
      isSyncing: false,
      lastSyncedAt: null,
      pendingChanges: 0,
      error: null,
    };
  }
}
