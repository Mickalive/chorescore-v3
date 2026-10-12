/**
 * ChoreScore V3 — Analytics Privacy Architecture
 *
 * This module implements the Research Analytics Plane for ChoreScore V3.
 * It provides the privacy-first boundary between the operational store
 * (which contains user data, household data, free text, and operational IDs)
 * and the Research Analytics Store (which contains only anonymous statistical facts).
 *
 * Architecture:
 *   Operational Store -> PrivacyTransformPipeline -> PrivacyReleaseGate -> Research Analytics Store
 *
 * Key invariants:
 * - The Research Analytics Store contains ZERO operational IDs
 * - The Research Analytics Store contains ZERO free text
 * - The Research Analytics Store contains ZERO join keys to the operational store
 * - All external outputs must pass through PrivacyReleaseGate
 * - Disabling the ResearchAnalyticsGateway breaks ZERO product functions
 * - The domain never depends on analytics
 *
 * V3 extensions:
 * - Covers contributions (minutes + points), expenses, settlements, and usage
 * - Classification cache prevents redundant taxonomy work
 * - Incremental checkpoints avoid full-history reprocessing
 * - No LLM/classifier in the synchronous user path
 * - Analytics disabled by default — product works perfectly without it
 */

// ── Types ──────────────────────────────────────────────────────

export {
  TaxonomyCategoryId,
  TaxonomyVersion,
  GeneralizedTimestamp,
  DemographicSnapshot,
  AnonymousTaskFact,
  AnonymousContributionEvent,
  AnonymousExpenseEvent,
  AnonymousSettlementEvent,
  AnonymousUsageEvent,
  AnonymousAnalyticsEvent,
  AnonymousHouseholdAggregate,
  AnonymousCohortAggregate,
  ResearchDataProduct,
  DataProductProvenance,
  QueryBudgetConfig,
  DifferentialPrivacyConfig,
  DataProcessingPurpose,
  Jurisdiction,
  ConsentRecord,
  ConsentPolicy,
  BuyerContract,
  AuditExportLogEntry,
  AuditExportLog,
  OperationalFact,
  TransformResult,
  ClassificationCacheEntry,
  PipelineCheckpoint,
} from './types';

// ── Taxonomy ───────────────────────────────────────────────────

export {
  TaskTaxonomyService,
  createDefaultTaxonomy,
  bucketValue,
  bucketGroupSize,
} from './taxonomy';

// ── Classification Cache ───────────────────────────────────────

export {
  ClassificationCache,
  createClassificationCache,
} from './classificationCache';

// ── Pipeline ───────────────────────────────────────────────────

export {
  PrivacyTransformPipeline,
  PipelineConfig,
  createDefaultPipeline,
} from './pipeline';

// ── Gate ───────────────────────────────────────────────────────

export {
  PrivacyReleaseGate,
  GateCheckResult,
  GateViolation,
  GateConfig,
  createDefaultGate,
} from './gate';

// ── Differential Privacy ───────────────────────────────────────

export {
  DifferentialPrivacyService,
  createDefaultDifferentialPrivacy,
} from './differentialPrivacy';

// ── Query Budget ───────────────────────────────────────────────

export {
  QueryBudgetService,
  QueryBudgetCheckResult,
  createDefaultQueryBudget,
} from './queryBudget';

// ── Consent Policy ─────────────────────────────────────────────

export {
  ConsentPolicyService,
  createDefaultConsentPolicy,
} from './consentPolicy';

// ── Buyer Contracts ────────────────────────────────────────────

export {
  BuyerContractsService,
  createDefaultBuyerContracts,
} from './buyerContracts';

// ── Audit Export Log ───────────────────────────────────────────

export {
  InMemoryAuditExportLog,
  createDefaultAuditLog,
} from './auditLog';
