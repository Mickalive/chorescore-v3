/**
 * ChoreScore V3 — Research Analytics Store Types
 *
 * Extended from V2 with contribution, expense, settlement and usage event types.
 * Contains ZERO operational IDs, ZERO free text, ZERO join keys.
 *
 * CRITICAL INVARIANT: No type in this file may reference:
 * - userId, accountId, memberId, householdId (operational IDs)
 * - email, phone, OAuth subject
 * - IP, device ID, advertising ID
 * - member names or household names
 * - free text (labels, notes, titles)
 * - precise GPS/address
 * - exact timestamps when coarser granularity suffices
 * - any join key toward the operational store
 *
 * The Research Analytics Store is derived via PrivacyTransformPipeline
 * and gated by PrivacyReleaseGate before any external release.
 */

// ── Taxonomy (versioned, deterministic) ────────────────────────

export type TaxonomyCategoryId =
  | 'kitchen'
  | 'dishes'
  | 'cleaning'
  | 'laundry'
  | 'groceries'
  | 'administrative'
  | 'childcare'
  | 'maintenance'
  | 'waste'
  | 'other';

export interface TaxonomyVersion {
  version: string;
  mappings: Record<string, TaxonomyCategoryId>;
  fallback: TaxonomyCategoryId;
}

// ── Generalized Time ───────────────────────────────────────────

export interface GeneralizedTimestamp {
  isoWeek: string;
  month: string;
  dayOfWeek: number;
  hourBucket: number;
}

// ── Demographics (optional, structured, never inferred) ────────

export interface DemographicSnapshot {
  ageRange?: '18-24' | '25-34' | '35-44' | '45-54' | '55-64' | '65+';
  householdSizeBucket?: '2' | '3-4' | '5-6' | '7+';
  hasChildren?: boolean;
  regionBucket?: string;
}

// ── V2 Legacy: Anonymous Task Fact ─────────────────────────────

export interface AnonymousTaskFact {
  taxonomyCategoryId: TaxonomyCategoryId;
  taxonomyVersion: string;
  durationMinutes: number;
  beneficiaryCount: number;
  hasPersistentTask: boolean;
  weight: number;
  timestamp: GeneralizedTimestamp;
  demographics?: DemographicSnapshot;
}

// ── V3 Extended Event Types ────────────────────────────────────

/**
 * V3 contribution event — covers minutes and points.
 * Duration is always present; unit is captured for analytics only.
 */
export interface AnonymousContributionEvent {
  type: 'contribution';
  unit: 'minutes' | 'points';
  value: number;
  beneficiaryCount: number;
  hasPersistentTask: boolean;
  taxonomyCategoryId: TaxonomyCategoryId;
  taxonomyVersion: string;
  wasPlanned: boolean;
  timestamp: GeneralizedTimestamp;
  demographics?: DemographicSnapshot;
}

/**
 * V3 expense event — covers all financial transactions.
 */
export interface AnonymousExpenseEvent {
  type: 'expense';
  amountBucket: string;
  currency: string;
  participantCount: number;
  splitMode: 'equal' | 'custom';
  hasCategory: boolean;
  timestamp: GeneralizedTimestamp;
  demographics?: DemographicSnapshot;
}

/**
 * V3 settlement event — cross-ledger compensation.
 */
export interface AnonymousSettlementEvent {
  type: 'settlement';
  contributionUnit: 'minutes' | 'points';
  contributionValueBucket: string;
  moneyAmountBucket: string;
  currency: string;
  rateContributionValue: number;
  rateMoneyAmount: number;
  timestamp: GeneralizedTimestamp;
  demographics?: DemographicSnapshot;
}

/**
 * V3 usage event — product adoption and feature usage.
 */
export interface AnonymousUsageEvent {
  type: 'usage';
  feature:
    | 'group-created'
    | 'invitation-sent'
    | 'invitation-accepted'
    | 'contribution-added'
    | 'expense-added'
    | 'settlement-completed'
    | 'todo-completed'
    | 'compensation-activated'
    | 'unit-changed';
  groupSizeBucket: '2' | '3-4' | '5-6' | '7+';
  timestamp: GeneralizedTimestamp;
  demographics?: DemographicSnapshot;
}

/**
 * Union of all V3 anonymous analytics events.
 */
export type AnonymousAnalyticsEvent =
  | AnonymousTaskFact
  | AnonymousContributionEvent
  | AnonymousExpenseEvent
  | AnonymousSettlementEvent
  | AnonymousUsageEvent;

// ── Anonymous Household Aggregate ──────────────────────────────

export interface AnonymousHouseholdAggregate {
  householdSizeBucket: '2' | '3-4' | '5-6' | '7+';
  month: string;
  totalTasks: number;
  avgDurationMinutes: number;
  medianDurationMinutes: number;
  totalMinutes: number;
  categoryDistribution: Record<TaxonomyCategoryId, number>;
  balanceEqualityIndex: number;
}

// ── Anonymous Cohort Aggregate ─────────────────────────────────

export interface AnonymousCohortAggregate {
  cohortId: string;
  description: string;
  cohortSize: number;
  aggregates: {
    avgTasksPerWeek: number;
    avgMinutesPerWeek: number;
    avgBalanceEquality: number;
    categoryBreakdown: Record<TaxonomyCategoryId, number>;
  };
  demographics?: DemographicSnapshot;
}

// ── Research Data Product ──────────────────────────────────────

export interface ResearchDataProduct {
  productId: string;
  version: string;
  taxonomyVersion: string;
  type: 'aggregate' | 'cohort' | 'synthetic' | 'api-query';
  householdCount: number;
  timeRange: { fromMonth: string; toMonth: string };
  data: AnonymousAnalyticsEvent[] | AnonymousHouseholdAggregate[] | AnonymousCohortAggregate[];
  provenance: DataProductProvenance;
}

export interface DataProductProvenance {
  pipelineVersion: string;
  producedAt: string;
  taxonomyVersion: string;
  transformations: string[];
  gateVersion: string;
  differentialPrivacyApplied: boolean;
}

// ── Query Budget / Rate Limit ──────────────────────────────────

export interface QueryBudgetConfig {
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
  maxDimensionsPerQuery: number;
  maxTimeRangeMonths: number;
  minCohortSize: number;
  differentialPrivacyEnabled: boolean;
}

// ── Differential Privacy ───────────────────────────────────────

export interface DifferentialPrivacyConfig {
  enabled: boolean;
  epsilon: number;
  delta: number;
  mechanism: 'laplace' | 'gaussian';
  maxQueries: number;
  remainingBudget: number;
}

// ── Consent / Purpose / Jurisdiction ───────────────────────────

export type DataProcessingPurpose =
  | 'product-improvement'
  | 'research-statistics'
  | 'anonymized-data-product'
  | 'synthetic-data-generation'
  | 'academic-collaboration';

export type Jurisdiction =
  | 'EU-GDPR'
  | 'US-CCPA'
  | 'US-other'
  | 'UK-GDPR'
  | 'CH-DSG'
  | 'other';

export interface ConsentRecord {
  userId: string;
  purpose: DataProcessingPurpose;
  granted: boolean;
  timestamp: string;
  jurisdiction: Jurisdiction;
  noticeVersion: string;
  withdrawable: boolean;
}

export interface ConsentPolicy {
  policyId: string;
  jurisdiction: Jurisdiction;
  purposeConsentRequired: Record<DataProcessingPurpose, boolean>;
  explicitOptInRequired: boolean;
  retroactiveWithdrawalSupported: boolean;
  retentionDays: number;
  deletionOnWithdrawal: boolean;
}

// ── Buyer Contracts ────────────────────────────────────────────

export interface BuyerContract {
  contractId: string;
  buyerName: string;
  buyerType: 'university' | 'research-institute' | 'government' | 'ngo' | 'other';
  productIds: string[];
  permittedPurposes: DataProcessingPurpose[];
  buyerJurisdiction: Jurisdiction;
  reIdentificationProhibited: boolean;
  redistributionProhibited: boolean;
  commercialUseProhibited: boolean;
  startDate: string;
  endDate: string | null;
  auditRightsGranted: boolean;
  reIdentificationReportingRequired: boolean;
}

// ── Audit / Export Log ─────────────────────────────────────────

export interface AuditExportLogEntry {
  logId: string;
  productId: string;
  productVersion: string;
  buyerContractId: string;
  releasedAt: string;
  gateResult: {
    approved: boolean;
    violationCount: number;
    riskScore: number;
  };
  provenance: DataProductProvenance;
  differentialPrivacyApplied: boolean;
  householdCount: number;
  timeRange: { fromMonth: string; toMonth: string };
  approvedBy: string;
  internalNotes: string;
}

export interface AuditExportLog {
  logEntry(entry: Omit<AuditExportLogEntry, 'logId'>): AuditExportLogEntry;
  getEntries(): AuditExportLogEntry[];
  getProductEntries(productId: string): AuditExportLogEntry[];
  getBuyerEntries(buyerContractId: string): AuditExportLogEntry[];
}

// ── Operational Fact (input to pipeline) ───────────────────────

export interface OperationalFact {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

// ── Transform Result ───────────────────────────────────────────

export interface TransformResult {
  success: boolean;
  fact?: AnonymousAnalyticsEvent;
  rejectionReason?: string;
}

// ── Classification Cache ───────────────────────────────────────

export interface ClassificationCacheEntry {
  normalizedLabel: string;
  taxonomyVersion: string;
  taxonomyCategoryId: TaxonomyCategoryId;
  classifierVersion: string;
  confidence: number;
  processedAt: string;
}

// ── Pipeline Checkpoint ────────────────────────────────────────

export interface PipelineCheckpoint {
  id: string;
  householdId: string;
  lastProcessedRevision: number;
  lastProcessedAt: string;
  factsEmitted: number;
  factsRejected: number;
  classificationCacheHits: number;
  classificationCacheMisses: number;
}

// ── Forbidden Fields (compile-time documentation) ──────────────

/**
 * FIELDS THAT MUST NEVER APPEAR IN ANY ANALYTICS TYPE:
 *
 * Operational IDs:
 *   userId, accountId, memberId, householdId, membershipId,
 *   entryId, persistentTaskId, todoId
 *
 * Identifiers:
 *   email, phone, oauthSubject, ipAddress, deviceId, advertisingId
 *
 * Free text:
 *   label, title, notes, name, displayName, householdName, memberName
 *
 * Precise location:
 *   latitude, longitude, address, zipCode
 *
 * Exact timestamps:
 *   createdAt, occurredAt, completedAt (use GeneralizedTimestamp)
 *
 * Join keys:
 *   Any field that could be used to join back to the operational store
 */
