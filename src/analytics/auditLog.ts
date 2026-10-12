/**
 * ChoreScore V3 — Audit/Export Log
 *
 * Tracks all data product releases for compliance and governance.
 * Preserved from V2.
 */

import {
  AuditExportLogEntry,
  AuditExportLog,
  DataProductProvenance,
} from './types';

/**
 * In-memory implementation of AuditExportLog.
 * In production, this would be backed by an append-only audit store.
 */
export class InMemoryAuditExportLog implements AuditExportLog {
  private entries: AuditExportLogEntry[] = [];
  private counter = 0;

  logEntry(entry: Omit<AuditExportLogEntry, 'logId'>): AuditExportLogEntry {
    this.counter++;
    const logEntry: AuditExportLogEntry = {
      ...entry,
      logId: `audit-${Date.now()}-${this.counter}`,
    };
    this.entries.push(logEntry);
    return logEntry;
  }

  getEntries(): AuditExportLogEntry[] {
    return [...this.entries];
  }

  getProductEntries(productId: string): AuditExportLogEntry[] {
    return this.entries.filter(e => e.productId === productId);
  }

  getBuyerEntries(buyerContractId: string): AuditExportLogEntry[] {
    return this.entries.filter(e => e.buyerContractId === buyerContractId);
  }

  getReleaseCount(): number {
    return this.entries.length;
  }

  hasReleases(): boolean {
    return this.entries.length > 0;
  }
}

export function createDefaultAuditLog(): InMemoryAuditExportLog {
  return new InMemoryAuditExportLog();
}
