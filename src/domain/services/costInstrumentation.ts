/**
 * ChoreScore V3 — Cost Instrumentation
 *
 * Tracks reads/writes/network calls per action to enforce the
 * backend frugal cost gates (V3_BACKEND_FRUGAL.md §11-12).
 *
 * In development/test, every significant data operation is wrapped
 * with a cost tracker.  The tracker records:
 *   - reads: number of repository reads
 *   - writes: number of repository writes
 *   - networkCalls: number of remote fetches
 *   - bytesSynced: estimated bytes transferred
 *   - classifications: number of AI/classifier invocations
 *
 * The cost tracker does NOT block the UI — it only observes and
 * records.  Tests use the tracker to assert bounded costs.
 */

export interface CostRecord {
  action: string;
  reads: number;
  writes: number;
  networkCalls: number;
  bytesSynced: number;
  classifications: number;
  timestamp: string;
}

/**
 * Budget limits for common actions.
 * A regression that exceeds these limits is a release finding.
 */
export const COST_BUDGETS: Record<string, Partial<CostRecord>> = {
  // Opening a group with 50k historical entries
  'open-household': { reads: 5, networkCalls: 0 },
  // Tab switching: Ajouter → Balances → À faire → Ajouter
  'tab-switch': { reads: 0, networkCalls: 0 },
  // Creating a contribution
  'create-contribution': { writes: 1, networkCalls: 0 },
  // Completing a todo (atomic: todo update + contribution create)
  'complete-todo': { writes: 2, networkCalls: 0 },
  // Syncing after a few changes
  'sync-delta': { reads: 8, writes: 8, networkCalls: 2 }, // 8 collections × pull + push
  // Creating an invitation
  'create-invitation': { writes: 1, networkCalls: 0 },
  // Accepting an invitation
  'accept-invitation': { writes: 2, networkCalls: 0 }, // membership + member
};

class CostTracker {
  private records: CostRecord[] = [];

  start(action: string): CostHandle {
    const record: CostRecord = {
      action,
      reads: 0,
      writes: 0,
      networkCalls: 0,
      bytesSynced: 0,
      classifications: 0,
      timestamp: new Date().toISOString(),
    };

    const tracker = this;
    return {
      recordRead() { record.reads++; },
      recordWrite() { record.writes++; },
      recordNetwork(bytes?: number) {
        record.networkCalls++;
        if (bytes) record.bytesSynced += bytes;
      },
      recordClassification() { record.classifications++; },
      finish() {
        tracker.records.push(record);
      },
      getRecord() { return { ...record }; },
    };
  }

  getRecords(): CostRecord[] {
    return [...this.records];
  }

  getLastRecord(): CostRecord | null {
    return this.records.length > 0 ? this.records[this.records.length - 1] : null;
  }

  reset(): void {
    this.records = [];
  }

  /**
   * Assert that the last action's cost is within the defined budget.
   * Throws if the budget is exceeded.
   */
  assertBudget(action: string): void {
    const record = this.records.find((r) => r.action === action);
    if (!record) return; // No record = no assertion

    const budget = COST_BUDGETS[action];
    if (!budget) return; // No budget defined

    if (budget.reads !== undefined && record.reads > budget.reads) {
      throw new Error(
        `[CostGate] ${action}: ${record.reads} reads exceeds budget of ${budget.reads}`,
      );
    }
    if (budget.writes !== undefined && record.writes > budget.writes) {
      throw new Error(
        `[CostGate] ${action}: ${record.writes} writes exceeds budget of ${budget.writes}`,
      );
    }
    if (budget.networkCalls !== undefined && record.networkCalls > budget.networkCalls) {
      throw new Error(
        `[CostGate] ${action}: ${record.networkCalls} network calls exceeds budget of ${budget.networkCalls}`,
      );
    }
  }
}

export interface CostHandle {
  recordRead(): void;
  recordWrite(): void;
  recordNetwork(bytes?: number): void;
  recordClassification(): void;
  finish(): void;
  getRecord(): CostRecord;
}

// Singleton tracker for the application
export const costTracker = new CostTracker();
