/**
 * ChoreScore V3 — Query Budget / Rate Limit Service
 *
 * Prevents abuse and reconstruction attacks via flexible analytics queries.
 * Preserved from V2.
 */

import { QueryBudgetConfig } from './types';

const DEFAULT_QUERY_BUDGET: QueryBudgetConfig = {
  rateLimitPerMinute: 10,
  rateLimitPerDay: 500,
  maxDimensionsPerQuery: 3,
  maxTimeRangeMonths: 24,
  minCohortSize: 5,
  differentialPrivacyEnabled: false,
};

export interface QueryBudgetCheckResult {
  allowed: boolean;
  reason?: string;
  remainingQueriesToday: number;
  remainingQueriesThisMinute: number;
}

export class QueryBudgetService {
  private config: QueryBudgetConfig;
  private queryTimestamps: number[] = [];
  private dailyQueryCount = 0;
  private lastDayReset: string;

  constructor(config?: Partial<QueryBudgetConfig>) {
    this.config = { ...DEFAULT_QUERY_BUDGET, ...config };
    this.lastDayReset = new Date().toISOString().split('T')[0];
  }

  getConfig(): QueryBudgetConfig {
    return { ...this.config };
  }

  checkBudget(dimensions: number, timeRangeMonths: number): QueryBudgetCheckResult {
    this.resetDailyIfNeeded();
    this.pruneOldTimestamps();

    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;

    const queriesThisMinute = this.queryTimestamps.filter(t => t > oneMinuteAgo).length;

    if (queriesThisMinute >= this.config.rateLimitPerMinute) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${queriesThisMinute}/${this.config.rateLimitPerMinute} queries per minute`,
        remainingQueriesToday: this.config.rateLimitPerDay - this.dailyQueryCount,
        remainingQueriesThisMinute: 0,
      };
    }

    if (this.dailyQueryCount >= this.config.rateLimitPerDay) {
      return {
        allowed: false,
        reason: `Daily limit exceeded: ${this.dailyQueryCount}/${this.config.rateLimitPerDay} queries today`,
        remainingQueriesToday: 0,
        remainingQueriesThisMinute: this.config.rateLimitPerMinute - queriesThisMinute,
      };
    }

    if (dimensions > this.config.maxDimensionsPerQuery) {
      return {
        allowed: false,
        reason: `Too many dimensions: ${dimensions}/${this.config.maxDimensionsPerQuery} max`,
        remainingQueriesToday: this.config.rateLimitPerDay - this.dailyQueryCount,
        remainingQueriesThisMinute: this.config.rateLimitPerMinute - queriesThisMinute,
      };
    }

    if (timeRangeMonths > this.config.maxTimeRangeMonths) {
      return {
        allowed: false,
        reason: `Time range too large: ${timeRangeMonths}/${this.config.maxTimeRangeMonths} months max`,
        remainingQueriesToday: this.config.rateLimitPerDay - this.dailyQueryCount,
        remainingQueriesThisMinute: this.config.rateLimitPerMinute - queriesThisMinute,
      };
    }

    this.queryTimestamps.push(now);
    this.dailyQueryCount++;

    return {
      allowed: true,
      remainingQueriesToday: this.config.rateLimitPerDay - this.dailyQueryCount,
      remainingQueriesThisMinute: this.config.rateLimitPerMinute - queriesThisMinute - 1,
    };
  }

  recordQuery(): void {
    this.queryTimestamps.push(Date.now());
    this.dailyQueryCount++;
  }

  getRemainingBudget(): { queriesToday: number; queriesThisMinute: number } {
    this.resetDailyIfNeeded();
    this.pruneOldTimestamps();

    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    const queriesThisMinute = this.queryTimestamps.filter(t => t > oneMinuteAgo).length;

    return {
      queriesToday: this.config.rateLimitPerDay - this.dailyQueryCount,
      queriesThisMinute: this.config.rateLimitPerMinute - queriesThisMinute,
    };
  }

  private resetDailyIfNeeded(): void {
    const today = new Date().toISOString().split('T')[0];
    if (today !== this.lastDayReset) {
      this.dailyQueryCount = 0;
      this.lastDayReset = today;
    }
  }

  private pruneOldTimestamps(): void {
    const oneMinuteAgo = Date.now() - 60 * 1000;
    this.queryTimestamps = this.queryTimestamps.filter(t => t > oneMinuteAgo);
  }
}

export function createDefaultQueryBudget(): QueryBudgetService {
  return new QueryBudgetService();
}
