/**
 * ChoreScore V3 — period/view helpers for filtering historical entries.
 *
 * Periods are views only: they never modify the underlying perpetual
 * balances. The ledger is always the source of truth; period filters
 * simply narrow which entries participate in a calculation.
 *
 * All functions are pure and side-effect-free.
 */

// ── Period type ───────────────────────────────────────────────

export type Period = 'week' | 'month' | 'year' | 'all-time';

// ── Date boundary computation ─────────────────────────────────

/**
 * Compute the start-of-period boundary as an ISO timestamp string.
 * The boundary is inclusive: entries with occurredAt >= boundary are included.
 * Uses local midnight boundaries based on the provided reference date.
 */
export function periodBoundary(period: Period, referenceDate: Date = new Date()): string {
  const d = new Date(referenceDate);

  switch (period) {
    case 'week': {
      // Start of current week (Monday)
      const day = d.getDay();
      const diff = (day === 0 ? 6 : day - 1); // Monday = 0 offset
      d.setDate(d.getDate() - diff);
      d.setHours(0, 0, 0, 0);
      break;
    }
    case 'month': {
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      break;
    }
    case 'year': {
      d.setMonth(0, 1);
      d.setHours(0, 0, 0, 0);
      break;
    }
    case 'all-time': {
      // Return the beginning of time — no filtering needed
      return '0000-01-01T00:00:00.000Z';
    }
  }

  return d.toISOString();
}

/**
 * Check if an ISO timestamp falls within the given period relative
 * to a reference date (defaults to now).
 */
export function isInPeriod(isoTimestamp: string, period: Period, referenceDate: Date = new Date()): boolean {
  if (period === 'all-time') return true;
  const boundary = periodBoundary(period, referenceDate);
  return isoTimestamp >= boundary;
}

/**
 * Filter an array of entries by period, using the occurredAt field.
 * Returns a new array; the original is never mutated.
 *
 * This is a view operation: the perpetual balances remain unchanged.
 */
export function filterByPeriod<T extends { occurredAt: string }>(
  entries: T[],
  period: Period,
  referenceDate: Date = new Date()
): T[] {
  if (period === 'all-time') return [...entries];
  const boundary = periodBoundary(period, referenceDate);
  return entries.filter((e) => e.occurredAt >= boundary);
}

/**
 * Compute an all-time balance by replaying the full ledger.
 * The result is identical to what calculateContributionBalances /
 * calculateFinancialBalances produce with unfiltered entries.
 *
 * Period-filtered balances should be computed by first filtering,
 * then calculating — never by mutating the all-time balance.
 */
export function allTimeBalance<T extends { occurredAt: string }>(
  entries: T[],
  calculator: (filtered: T[]) => Map<string, number>
): Map<string, number> {
  return calculator(entries);
}
