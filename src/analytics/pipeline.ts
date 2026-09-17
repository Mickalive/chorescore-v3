/**
 * ChoreScore V3 — PrivacyTransformPipeline
 *
 * Transforms operational facts into analytics-safe records.
 * Extended from V2 to handle contribution, expense, settlement and usage events.
 *
 * Pipeline stages:
 * 1. Strip all operational IDs (userId, householdId, memberId, etc.)
 * 2. Replace free text with taxonomy references (via cache)
 * 3. Generalize timestamps to coarse time dimensions
 * 4. Generalize demographics (if present, never inferred)
 * 5. Suppress rare cells / small cohorts
 * 6. Emit only anonymous records to the analytics store
 *
 * CRITICAL: This pipeline MUST reject any record that still contains
 * operational IDs or free text after transformation.
 *
 * V3 extensions:
 * - Handles contribution events (minutes + points)
 * - Handles expense events (amounts bucketed, no free text)
 * - Handles settlement events (cross-ledger)
 * - Handles usage events (feature adoption)
 * - Uses classification cache to avoid redundant work
 * - Supports incremental checkpoints (no full-history reprocessing)
 */

import {
  AnonymousAnalyticsEvent,
  AnonymousContributionEvent,
  AnonymousExpenseEvent,
  AnonymousSettlementEvent,
  AnonymousUsageEvent,
  AnonymousTaskFact,
  GeneralizedTimestamp,
  TaxonomyCategoryId,
  TaxonomyVersion,
  OperationalFact,
  TransformResult,
  PipelineCheckpoint,
} from './types';
import { TaskTaxonomyService, bucketValue, bucketGroupSize } from './taxonomy';
import { ClassificationCache } from './classificationCache';

/**
 * Pipeline configuration.
 */
export interface PipelineConfig {
  /** Minimum cohort size for inclusion */
  minCohortSize: number;
  /** Whether to suppress rare cells */
  suppressRareCells: boolean;
  /** Pipeline version for provenance */
  version: string;
  /** Classifier version for cache keying */
  classifierVersion: string;
  /** Amount buckets for expenses */
  amountBuckets: number[];
  /** Contribution value buckets */
  contributionValueBuckets: number[];
}

const DEFAULT_CONFIG: PipelineConfig = {
  minCohortSize: 5,
  suppressRareCells: true,
  version: '3.0.0',
  classifierVersion: '1.0.0',
  amountBuckets: [1000, 5000, 10000, 25000, 50000, 100000], // minor units
  contributionValueBuckets: [15, 30, 60, 120, 240, 480], // minutes or points
};

/**
 * PrivacyTransformPipeline — transforms operational facts into
 * anonymous analytics records.
 *
 * The pipeline is stateless and deterministic (aside from classification cache).
 * Same input → same output.
 */
export class PrivacyTransformPipeline {
  private readonly taxonomyService: TaskTaxonomyService;
  private readonly classificationCache: ClassificationCache;
  private readonly config: PipelineConfig;

  constructor(config?: Partial<PipelineConfig>, taxonomy?: TaxonomyVersion) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.taxonomyService = new TaskTaxonomyService(taxonomy);
    this.classificationCache = new ClassificationCache(this.taxonomyService);
  }

  getConfig(): PipelineConfig {
    return { ...this.config };
  }

  getTaxonomyVersion(): string {
    return this.taxonomyService.getVersion();
  }

  getClassificationCache(): ClassificationCache {
    return this.classificationCache;
  }

  /**
   * Generalize an ISO timestamp to coarse time dimensions.
   */
  generalizeTimestamp(isoTimestamp: string): GeneralizedTimestamp {
    const date = new Date(isoTimestamp);

    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const week1 = new Date(d.getFullYear(), 0, 4);
    const weekNumber =
      1 +
      Math.round(
        ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7
      );
    const isoWeekStart = new Date(date);
    isoWeekStart.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    const isoWeek = isoWeekStart.toISOString().split('T')[0];

    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay();
    const hour = date.getHours();
    const hourBucket = Math.floor(hour / 4) * 4;

    return { isoWeek, month, dayOfWeek, hourBucket };
  }

  /**
   * Validate that a data record contains no operational IDs.
   *
   * NOTE: 'label', 'title', 'notes' are intentionally ALLOWED as input.
   * They are consumed by the transform functions for taxonomy classification
   * and are never emitted in output events. The PrivacyReleaseGate and
   * output event types guarantee no free text reaches external data products.
   *
   * Only operational IDs (join keys toward the operational store) are
   * forbidden on input because they could leak through to output.
   */
  private validateNoOperationalIds(data: Record<string, unknown>): string | null {
    const forbiddenFields = [
      'userId', 'accountId', 'memberId', 'householdId',
      'membershipId', 'entryId', 'todoId', 'persistentTaskId',
      'email', 'phone', 'oauthSubject',
      'ipAddress', 'deviceId', 'advertisingId',
      'name', 'displayName', 'householdName', 'memberName',
      'latitude', 'longitude', 'address', 'zipCode',
      'createdBy', 'modifiedBy', 'performedByMemberId',
      'beneficiaryMemberIds',
    ];

    for (const field of forbiddenFields) {
      if (field in data) {
        return `Operational ID field '${field}' detected in input data`;
      }
    }

    return null;
  }

  /**
   * Validate that an input data record contains no unconsumed free text.
   *
   * NOTE: 'label' is intentionally ALLOWED — it is consumed by transform
   * functions for taxonomy classification and never emitted in output.
   * 'title' and 'notes' are NOT consumed by any transform and are rejected.
   * The output event types + PrivacyReleaseGate provide the final guarantee.
   */
  private validateNoFreeText(data: Record<string, unknown>): string | null {
    const textFields = ['title', 'notes', 'name', 'displayName'];
    for (const field of textFields) {
      if (typeof data[field] === 'string' && (data[field] as string).length > 0) {
        return `Free text field '${field}' detected in input data`;
      }
    }
    return null;
  }

  /**
   * Transform an operational fact into an anonymous analytics event.
   */
  transform(fact: OperationalFact): TransformResult {
    // Stage 1: Validate input contains no operational IDs
    const idCheck = this.validateNoOperationalIds(fact.data);
    if (idCheck) {
      return { success: false, rejectionReason: idCheck };
    }

    // Stage 2: Validate no free text
    const textCheck = this.validateNoFreeText(fact.data);
    if (textCheck) {
      return { success: false, rejectionReason: textCheck };
    }

    // Stage 3: Transform based on fact type
    switch (fact.type) {
      case 'entry_created':
        return this.transformEntryCreated(fact);
      case 'contribution_created':
        return this.transformContributionCreated(fact);
      case 'expense_created':
        return this.transformExpenseCreated(fact);
      case 'settlement_completed':
        return this.transformSettlementCompleted(fact);
      case 'usage_event':
        return this.transformUsageEvent(fact);
      default:
        return {
          success: false,
          rejectionReason: `Unknown fact type '${fact.type}'`,
        };
    }
  }

  /**
   * Transform entry_created (V2 compatible).
   */
  private transformEntryCreated(fact: OperationalFact): TransformResult {
    const data = fact.data;

    const durationMinutes = typeof data.durationMinutes === 'number' ? data.durationMinutes : null;
    const beneficiaryCount = typeof data.beneficiaryCount === 'number' ? data.beneficiaryCount : null;
    const hasPersistentTask = typeof data.hasPersistentTask === 'boolean' ? data.hasPersistentTask : false;
    const weight = typeof data.weight === 'number' ? data.weight : 1.0;
    const label = typeof data.label === 'string' ? data.label : null;

    if (durationMinutes === null || beneficiaryCount === null) {
      return {
        success: false,
        rejectionReason: 'Missing required fields: durationMinutes, beneficiaryCount',
      };
    }

    if (label === null) {
      return {
        success: false,
        rejectionReason: 'Missing label — label must be provided for classification',
      };
    }

    // Classify label via cache (avoids redundant work)
    const { result: classification } = this.classificationCache.classify(
      label,
      this.config.classifierVersion
    );

    const timestamp = this.generalizeTimestamp(fact.timestamp);

    const fact2: AnonymousTaskFact = {
      taxonomyCategoryId: classification.taxonomyCategoryId,
      taxonomyVersion: classification.taxonomyVersion,
      durationMinutes,
      beneficiaryCount,
      hasPersistentTask,
      weight,
      timestamp,
    };

    return { success: true, fact: fact2 };
  }

  /**
   * Transform contribution_created (V3).
   */
  private transformContributionCreated(fact: OperationalFact): TransformResult {
    const data = fact.data;

    const unit = data.unit as 'minutes' | 'points' | undefined;
    const value = typeof data.value === 'number' ? data.value : null;
    const beneficiaryCount = typeof data.beneficiaryCount === 'number' ? data.beneficiaryCount : null;
    const hasPersistentTask = typeof data.hasPersistentTask === 'boolean' ? data.hasPersistentTask : false;
    const label = typeof data.label === 'string' ? data.label : null;
    const wasPlanned = typeof data.wasPlanned === 'boolean' ? data.wasPlanned : false;

    if (!unit || (unit !== 'minutes' && unit !== 'points')) {
      return { success: false, rejectionReason: 'Invalid or missing unit' };
    }
    if (value === null || beneficiaryCount === null) {
      return { success: false, rejectionReason: 'Missing required fields: value, beneficiaryCount' };
    }
    if (label === null) {
      return { success: false, rejectionReason: 'Missing label for classification' };
    }

    const { result: classification } = this.classificationCache.classify(
      label,
      this.config.classifierVersion
    );

    const timestamp = this.generalizeTimestamp(fact.timestamp);

    const event: AnonymousContributionEvent = {
      type: 'contribution',
      unit,
      value,
      beneficiaryCount,
      hasPersistentTask,
      taxonomyCategoryId: classification.taxonomyCategoryId,
      taxonomyVersion: classification.taxonomyVersion,
      wasPlanned,
      timestamp,
    };

    return { success: true, fact: event };
  }

  /**
   * Transform expense_created (V3).
   * Buckets amounts to prevent reconstruction.
   */
  private transformExpenseCreated(fact: OperationalFact): TransformResult {
    const data = fact.data;

    const amountMinor = typeof data.amountMinor === 'number' ? data.amountMinor : null;
    const currency = typeof data.currency === 'string' ? data.currency : null;
    const participantCount = typeof data.participantCount === 'number' ? data.participantCount : null;
    const splitMode = data.splitMode as 'equal' | 'custom' | undefined;
    const hasCategory = typeof data.hasCategory === 'boolean' ? data.hasCategory : false;

    if (amountMinor === null || currency === null || participantCount === null) {
      return { success: false, rejectionReason: 'Missing required fields: amountMinor, currency, participantCount' };
    }

    const timestamp = this.generalizeTimestamp(fact.timestamp);

    const event: AnonymousExpenseEvent = {
      type: 'expense',
      amountBucket: bucketValue(amountMinor, this.config.amountBuckets),
      currency,
      participantCount,
      splitMode: splitMode ?? 'equal',
      hasCategory,
      timestamp,
    };

    return { success: true, fact: event };
  }

  /**
   * Transform settlement_completed (V3).
   */
  private transformSettlementCompleted(fact: OperationalFact): TransformResult {
    const data = fact.data;

    const contributionUnit = data.contributionUnit as 'minutes' | 'points' | undefined;
    const contributionValue = typeof data.contributionValue === 'number' ? data.contributionValue : null;
    const moneyAmountMinor = typeof data.moneyAmountMinor === 'number' ? data.moneyAmountMinor : null;
    const currency = typeof data.currency === 'string' ? data.currency : null;
    const rateContributionValue = typeof data.rateContributionValue === 'number' ? data.rateContributionValue : null;
    const rateMoneyAmount = typeof data.rateMoneyAmount === 'number' ? data.rateMoneyAmount : null;

    if (!contributionUnit || contributionValue === null || moneyAmountMinor === null || currency === null) {
      return { success: false, rejectionReason: 'Missing required settlement fields' };
    }

    const timestamp = this.generalizeTimestamp(fact.timestamp);

    const event: AnonymousSettlementEvent = {
      type: 'settlement',
      contributionUnit,
      contributionValueBucket: bucketValue(contributionValue, this.config.contributionValueBuckets),
      moneyAmountBucket: bucketValue(moneyAmountMinor, this.config.amountBuckets),
      currency,
      rateContributionValue: rateContributionValue ?? contributionValue,
      rateMoneyAmount: rateMoneyAmount ?? moneyAmountMinor,
      timestamp,
    };

    return { success: true, fact: event };
  }

  /**
   * Transform usage_event (V3).
   */
  private transformUsageEvent(fact: OperationalFact): TransformResult {
    const data = fact.data;

    const feature = typeof data.feature === 'string' ? data.feature : null;
    const groupSize = typeof data.groupSize === 'number' ? data.groupSize : null;

    const validFeatures = new Set([
      'group-created', 'invitation-sent', 'invitation-accepted',
      'contribution-added', 'expense-added', 'settlement-completed',
      'todo-completed', 'compensation-activated', 'unit-changed',
    ]);

    if (!feature || !validFeatures.has(feature)) {
      return { success: false, rejectionReason: `Invalid or missing feature: ${feature}` };
    }
    if (groupSize === null) {
      return { success: false, rejectionReason: 'Missing groupSize' };
    }

    const timestamp = this.generalizeTimestamp(fact.timestamp);

    const event: AnonymousUsageEvent = {
      type: 'usage',
      feature: feature as AnonymousUsageEvent['feature'],
      groupSizeBucket: bucketGroupSize(groupSize),
      timestamp,
    };

    return { success: true, fact: event };
  }

  /**
   * Transform a batch of facts.
   * Returns only successfully transformed facts.
   */
  transformBatch(facts: OperationalFact[]): {
    accepted: AnonymousAnalyticsEvent[];
    rejected: Array<{ fact: OperationalFact; reason: string }>;
  } {
    const accepted: AnonymousAnalyticsEvent[] = [];
    const rejected: Array<{ fact: OperationalFact; reason: string }> = [];

    for (const fact of facts) {
      const result = this.transform(fact);
      if (result.success && result.fact) {
        accepted.push(result.fact);
      } else {
        rejected.push({ fact, reason: result.rejectionReason || 'Unknown error' });
      }
    }

    return { accepted, rejected };
  }

  /**
   * Check if a batch of facts would be suppressed due to rare cells.
   */
  checkRareCells(facts: AnonymousAnalyticsEvent[]): {
    included: AnonymousAnalyticsEvent[];
    suppressed: AnonymousAnalyticsEvent[];
  } {
    if (!this.config.suppressRareCells) {
      return { included: facts, suppressed: [] };
    }

    // Group by taxonomy category and month
    const groups = new Map<string, AnonymousAnalyticsEvent[]>();
    for (const fact of facts) {
      const cat = this.getFactCategory(fact);
      const month = this.getFactMonth(fact);
      const key = `${cat}:${month}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(fact);
    }

    const included: AnonymousAnalyticsEvent[] = [];
    const suppressed: AnonymousAnalyticsEvent[] = [];

    for (const [, group] of groups) {
      if (group.length >= this.config.minCohortSize) {
        included.push(...group);
      } else {
        suppressed.push(...group);
      }
    }

    return { included, suppressed };
  }

  /**
   * Create an incremental checkpoint from processing results.
   */
  createCheckpoint(
    householdId: string,
    lastProcessedRevision: number,
    factsEmitted: number,
    factsRejected: number,
    classificationCacheHits: number,
    classificationCacheMisses: number
  ): PipelineCheckpoint {
    return {
      id: `checkpoint-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      householdId,
      lastProcessedRevision,
      lastProcessedAt: new Date().toISOString(),
      factsEmitted,
      factsRejected,
      classificationCacheHits,
      classificationCacheMisses,
    };
  }

  private getFactCategory(fact: AnonymousAnalyticsEvent): string {
    // AnonymousTaskFact (V2-compatible) has no 'type' field but has taxonomyCategoryId
    if ('taxonomyCategoryId' in fact) {
      return (fact as AnonymousTaskFact | AnonymousContributionEvent).taxonomyCategoryId ?? 'other';
    }
    return fact.type;
  }

  private getFactMonth(fact: AnonymousAnalyticsEvent): string {
    return fact.timestamp.month;
  }
}

export function createDefaultPipeline(): PrivacyTransformPipeline {
  return new PrivacyTransformPipeline();
}
