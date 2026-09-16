/**
 * ChoreScore V3 — Unified activity log.
 *
 * Merges contribution entries, expense entries and cross-ledger settlements
 * into a single chronologically sorted stream with cursor-based pagination.
 *
 * The activity log is a read-only VIEW over the ledger. It never mutates
 * the underlying data. History is the source of truth; this service
 * merely presents it in a unified, compact form.
 *
 * Cursor-based pagination avoids full-history reads and keeps the cost
 * of opening the Add tab constant regardless of total history size.
 */

import {
  ActivityEntry,
  ContributionEntry,
  CrossLedgerSettlement,
  ExpenseEntry,
} from '../entities';

// ── Types ──────────────────────────────────────────────────────

export type ActivityFilter = 'all' | 'contribution' | 'expense' | 'settlement';

export interface ActivityLogPage {
  /** Entries sorted by occurredAt DESC (newest first). */
  entries: ActivityEntry[];
  /** Cursor: the occurredAt of the last entry in this page. */
  cursor: string | null;
  /** Whether more pages exist beyond this one. */
  hasMore: boolean;
}

export interface ActivityLogPaginationOptions {
  /** Maximum entries per page. Default: 20. */
  limit?: number;
  /** Cursor to fetch the next page (exclusive). Pass null for the first page. */
  cursor?: string | null;
  /** Filter by entry type. Default: 'all'. */
  filter?: ActivityFilter;
  /** Only include entries at or after this ISO timestamp (inclusive). */
  after?: string;
}

// ── Core merge + paginate ──────────────────────────────────────

/**
 * Merge contributions, expenses and settlements into a single
 * ActivityEntry[], sort by occurredAt DESC and return a cursor-paginated
 * slice.
 *
 * This function is pure — it does not touch repositories or side effects.
 * The caller is responsible for fetching the raw entries from the local store.
 */
export function paginateActivityLog(
  contributions: ContributionEntry[],
  expenses: ExpenseEntry[],
  settlements: CrossLedgerSettlement[],
  options: ActivityLogPaginationOptions = {}
): ActivityLogPage {
  const limit = options.limit ?? 20;
  const filter = options.filter ?? 'all';
  const cursor = options.cursor ?? null;
  const after = options.after ?? null;

  // Build the merged, filtered list
  const merged: ActivityEntry[] = [];

  if (filter === 'all' || filter === 'contribution') {
    for (const entry of contributions) {
      merged.push({ type: 'contribution', entry });
    }
  }

  if (filter === 'all' || filter === 'expense') {
    for (const entry of expenses) {
      merged.push({ type: 'expense', entry });
    }
  }

  if (filter === 'all' || filter === 'settlement') {
    for (const entry of settlements) {
      merged.push({ type: 'cross-ledger-settlement', entry });
    }
  }

  // Sort by occurredAt DESC (newest first)
  merged.sort((a, b) => {
    const aTime = a.entry.occurredAt;
    const bTime = b.entry.occurredAt;
    // DESC: newer first; tie-break by type for stability
    if (aTime !== bTime) return bTime.localeCompare(aTime);
    return a.type.localeCompare(b.type);
  });

  // Apply after filter (inclusive)
  let filtered = merged;
  if (after) {
    filtered = merged.filter((e) => e.entry.occurredAt >= after);
  }

  // Apply cursor (exclusive — skip entries with occurredAt >= cursor)
  let start = 0;
  if (cursor) {
    start = filtered.findIndex((e) => e.entry.occurredAt < cursor);
    if (start === -1) {
      // No entries older than the cursor
      return { entries: [], cursor: null, hasMore: false };
    }
  }

  const page = filtered.slice(start, start + limit);
  const nextCursor = page.length === limit
    ? page[page.length - 1].entry.occurredAt
    : null;
  const hasMore = page.length === limit && start + limit < filtered.length;

  return {
    entries: page,
    cursor: nextCursor,
    hasMore,
  };
}

// ── Convenience: count by filter ───────────────────────────────

/**
 * Count the total number of activity entries matching a filter.
 * Used for display purposes; avoids loading all entries.
 */
export function countActivityEntries(
  contributions: ContributionEntry[],
  expenses: ExpenseEntry[],
  settlements: CrossLedgerSettlement[],
  filter: ActivityFilter = 'all'
): number {
  let count = 0;
  if (filter === 'all' || filter === 'contribution') count += contributions.length;
  if (filter === 'all' || filter === 'expense') count += expenses.length;
  if (filter === 'all' || filter === 'settlement') count += settlements.length;
  return count;
}
