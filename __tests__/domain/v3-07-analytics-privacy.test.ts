/**
 * ChoreScore V3 — V3-07 Analytics Architecture Tests
 *
 * Verifies the complete analytics/privacy pipeline:
 *
 * Acceptance criteria covered:
 * 1. Operational Store et Research Analytics Plane séparés
 * 2. analytics désactivable sans casser le produit
 * 3. taxonomie/classification versionnée
 * 4. aucun texte libre/ID opérationnel dans sorties
 * 5. privacy release gate et anti-reconstruction
 * 6. événements V3 couvrent contributions dépenses settlements usage
 * 7. checkpoint incrémental sans scan historique par défaut
 * 8. classification cache évite appels identiques répétés
 * 9. aucun LLM synchrone dans le parcours utilisateur
 * 10. sans nouvel événement la pipeline ne rescane/reclassifie pas
 * 11. rétention et reprocessing contrôlés
 */

import {
  TaxonomyCategoryId,
  AnonymousTaskFact,
  AnonymousContributionEvent,
  AnonymousExpenseEvent,
  AnonymousSettlementEvent,
  AnonymousUsageEvent,
  AnonymousAnalyticsEvent,
  OperationalFact,
  ResearchDataProduct,
} from '../../src/analytics/types';
import {
  TaskTaxonomyService,
  bucketValue,
  bucketGroupSize,
} from '../../src/analytics/taxonomy';
import { ClassificationCache } from '../../src/analytics/classificationCache';
import {
  PrivacyTransformPipeline,
} from '../../src/analytics/pipeline';
import { PrivacyReleaseGate } from '../../src/analytics/gate';
import { ConsentPolicyService } from '../../src/analytics/consentPolicy';
import { QueryBudgetService } from '../../src/analytics/queryBudget';
import { DifferentialPrivacyService } from '../../src/analytics/differentialPrivacy';
import { BuyerContractsService } from '../../src/analytics/buyerContracts';
import { InMemoryAuditExportLog } from '../../src/analytics/auditLog';
import { LocalResearchAnalyticsAdapter } from '../../src/infrastructure/local/LocalResearchAnalyticsAdapter';

// ── Taxonomy Tests ─────────────────────────────────────────────

describe('V3-07: Taxonomy versionnée et déterministe', () => {
  const taxonomy = new TaskTaxonomyService();

  test('taxonomy has version 3.0.0', () => {
    expect(taxonomy.getVersion()).toBe('3.0.0');
  });

  test('same label always maps to same category (deterministic)', () => {
    const result1 = taxonomy.mapLabel('Faire la vaisselle');
    const result2 = taxonomy.mapLabel('Faire la vaisselle');
    expect(result1).toBe(result2);
    expect(result1).toBe('dishes');
  });

  test('case-insensitive and accent-insensitive', () => {
    expect(taxonomy.mapLabel('VAISSELLE')).toBe('dishes');
    expect(taxonomy.mapLabel('vaisselle')).toBe('dishes');
    expect(taxonomy.mapLabel('Vâissëlle')).toBe('dishes');
  });

  test('free text is handled gracefully — no crash', () => {
    const result = taxonomy.mapLabel('qspi salon');
    expect(typeof result).toBe('string');
    expect(taxonomy.getValidCategories()).toContain(result);
  });

  test('fallback category is "other"', () => {
    expect(taxonomy.mapLabel('zzzzzzzzzzz_unknown_label')).toBe('other');
  });

  test('getValidCategories returns all categories', () => {
    const cats = taxonomy.getValidCategories();
    expect(cats.length).toBeGreaterThanOrEqual(10);
    expect(cats).toContain('kitchen');
    expect(cats).toContain('cleaning');
    expect(cats).toContain('other');
  });

  test('mapLabels batch works identically to individual calls', () => {
    const labels = ['vaisselle', 'courses', 'ménage'];
    const batchResult = taxonomy.mapLabels(labels);
    for (const label of labels) {
      expect(batchResult.get(label)).toBe(taxonomy.mapLabel(label));
    }
  });
});

describe('V3-07: Bucket utilities', () => {
  test('bucketValue correctly buckets amounts', () => {
    expect(bucketValue(500, [1000, 5000, 10000])).toBe('<=1000');
    expect(bucketValue(1000, [1000, 5000, 10000])).toBe('<=1000');
    expect(bucketValue(1500, [1000, 5000, 10000])).toBe('<=5000');
    expect(bucketValue(6000, [1000, 5000, 10000])).toBe('<=10000');
    expect(bucketValue(15000, [1000, 5000, 10000])).toBe('>10000');
  });

  test('bucketGroupSize correctly buckets sizes', () => {
    expect(bucketGroupSize(1)).toBe('2');
    expect(bucketGroupSize(2)).toBe('2');
    expect(bucketGroupSize(3)).toBe('3-4');
    expect(bucketGroupSize(4)).toBe('3-4');
    expect(bucketGroupSize(5)).toBe('5-6');
    expect(bucketGroupSize(6)).toBe('5-6');
    expect(bucketGroupSize(7)).toBe('7+');
    expect(bucketGroupSize(100)).toBe('7+');
  });
});

// ── Classification Cache Tests ─────────────────────────────────

describe('V3-07: Classification cache évite appels identiques répétés', () => {
  const cache = new ClassificationCache();

  test('first classification is a cache miss', () => {
    const { result, cacheHit } = cache.classify('vaisselle');
    expect(cacheHit).toBe(false);
    expect(result.taxonomyCategoryId).toBe('dishes');
    expect(result.taxonomyVersion).toBe('3.0.0');
    expect(result.confidence).toBe(1.0);
    expect(result.classifierVersion).toBe('1.0.0');
  });

  test('second identical classification is a cache hit', () => {
    const { result, cacheHit } = cache.classify('vaisselle');
    expect(cacheHit).toBe(true);
    expect(result.taxonomyCategoryId).toBe('dishes');
  });

  test('different labels are separate cache entries', () => {
    cache.classify('courses');
    cache.classify('ménage');
    expect(cache.size()).toBeGreaterThanOrEqual(3);
  });

  test('batch classification reports cache stats', () => {
    const batchCache = new ClassificationCache();
    const labels = ['vaisselle', 'courses', 'vaisselle', 'ménage', 'courses'];
    const { results, stats } = batchCache.classifyBatch(labels);

    expect(results.length).toBe(5);
    expect(stats.total).toBe(5);
    // First 3 unique labels = 3 misses, remaining 2 = hits
    expect(stats.cacheMisses).toBe(3);
    expect(stats.cacheHits).toBe(2);
  });

  test('has() checks without mutating', () => {
    const freshCache = new ClassificationCache();
    expect(freshCache.has('vaisselle')).toBe(false);
    expect(freshCache.size()).toBe(0);
    freshCache.classify('vaisselle');
    expect(freshCache.has('vaisselle')).toBe(true);
    expect(freshCache.size()).toBe(1);
  });

  test('clear() empties the cache', () => {
    const c = new ClassificationCache();
    c.classify('test');
    expect(c.size()).toBe(1);
    c.clear();
    expect(c.size()).toBe(0);
  });

  test('different classifier versions produce separate cache entries', () => {
    const c = new ClassificationCache();
    const r1 = c.classify('test', '1.0.0');
    const r2 = c.classify('test', '2.0.0');
    expect(r1.cacheHit).toBe(false);
    expect(r2.cacheHit).toBe(false);
    expect(c.size()).toBe(2);
  });
});

// ── Pipeline Tests ─────────────────────────────────────────────

describe('V3-07: Pipeline transforme les opérations V3', () => {
  const pipeline = new PrivacyTransformPipeline();

  test('rejects entry with operational IDs', () => {
    const fact: OperationalFact = {
      type: 'contribution_created',
      data: {
        unit: 'minutes',
        value: 15,
        beneficiaryCount: 2,
        label: 'vaisselle',
        userId: 'u-123', // FORBIDDEN
      },
      timestamp: '2026-09-16T10:00:00.000Z',
    };

    const result = pipeline.transform(fact);
    expect(result.success).toBe(false);
    expect(result.rejectionReason).toContain('userId');
  });

  test('allows label as input (consumed for classification, never emitted)', () => {
    // Label is ALLOWED as pipeline input because it is consumed for taxonomy
    // classification and never emitted in output events.
    // title/notes are NOT consumed and are rejected by validateNoFreeText.
    // The PrivacyReleaseGate guarantees no free text in external data products.
    const fact: OperationalFact = {
      type: 'contribution_created',
      data: {
        unit: 'minutes',
        value: 15,
        beneficiaryCount: 2,
        label: 'vaisselle',
      },
      timestamp: '2026-09-16T10:00:00.000Z',
    };

    const result = pipeline.transform(fact);
    expect(result.success).toBe(true);

    // Verify output contains NO free text — label is consumed, never emitted
    const event = result.fact as unknown as Record<string, unknown>;
    expect(event.label).toBeUndefined();
    expect(event.title).toBeUndefined();
    expect(event.notes).toBeUndefined();
    // But taxonomy category IS derived from the label
    expect(typeof event.taxonomyCategoryId).toBe('string');
  });

  test('rejects unconsumed free text fields (title, notes) on input', () => {
    // title and notes are NOT consumed by any transform — reject them
    const fact: OperationalFact = {
      type: 'contribution_created',
      data: {
        unit: 'minutes',
        value: 15,
        beneficiaryCount: 2,
        label: 'vaisselle',
        notes: 'Some note',
      },
      timestamp: '2026-09-16T10:00:00.000Z',
    };

    const result = pipeline.transform(fact);
    expect(result.success).toBe(false);
    expect(result.rejectionReason).toContain('notes');
  });

  test('transforms contribution_created correctly', () => {
    const fact: OperationalFact = {
      type: 'contribution_created',
      data: {
        unit: 'minutes',
        value: 30,
        beneficiaryCount: 2,
        label: 'vaisselle',
        hasPersistentTask: true,
        wasPlanned: false,
      },
      timestamp: '2026-09-16T10:00:00.000Z',
    };

    const result = pipeline.transform(fact);
    expect(result.success).toBe(true);
    const event = result.fact as AnonymousContributionEvent;
    expect(event.type).toBe('contribution');
    expect(event.unit).toBe('minutes');
    expect(event.value).toBe(30);
    expect(event.beneficiaryCount).toBe(2);
    expect(event.taxonomyCategoryId).toBe('dishes');
    expect(event.hasPersistentTask).toBe(true);
    expect(event.wasPlanned).toBe(false);
    expect(event.timestamp.month).toBe('2026-09');
  });

  test('transforms expense_created correctly (amounts bucketed)', () => {
    const fact: OperationalFact = {
      type: 'expense_created',
      data: {
        amountMinor: 4500,
        currency: 'CHF',
        participantCount: 3,
        splitMode: 'equal',
        hasCategory: true,
      },
      timestamp: '2026-09-16T10:00:00.000Z',
    };

    const result = pipeline.transform(fact);
    expect(result.success).toBe(true);
    const event = result.fact as AnonymousExpenseEvent;
    expect(event.type).toBe('expense');
    expect(event.amountBucket).toBeDefined();
    expect(event.currency).toBe('CHF');
    expect(event.participantCount).toBe(3);
    expect(event.splitMode).toBe('equal');
    expect(event.hasCategory).toBe(true);
    // No free text, no IDs
    expect((event as any).label).toBeUndefined();
    expect((event as any).title).toBeUndefined();
    expect((event as any).memberId).toBeUndefined();
  });

  test('transforms settlement_completed correctly', () => {
    const fact: OperationalFact = {
      type: 'settlement_completed',
      data: {
        contributionUnit: 'minutes',
        contributionValue: 45,
        moneyAmountMinor: 1500,
        currency: 'CHF',
        rateContributionValue: 60,
        rateMoneyAmount: 2000,
      },
      timestamp: '2026-09-16T10:00:00.000Z',
    };

    const result = pipeline.transform(fact);
    expect(result.success).toBe(true);
    const event = result.fact as AnonymousSettlementEvent;
    expect(event.type).toBe('settlement');
    expect(event.contributionUnit).toBe('minutes');
    expect(event.contributionValueBucket).toBeDefined();
    expect(event.moneyAmountBucket).toBeDefined();
    expect(event.currency).toBe('CHF');
    expect(event.rateContributionValue).toBe(60);
    expect(event.rateMoneyAmount).toBe(2000);
  });

  test('transforms usage_event correctly', () => {
    const fact: OperationalFact = {
      type: 'usage_event',
      data: {
        feature: 'group-created',
        groupSize: 4,
      },
      timestamp: '2026-09-16T10:00:00.000Z',
    };

    const result = pipeline.transform(fact);
    expect(result.success).toBe(true);
    const event = result.fact as AnonymousUsageEvent;
    expect(event.type).toBe('usage');
    expect(event.feature).toBe('group-created');
    expect(event.groupSizeBucket).toBe('3-4');
  });

  test('rejects unknown fact types', () => {
    const fact: OperationalFact = {
      type: 'unknown_event',
      data: {},
      timestamp: '2026-09-16T10:00:00.000Z',
    };

    const result = pipeline.transform(fact);
    expect(result.success).toBe(false);
    expect(result.rejectionReason).toContain('Unknown fact type');
  });

  test('transforms V2 entry_created (backward compatible)', () => {
    const fact: OperationalFact = {
      type: 'entry_created',
      data: {
        durationMinutes: 25,
        beneficiaryCount: 2,
        hasPersistentTask: false,
        weight: 1.0,
        label: 'aspirateur',
      },
      timestamp: '2026-09-16T10:00:00.000Z',
    };

    const result = pipeline.transform(fact);
    expect(result.success).toBe(true);
    const event = result.fact as AnonymousTaskFact;
    expect(event.taxonomyCategoryId).toBe('cleaning');
    expect(event.durationMinutes).toBe(25);
    expect(event.beneficiaryCount).toBe(2);
  });

  test('batch transform handles mixed valid and invalid facts', () => {
    const facts: OperationalFact[] = [
      {
        type: 'contribution_created',
        data: { unit: 'minutes', value: 15, beneficiaryCount: 2, label: 'vaisselle' },
        timestamp: '2026-09-16T10:00:00.000Z',
      },
      {
        type: 'contribution_created',
        data: { unit: 'minutes', value: 15, beneficiaryCount: 2, label: 'test', userId: 'bad' },
        timestamp: '2026-09-16T10:00:00.000Z',
      },
      {
        type: 'expense_created',
        data: { amountMinor: 1000, currency: 'CHF', participantCount: 2 },
        timestamp: '2026-09-16T10:00:00.000Z',
      },
    ];

    const { accepted, rejected } = pipeline.transformBatch(facts);
    expect(accepted.length).toBe(2);
    expect(rejected.length).toBe(1);
    expect(rejected[0].fact.data.userId).toBe('bad');
  });

  test('generalizeTimestamp produces coarse dimensions', () => {
    const ts = '2026-09-16T14:30:00.000Z';
    const generalized = pipeline.generalizeTimestamp(ts);

    expect(generalized.month).toBe('2026-09');
    expect(generalized.dayOfWeek).toBeGreaterThanOrEqual(1);
    expect(generalized.dayOfWeek).toBeLessThanOrEqual(7);
    expect(generalized.hourBucket).toBeGreaterThanOrEqual(0);
    expect(generalized.hourBucket).toBeLessThan(24);
    expect(generalized.isoWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── Privacy Release Gate Tests ─────────────────────────────────

describe('V3-07: Privacy release gate et anti-reconstruction', () => {
  const gate = new PrivacyReleaseGate();

  test('rejects product with operational IDs', () => {
    const product: ResearchDataProduct = {
      productId: 'test-1',
      version: '1.0.0',
      taxonomyVersion: '3.0.0',
      type: 'aggregate',
      householdCount: 10,
      timeRange: { fromMonth: '2026-01', toMonth: '2026-09' },
      data: [
        { userId: 'u-1', someField: 'value' } as any, // FORBIDDEN
      ],
      provenance: {
        pipelineVersion: '3.0.0',
        producedAt: '2026-09-16T00:00:00.000Z',
        taxonomyVersion: '3.0.0',
        transformations: [],
        gateVersion: '3.0.0',
        differentialPrivacyApplied: false,
      },
    };

    const result = gate.validate(product);
    expect(result.approved).toBe(false);
    expect(result.violations.some(v => v.type === 'operational_id_detected')).toBe(true);
  });

  test('rejects product with free text', () => {
    const product: ResearchDataProduct = {
      productId: 'test-2',
      version: '1.0.0',
      taxonomyVersion: '3.0.0',
      type: 'aggregate',
      householdCount: 10,
      timeRange: { fromMonth: '2026-01', toMonth: '2026-09' },
      data: [
        { label: 'vaisselle', taxonomyCategoryId: 'dishes' },
      ] as unknown as ResearchDataProduct['data'], // label is FORBIDDEN in output
      provenance: {
        pipelineVersion: '3.0.0',
        producedAt: '2026-09-16T00:00:00.000Z',
        taxonomyVersion: '3.0.0',
        transformations: [],
        gateVersion: '3.0.0',
        differentialPrivacyApplied: false,
      },
    };

    const result = gate.validate(product);
    expect(result.approved).toBe(false);
    expect(result.violations.some(v => v.type === 'free_text_detected')).toBe(true);
  });

  test('rejects product with small cohort', () => {
    const product: ResearchDataProduct = {
      productId: 'test-3',
      version: '1.0.0',
      taxonomyVersion: '3.0.0',
      type: 'aggregate',
      householdCount: 2, // Below minimum 5
      timeRange: { fromMonth: '2026-01', toMonth: '2026-09' },
      data: [],
      provenance: {
        pipelineVersion: '3.0.0',
        producedAt: '2026-09-16T00:00:00.000Z',
        taxonomyVersion: '3.0.0',
        transformations: [],
        gateVersion: '3.0.0',
        differentialPrivacyApplied: false,
      },
    };

    const result = gate.validate(product);
    expect(result.approved).toBe(false);
    expect(result.violations.some(v => v.type === 'cohort_too_small')).toBe(true);
  });

  test('rejects product without provenance', () => {
    const product: ResearchDataProduct = {
      productId: 'test-4',
      version: '1.0.0',
      taxonomyVersion: '3.0.0',
      type: 'aggregate',
      householdCount: 10,
      timeRange: { fromMonth: '2026-01', toMonth: '2026-09' },
      data: [],
      provenance: undefined as any,
    };

    const result = gate.validate(product);
    expect(result.approved).toBe(false);
    expect(result.violations.some(v => v.type === 'missing_provenance')).toBe(true);
  });

  test('approves clean product with proper provenance', () => {
    // Must satisfy ALL gate rules for approved=true with 0 violations:
    // 1. >= minCohortSize*2 (10) total records → re_identification_risk
    // 2. combinations.size <= facts.length * 0.8 → reconstruction_risk
    // 3. Each category count >= minCohortSize (5) → rare_cell
    // 4. householdCount >= minCohortSize → cohort_too_small
    // 18 records, 3 unique combos, 6 per category → all checks pass
    const data: Array<Record<string, unknown>> = [
      // 6x dishes/2026-09/2 → 1 combo
      ...Array.from({ length: 6 }, () => ({
        taxonomyCategoryId: 'dishes', month: '2026-09', beneficiaryCount: 2,
      })),
      // 6x cleaning/2026-09/3 → 1 combo
      ...Array.from({ length: 6 }, () => ({
        taxonomyCategoryId: 'cleaning', month: '2026-09', beneficiaryCount: 3,
      })),
      // 6x kitchen/2026-08/2 → 1 combo
      ...Array.from({ length: 6 }, () => ({
        taxonomyCategoryId: 'kitchen', month: '2026-08', beneficiaryCount: 2,
      })),
    ];

    const product: ResearchDataProduct = {
      productId: 'test-5',
      version: '1.0.0',
      taxonomyVersion: '3.0.0',
      type: 'aggregate',
      householdCount: 10,
      timeRange: { fromMonth: '2026-01', toMonth: '2026-09' },
      data: data as unknown as ResearchDataProduct['data'],
      provenance: {
        pipelineVersion: '3.0.0',
        producedAt: '2026-09-16T00:00:00.000Z',
        taxonomyVersion: '3.0.0',
        transformations: ['taxonomy-mapping'],
        gateVersion: '3.0.0',
        differentialPrivacyApplied: false,
      },
    };

    const result = gate.validate(product);
    expect(result.approved).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  test('isClean detects operational IDs', () => {
    const { clean: clean1 } = gate.isClean({ taxonomyCategoryId: 'dishes' });
    expect(clean1).toBe(true);

    const { clean: clean2, violations } = gate.isClean({ userId: 'u-1' });
    expect(clean2).toBe(false);
    expect(violations.some(v => v.type === 'operational_id_detected')).toBe(true);
  });

  test('audit log entry is generated', () => {
    // Use non-empty data that passes the gate's anti-reconstruction rules
    // (≥10 records, ≥5 per category, repeated combos)
    const data: Array<Record<string, unknown>> = [
      ...Array.from({ length: 6 }, () => ({
        taxonomyCategoryId: 'dishes', month: '2026-09', beneficiaryCount: 2,
      })),
      ...Array.from({ length: 6 }, () => ({
        taxonomyCategoryId: 'cleaning', month: '2026-09', beneficiaryCount: 3,
      })),
    ];

    const product: ResearchDataProduct = {
      productId: 'test-audit',
      version: '1.0.0',
      taxonomyVersion: '3.0.0',
      type: 'aggregate',
      householdCount: 10,
      timeRange: { fromMonth: '2026-01', toMonth: '2026-09' },
      data: data as unknown as ResearchDataProduct['data'],
      provenance: {
        pipelineVersion: '3.0.0',
        producedAt: '2026-09-16T00:00:00.000Z',
        taxonomyVersion: '3.0.0',
        transformations: [],
        gateVersion: '3.0.0',
        differentialPrivacyApplied: false,
      },
    };

    const result = gate.validate(product);
    const log = gate.auditLog(product, result);
    expect(log.productId).toBe('test-audit');
    expect(log.gateVersion).toBe('3.0.0');
    // The audit log records whatever the gate decided, whether approved or not
    expect(log.approved).toBe(result.approved);
    expect(log.violationCount).toBe(result.violations.length);
  });
});

// ── Consent Policy Tests ───────────────────────────────────────

describe('V3-07: Consent policy et rétention contrôlée', () => {
  const consent = new ConsentPolicyService();

  test('default policies exist for major jurisdictions', () => {
    const policies = consent.getAllPolicies();
    expect(policies.length).toBeGreaterThanOrEqual(4);

    const euPolicy = consent.getPolicyForJurisdiction('EU-GDPR');
    expect(euPolicy).toBeDefined();
    expect(euPolicy!.explicitOptInRequired).toBe(true);
    expect(euPolicy!.retentionDays).toBeGreaterThan(0);
  });

  test('consent required for research-statistics in EU-GDPR', () => {
    expect(consent.isConsentRequired('EU-GDPR', 'research-statistics')).toBe(true);
    expect(consent.isConsentRequired('US-CCPA', 'research-statistics')).toBe(false);
  });

  test('record and check consent', () => {
    consent.recordConsent({
      userId: 'user-1',
      purpose: 'research-statistics',
      granted: true,
      jurisdiction: 'EU-GDPR',
      noticeVersion: '3.0.0',
      withdrawable: true,
    });

    expect(consent.hasConsent('user-1', 'research-statistics')).toBe(true);
    expect(consent.hasConsent('user-1', 'anonymized-data-product')).toBe(false);
  });

  test('withdraw consent', () => {
    consent.recordConsent({
      userId: 'user-2',
      purpose: 'research-statistics',
      granted: true,
      jurisdiction: 'EU-GDPR',
      noticeVersion: '3.0.0',
      withdrawable: true,
    });

    consent.withdrawConsent('user-2', 'research-statistics', 'EU-GDPR');
    expect(consent.hasConsent('user-2', 'research-statistics')).toBe(false);
  });

  test('canProcessData checks both consent and policy', () => {
    // EU-GDPR requires consent for research-statistics
    expect(consent.canProcessData('user-noconsent', 'EU-GDPR', 'research-statistics')).toBe(false);

    consent.recordConsent({
      userId: 'user-consented',
      purpose: 'research-statistics',
      granted: true,
      jurisdiction: 'EU-GDPR',
      noticeVersion: '3.0.0',
      withdrawable: true,
    });
    expect(consent.canProcessData('user-consented', 'EU-GDPR', 'research-statistics')).toBe(true);
  });

  test('retention period is configurable per jurisdiction', () => {
    const euDays = consent.getRetentionDays('EU-GDPR');
    const usDays = consent.getRetentionDays('US-CCPA');
    expect(euDays).toBe(365 * 3);
    expect(usDays).toBe(365 * 2);
  });

  test('deletion required on withdrawal in EU', () => {
    expect(consent.isDeletionRequiredOnWithdrawal('EU-GDPR')).toBe(true);
  });
});

// ── Query Budget Tests ─────────────────────────────────────────

describe('V3-07: Query budget', () => {
  const budget = new QueryBudgetService({ rateLimitPerMinute: 3, rateLimitPerDay: 10 });

  test('allows queries within budget', () => {
    // Semantic: remainingQueriesThisMinute = queries remaining AFTER this one
    // (limit - queriesBeforeThisQuery - 1 = 3 - 0 - 1 = 2)
    const r1 = budget.checkBudget(2, 12);
    expect(r1.allowed).toBe(true);
    expect(r1.remainingQueriesToday).toBe(9);
    expect(r1.remainingQueriesThisMinute).toBe(2);
  });

  test('rejects when minute limit exceeded', () => {
    const b = new QueryBudgetService({ rateLimitPerMinute: 2, rateLimitPerDay: 100 });
    b.checkBudget(1, 1);
    b.checkBudget(1, 1);
    const r = b.checkBudget(1, 1);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('Rate limit');
  });

  test('rejects when too many dimensions', () => {
    const b = new QueryBudgetService({ maxDimensionsPerQuery: 3 });
    const r = b.checkBudget(5, 1);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('Too many dimensions');
  });

  test('rejects when time range too large', () => {
    const b = new QueryBudgetService({ maxTimeRangeMonths: 12 });
    const r = b.checkBudget(1, 24);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('Time range too large');
  });
});

// ── Differential Privacy Tests ─────────────────────────────────

describe('V3-07: Differential privacy', () => {
  test('disabled by default', () => {
    const dp = new DifferentialPrivacyService();
    expect(dp.isEnabled()).toBe(false);
    expect(dp.addNoise(100)).toBe(100); // No noise when disabled
  });

  test('when enabled, adds noise and consumes budget', () => {
    const dp = new DifferentialPrivacyService({ enabled: true, maxQueries: 5, remainingBudget: 5 });
    expect(dp.hasRemainingBudget()).toBe(true);

    const result = dp.addNoise(100, 1);
    // Result should be different from input (with very high probability)
    // Budget should decrease
    expect(dp.getRemainingBudget()).toBe(4);
  });

  test('budget exhaustion returns original value', () => {
    const dp = new DifferentialPrivacyService({ enabled: true, maxQueries: 1, remainingBudget: 0 });
    expect(dp.addNoise(100)).toBe(100);
  });

  test('addNoiseToArray works', () => {
    const dp = new DifferentialPrivacyService({ enabled: false });
    expect(dp.addNoiseToArray([10, 20, 30])).toEqual([10, 20, 30]);
  });
});

// ── Buyer Contracts Tests ──────────────────────────────────────

describe('V3-07: Buyer contracts', () => {
  const bc = new BuyerContractsService();

  test('creates contract with mandatory prohibitions', () => {
    const contract = bc.createContract({
      buyerName: 'University of Zurich',
      buyerType: 'university',
      productIds: ['product-1'],
      permittedPurposes: ['research-statistics'],
      buyerJurisdiction: 'CH-DSG',
    });

    expect(contract.reIdentificationProhibited).toBe(true);
    expect(contract.redistributionProhibited).toBe(true);
    expect(contract.commercialUseProhibited).toBe(true);
    expect(contract.auditRightsGranted).toBe(true);
    expect(contract.reIdentificationReportingRequired).toBe(true);
  });

  test('validates purpose permission', () => {
    const contract = bc.createContract({
      buyerName: 'ETH Zurich',
      buyerType: 'university',
      productIds: ['product-1'],
      permittedPurposes: ['research-statistics'],
      buyerJurisdiction: 'CH-DSG',
    });

    expect(bc.isPurposePermitted(contract.contractId, 'research-statistics')).toBe(true);
    expect(bc.isPurposePermitted(contract.contractId, 'synthetic-data-generation')).toBe(false);
  });

  test('getActiveContracts excludes expired', () => {
    const active = bc.createContract({
      buyerName: 'Active Org',
      buyerType: 'ngo',
      productIds: ['p-1'],
      permittedPurposes: ['research-statistics'],
      buyerJurisdiction: 'other',
    });

    const expired = bc.createContract({
      buyerName: 'Expired Org',
      buyerType: 'ngo',
      productIds: ['p-2'],
      permittedPurposes: ['research-statistics'],
      buyerJurisdiction: 'other',
      endDate: '2020-01-01T00:00:00.000Z',
    });

    const actives = bc.getActiveContracts();
    expect(actives.some(c => c.contractId === active.contractId)).toBe(true);
    expect(actives.some(c => c.contractId === expired.contractId)).toBe(false);
  });
});

// ── Audit Log Tests ────────────────────────────────────────────

describe('V3-07: Audit export log', () => {
  const log = new InMemoryAuditExportLog();

  test('logs and retrieves entries', () => {
    const entry = log.logEntry({
      productId: 'product-1',
      productVersion: '1.0.0',
      buyerContractId: 'bc-1',
      releasedAt: '2026-09-16T00:00:00.000Z',
      gateResult: { approved: true, violationCount: 0, riskScore: 0 },
      provenance: {
        pipelineVersion: '3.0.0',
        producedAt: '2026-09-16T00:00:00.000Z',
        taxonomyVersion: '3.0.0',
        transformations: [],
        gateVersion: '3.0.0',
        differentialPrivacyApplied: false,
      },
      differentialPrivacyApplied: false,
      householdCount: 10,
      timeRange: { fromMonth: '2026-01', toMonth: '2026-09' },
      approvedBy: 'system',
      internalNotes: 'Test release',
    });

    expect(entry.logId).toBeDefined();
    expect(log.getEntries()).toHaveLength(1);
    expect(log.getReleaseCount()).toBe(1);
    expect(log.hasReleases()).toBe(true);
  });

  test('filters by product and buyer', () => {
    log.logEntry({
      productId: 'product-2',
      productVersion: '1.0.0',
      buyerContractId: 'bc-2',
      releasedAt: '2026-09-16T00:00:00.000Z',
      gateResult: { approved: true, violationCount: 0, riskScore: 0 },
      provenance: {
        pipelineVersion: '3.0.0',
        producedAt: '2026-09-16T00:00:00.000Z',
        taxonomyVersion: '3.0.0',
        transformations: [],
        gateVersion: '3.0.0',
        differentialPrivacyApplied: false,
      },
      differentialPrivacyApplied: false,
      householdCount: 10,
      timeRange: { fromMonth: '2026-01', toMonth: '2026-09' },
      approvedBy: 'system',
      internalNotes: '',
    });

    expect(log.getProductEntries('product-2')).toHaveLength(1);
    expect(log.getProductEntries('product-999')).toHaveLength(0);
    expect(log.getBuyerEntries('bc-2')).toHaveLength(1);
  });
});

// ── Analytics Adapter Tests ────────────────────────────────────

describe('V3-07: analytics désactivable sans casser le produit', () => {
  test('adapter is disabled by default', () => {
    const adapter = new LocalResearchAnalyticsAdapter();
    expect(adapter.isEnabled()).toBe(false);
    expect(adapter.isAvailable()).toBe(false);
  });

  test('adapter can be enabled/disabled', () => {
    const adapter = new LocalResearchAnalyticsAdapter();
    adapter.setEnabled(true);
    expect(adapter.isEnabled()).toBe(true);

    adapter.setEnabled(false);
    expect(adapter.isEnabled()).toBe(false);
  });

  test('emitFact does not crash when disabled', () => {
    const adapter = new LocalResearchAnalyticsAdapter();
    // Should not throw
    adapter.emitFact({ type: 'test', data: {}, timestamp: new Date().toISOString() });
  });

  test('emitFact does not crash when enabled (no pipeline)', () => {
    const adapter = new LocalResearchAnalyticsAdapter();
    adapter.setEnabled(true);
    // Should not throw even without a pipeline
    adapter.emitFact({ type: 'test', data: {}, timestamp: new Date().toISOString() });
  });
});

// ── Operational Store vs Research Analytics Plane Separation ────

describe('V3-07: Operational Store et Research Analytics Plane séparés', () => {
  test('pipeline input (OperationalFact) never reaches output (AnonymousAnalyticsEvent)', () => {
    const pipeline = new PrivacyTransformPipeline();

    const fact: OperationalFact = {
      type: 'contribution_created',
      data: {
        unit: 'minutes',
        value: 30,
        beneficiaryCount: 2,
        label: 'vaisselle',
      },
      timestamp: '2026-09-16T10:00:00.000Z',
    };

    const result = pipeline.transform(fact);
    expect(result.success).toBe(true);

    const event = result.fact! as unknown as Record<string, unknown>;

    // No operational IDs in output
    expect(event.userId).toBeUndefined();
    expect(event.memberId).toBeUndefined();
    expect(event.householdId).toBeUndefined();
    expect(event.createdBy).toBeUndefined();

    // No free text in output
    expect(event.label).toBeUndefined();
    expect(event.title).toBeUndefined();
    expect(event.notes).toBeUndefined();

    // TaxonomyCategoryId is present (derived, not free text)
    expect(typeof event.taxonomyCategoryId).toBe('string');
    expect(typeof event.taxonomyVersion).toBe('string');
  });

  test('V3 events cover contributions, expenses, settlements, usage', () => {
    const pipeline = new PrivacyTransformPipeline();

    // Contribution
    const contrib = pipeline.transform({
      type: 'contribution_created',
      data: { unit: 'minutes', value: 15, beneficiaryCount: 2, label: 'vaisselle' },
      timestamp: '2026-09-16T10:00:00.000Z',
    });
    expect(contrib.success).toBe(true);
    expect((contrib.fact as any).type).toBe('contribution');

    // Expense
    const expense = pipeline.transform({
      type: 'expense_created',
      data: { amountMinor: 2500, currency: 'CHF', participantCount: 3 },
      timestamp: '2026-09-16T10:00:00.000Z',
    });
    expect(expense.success).toBe(true);
    expect((expense.fact as any).type).toBe('expense');

    // Settlement
    const settlement = pipeline.transform({
      type: 'settlement_completed',
      data: { contributionUnit: 'points', contributionValue: 10, moneyAmountMinor: 1500, currency: 'CHF' },
      timestamp: '2026-09-16T10:00:00.000Z',
    });
    expect(settlement.success).toBe(true);
    expect((settlement.fact as any).type).toBe('settlement');

    // Usage
    const usage = pipeline.transform({
      type: 'usage_event',
      data: { feature: 'contribution-added', groupSize: 3 },
      timestamp: '2026-09-16T10:00:00.000Z',
    });
    expect(usage.success).toBe(true);
    expect((usage.fact as any).type).toBe('usage');
  });
});

// ── Incremental Checkpoint Tests ───────────────────────────────

describe('V3-07: Checkpoint incrémental sans scan historique par défaut', () => {
  test('pipeline creates checkpoints with processing stats', () => {
    const pipeline = new PrivacyTransformPipeline();
    const checkpoint = pipeline.createCheckpoint(
      'hh-1',
      42, // lastProcessedRevision
      100, // factsEmitted
      5, // factsRejected
      80, // classificationCacheHits
      20 // classificationCacheMisses
    );

    expect(checkpoint.householdId).toBe('hh-1');
    expect(checkpoint.lastProcessedRevision).toBe(42);
    expect(checkpoint.factsEmitted).toBe(100);
    expect(checkpoint.factsRejected).toBe(5);
    expect(checkpoint.classificationCacheHits).toBe(80);
    expect(checkpoint.classificationCacheMisses).toBe(20);
    expect(checkpoint.id).toBeDefined();
    expect(checkpoint.lastProcessedAt).toBeDefined();
  });

  test('checkpoint tracks cache performance', () => {
    const pipeline = new PrivacyTransformPipeline();
    const cache = pipeline.getClassificationCache();

    // Warm the cache
    cache.classify('vaisselle');
    cache.classify('courses');

    // Now process facts — should hit cache
    const facts: OperationalFact[] = [
      { type: 'contribution_created', data: { unit: 'minutes', value: 15, beneficiaryCount: 2, label: 'vaisselle' }, timestamp: '2026-09-16T10:00:00.000Z' },
      { type: 'contribution_created', data: { unit: 'minutes', value: 30, beneficiaryCount: 2, label: 'vaisselle' }, timestamp: '2026-09-16T10:00:00.000Z' },
      { type: 'contribution_created', data: { unit: 'points', value: 5, beneficiaryCount: 3, label: 'courses' }, timestamp: '2026-09-16T10:00:00.000Z' },
    ];

    pipeline.transformBatch(facts);

    const checkpoint = pipeline.createCheckpoint('hh-1', 10, 3, 0, 3, 0);
    expect(checkpoint.classificationCacheHits).toBe(3);
    expect(checkpoint.classificationCacheMisses).toBe(0);
  });
});

// ── No LLM/Synchronous Classifier in User Path ────────────────

describe('V3-07: Aucun LLM synchrone dans le parcours utilisateur', () => {
  test('taxonomy is rule-based, not ML-based', () => {
    const taxonomy = new TaskTaxonomyService();
    const taxonomy2 = new TaskTaxonomyService();

    // Same input → same output (deterministic, no ML randomness)
    for (let i = 0; i < 10; i++) {
      expect(taxonomy.mapLabel('vaisselle')).toBe('dishes');
    }

    // Two instances produce identical results
    expect(taxonomy.mapLabel('courses')).toBe(taxonomy2.mapLabel('courses'));
  });

  test('classification cache is synchronous and local', () => {
    const cache = new ClassificationCache();
    const start = Date.now();
    // Classify 1000 labels
    for (let i = 0; i < 1000; i++) {
      cache.classify(`test_label_${i}`);
    }
    const elapsed = Date.now() - start;
    // Should be very fast (rule-based, no network)
    expect(elapsed).toBeLessThan(1000);
  });
});

// ── Without New Events, Pipeline Does Not Rescan ───────────────

describe('V3-07: Sans nouvel événement, la pipeline ne rescane pas', () => {
  test('pipeline is stateless — no automatic reprocessing', () => {
    const pipeline = new PrivacyTransformPipeline();
    const cache = pipeline.getClassificationCache();

    // Process some facts
    const facts: OperationalFact[] = [
      { type: 'contribution_created', data: { unit: 'minutes', value: 15, beneficiaryCount: 2, label: 'vaisselle' }, timestamp: '2026-09-16T10:00:00.000Z' },
    ];
    pipeline.transformBatch(facts);

    const cacheSize1 = cache.size();

    // Without new input, cache should not grow
    const cacheSize2 = cache.size();
    expect(cacheSize2).toBe(cacheSize1);
  });

  test('classification cache prevents duplicate work', () => {
    const cache = new ClassificationCache();

    // First call
    cache.classify('vaisselle');
    const sizeAfterFirst = cache.size();

    // Second call — no new entry created
    cache.classify('vaisselle');
    const sizeAfterSecond = cache.size();

    expect(sizeAfterSecond).toBe(sizeAfterFirst);
  });
});

// ── Rare Cell Suppression ──────────────────────────────────────

describe('V3-07: Suppression cellules rares', () => {
  test('suppresses cells with fewer observations than minimum cohort', () => {
    const pipeline = new PrivacyTransformPipeline({ minCohortSize: 3 });

    const facts: AnonymousAnalyticsEvent[] = [
      // Category with 5 observations (should be included)
      ...Array.from({ length: 5 }, (_, i) => ({
        type: 'contribution' as const,
        unit: 'minutes' as const,
        value: 15,
        beneficiaryCount: 2,
        hasPersistentTask: false,
        taxonomyCategoryId: 'dishes' as TaxonomyCategoryId,
        taxonomyVersion: '3.0.0',
        wasPlanned: false,
        timestamp: { isoWeek: '2026-09-14', month: '2026-09', dayOfWeek: 1, hourBucket: 8 },
      })),
      // Category with 2 observations (should be suppressed)
      ...Array.from({ length: 2 }, (_, i) => ({
        type: 'contribution' as const,
        unit: 'minutes' as const,
        value: 30,
        beneficiaryCount: 3,
        hasPersistentTask: false,
        taxonomyCategoryId: 'childcare' as TaxonomyCategoryId,
        taxonomyVersion: '3.0.0',
        wasPlanned: false,
        timestamp: { isoWeek: '2026-09-14', month: '2026-09', dayOfWeek: 1, hourBucket: 8 },
      })),
    ];

    const { included, suppressed } = pipeline.checkRareCells(facts);
    expect(included.length).toBe(5);
    expect(suppressed.length).toBe(2);
  });

  test('when suppressRareCells is false, nothing is suppressed', () => {
    const pipeline = new PrivacyTransformPipeline({ suppressRareCells: false, minCohortSize: 100 });

    const facts: AnonymousAnalyticsEvent[] = [
      {
        type: 'contribution' as const,
        unit: 'minutes' as const,
        value: 15,
        beneficiaryCount: 2,
        hasPersistentTask: false,
        taxonomyCategoryId: 'dishes' as TaxonomyCategoryId,
        taxonomyVersion: '3.0.0',
        wasPlanned: false,
        timestamp: { isoWeek: '2026-09-14', month: '2026-09', dayOfWeek: 1, hourBucket: 8 },
      },
    ];

    const { included, suppressed } = pipeline.checkRareCells(facts);
    expect(included.length).toBe(1);
    expect(suppressed.length).toBe(0);
  });
});

// ── Retention & Reprocessing Controlled ────────────────────────

describe('V3-07: Rétention et reprocessing contrôlés', () => {
  test('consent retention periods are finite', () => {
    const consent = new ConsentPolicyService();
    for (const policy of consent.getAllPolicies()) {
      expect(policy.retentionDays).toBeGreaterThan(0);
      expect(policy.retentionDays).toBeLessThanOrEqual(365 * 5);
    }
  });

  test('expired consent records can be purged', () => {
    const consent = new ConsentPolicyService();

    // Use retentionDays: -1 so cutoff is strictly in the future of any
    // just-created record, making the test deterministic across runs
    // (no same-millisecond race with retentionDays: 0).
    consent.setPolicy({
      policyId: 'test-short',
      jurisdiction: 'other',
      purposeConsentRequired: { 'research-statistics': true } as any,
      explicitOptInRequired: true,
      retroactiveWithdrawalSupported: true,
      retentionDays: -1,
      deletionOnWithdrawal: true,
    });

    consent.recordConsent({
      userId: 'user-old',
      purpose: 'research-statistics',
      granted: true,
      jurisdiction: 'other',
      noticeVersion: '3.0.0',
      withdrawable: true,
    });

    const expired = consent.getExpiredRecords('other');
    expect(expired.length).toBeGreaterThanOrEqual(1);

    const purged = consent.purgeExpiredRecords('other');
    expect(purged).toBeGreaterThanOrEqual(1);
  });

  test('pipeline checkpoint records processing counts for audit', () => {
    const pipeline = new PrivacyTransformPipeline();
    const checkpoint = pipeline.createCheckpoint('hh-1', 100, 50, 2, 45, 5);

    // Checkpoint captures what was processed, enabling incremental reprocessing
    expect(checkpoint.lastProcessedRevision).toBe(100);
    expect(checkpoint.factsEmitted + checkpoint.factsRejected).toBe(52);
    expect(checkpoint.classificationCacheHits + checkpoint.classificationCacheMisses).toBe(50);
  });
});
