/**
 * ChoreScore V3 — PrivacyReleaseGate
 *
 * Gates every external analytics output. No dataset, aggregate, or
 * analytical result leaves ChoreScore without passing through this gate.
 *
 * Extended from V2 to handle all V3 event types.
 *
 * The gate checks at minimum:
 * 1. No operational IDs (userId, householdId, memberId, etc.)
 * 2. No free text (labels, notes, names)
 * 3. Minimum cohort sizes
 * 4. Rare cell suppression
 * 5. Differencing / reconstruction risk
 * 6. Provenance and transformation version
 * 7. Re-identification risk assessment
 *
 * The gate is the final barrier before any data product is released
 * to researchers, universities, statistical offices, or any external party.
 */

import {
  AnonymousAnalyticsEvent,
  AnonymousHouseholdAggregate,
  AnonymousCohortAggregate,
  ResearchDataProduct,
  DataProductProvenance,
} from './types';

export interface GateCheckResult {
  approved: boolean;
  violations: GateViolation[];
  riskScore: number;
  requiresDifferentialPrivacy: boolean;
}

export interface GateViolation {
  type:
    | 'operational_id_detected'
    | 'free_text_detected'
    | 'cohort_too_small'
    | 'rare_cell'
    | 'reconstruction_risk'
    | 'missing_provenance'
    | 'invalid_provenance'
    | 're_identification_risk'
    | 'missing_taxonomy_version';
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  context?: string;
}

export interface GateConfig {
  minCohortSize: number;
  maxRiskScore: number;
  requireProvenance: boolean;
  version: string;
  maxCategoriesPerCell: number;
}

const DEFAULT_GATE_CONFIG: GateConfig = {
  minCohortSize: 5,
  maxRiskScore: 0.3,
  requireProvenance: true,
  version: '3.0.0',
  maxCategoriesPerCell: 10,
};

const FORBIDDEN_ID_FIELDS = [
  'userId', 'accountId', 'memberId', 'householdId',
  'membershipId', 'entryId', 'todoId', 'persistentTaskId',
  'email', 'phone', 'oauthSubject',
  'ipAddress', 'deviceId', 'advertisingId',
  'name', 'displayName', 'householdName', 'memberName',
];

const FORBIDDEN_TEXT_FIELDS = [
  'label', 'title', 'notes', 'name',
];

/**
 * PrivacyReleaseGate — validates all external analytics outputs.
 */
export class PrivacyReleaseGate {
  private readonly config: GateConfig;

  constructor(config?: Partial<GateConfig>) {
    this.config = { ...DEFAULT_GATE_CONFIG, ...config };
  }

  getConfig(): GateConfig {
    return { ...this.config };
  }

  /**
   * Check a flat record for operational IDs and free text.
   */
  private checkRecord(
    record: Record<string, unknown>,
    context: string
  ): GateViolation[] {
    const violations: GateViolation[] = [];

    for (const field of FORBIDDEN_ID_FIELDS) {
      if (field in record) {
        violations.push({
          type: 'operational_id_detected',
          message: `Operational ID field '${field}' detected in released data`,
          severity: 'critical',
          context: `${context}.${field}`,
        });
      }
    }

    for (const field of FORBIDDEN_TEXT_FIELDS) {
      const value = record[field];
      if (typeof value === 'string' && value.length > 0) {
        violations.push({
          type: 'free_text_detected',
          message: `Free text field '${field}' detected in released data`,
          severity: 'critical',
          context: `${context}.${field}`,
        });
      }
    }

    return violations;
  }

  /**
   * Check cohort size.
   */
  private checkCohortSize(cohortSize: number, context: string): GateViolation[] {
    if (cohortSize < this.config.minCohortSize) {
      return [{
        type: 'cohort_too_small',
        message: `Cohort size ${cohortSize} is below minimum ${this.config.minCohortSize}`,
        severity: 'high',
        context,
      }];
    }
    return [];
  }

  /**
   * Check for rare cells.
   */
  private checkRareCells(
    categoryCounts: Record<string, number>,
    context: string
  ): GateViolation[] {
    const violations: GateViolation[] = [];
    for (const [category, count] of Object.entries(categoryCounts)) {
      if (count > 0 && count < this.config.minCohortSize) {
        violations.push({
          type: 'rare_cell',
          message: `Rare cell: category '${category}' has only ${count} observations (min: ${this.config.minCohortSize})`,
          severity: 'medium',
          context: `${context}.${category}`,
        });
      }
    }
    return violations;
  }

  /**
   * Check provenance metadata.
   */
  private checkProvenance(provenance: DataProductProvenance, context: string): GateViolation[] {
    const violations: GateViolation[] = [];
    if (!this.config.requireProvenance) return violations;

    if (!provenance.pipelineVersion) {
      violations.push({
        type: 'missing_provenance',
        message: 'Missing pipeline version in provenance',
        severity: 'high',
        context: `${context}.provenance.pipelineVersion`,
      });
    }
    if (!provenance.taxonomyVersion) {
      violations.push({
        type: 'missing_taxonomy_version',
        message: 'Missing taxonomy version in provenance',
        severity: 'high',
        context: `${context}.provenance.taxonomyVersion`,
      });
    }
    if (!provenance.producedAt) {
      violations.push({
        type: 'missing_provenance',
        message: 'Missing production timestamp in provenance',
        severity: 'medium',
        context: `${context}.provenance.producedAt`,
      });
    }

    return violations;
  }

  /**
   * Assess re-identification risk.
   */
  private assessReIdentificationRisk(
    facts: Record<string, unknown>[],
    context: string
  ): { violations: GateViolation[]; riskScore: number } {
    const violations: GateViolation[] = [];
    let riskScore = 0;

    const combinations = new Set<string>();
    for (const fact of facts) {
      const key = [
        fact.taxonomyCategoryId ?? fact.type,
        fact.month,
        fact.beneficiaryCount ?? fact.participantCount,
      ].join(':');
      combinations.add(key);
    }

    if (facts.length > 0 && combinations.size > facts.length * 0.8) {
      riskScore += 0.3;
      violations.push({
        type: 'reconstruction_risk',
        message: 'High number of unique combinations relative to total observations — differencing risk',
        severity: 'medium',
        context,
      });
    }

    if (facts.length < this.config.minCohortSize * 2) {
      riskScore += 0.4;
      violations.push({
        type: 're_identification_risk',
        message: `Very small dataset (${facts.length} records) — re-identification risk elevated`,
        severity: 'high',
        context,
      });
    }

    return { violations, riskScore: Math.min(riskScore, 1.0) };
  }

  /**
   * Validate a ResearchDataProduct for external release.
   */
  validate(product: ResearchDataProduct): GateCheckResult {
    const allViolations: GateViolation[] = [];
    let maxRiskScore = 0;

    // 1. Check provenance
    if (product.provenance) {
      allViolations.push(...this.checkProvenance(product.provenance, product.productId));
    } else if (this.config.requireProvenance) {
      allViolations.push({
        type: 'missing_provenance',
        message: 'No provenance metadata on data product',
        severity: 'critical',
        context: product.productId,
      });
    }

    // 2. Check data records for forbidden fields
    const records = product.data as unknown as Record<string, unknown>[];
    if (Array.isArray(records)) {
      for (let i = 0; i < records.length; i++) {
        allViolations.push(
          ...this.checkRecord(records[i], `${product.productId}.data[${i}]`)
        );
      }

      // 3. Check cohort sizes
      allViolations.push(...this.checkCohortSize(product.householdCount, product.productId));

      // 4. Check rare cells
      const categoryCounts: Record<string, number> = {};
      for (const record of records) {
        const cat = (record.taxonomyCategoryId ?? record.type ?? 'unknown') as string;
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      }
      allViolations.push(...this.checkRareCells(categoryCounts, product.productId));

      // 5. Assess re-identification risk
      const risk = this.assessReIdentificationRisk(records, product.productId);
      allViolations.push(...risk.violations);
      maxRiskScore = risk.riskScore;
    }

    // 6. Check household count
    if (product.householdCount < this.config.minCohortSize) {
      allViolations.push({
        type: 'cohort_too_small',
        message: `Household count ${product.householdCount} is below minimum ${this.config.minCohortSize}`,
        severity: 'high',
        context: product.productId,
      });
    }

    // Determine approval
    const criticalViolations = allViolations.filter(v => v.severity === 'critical');
    const highViolations = allViolations.filter(v => v.severity === 'high');
    const approved =
      criticalViolations.length === 0 &&
      highViolations.length === 0 &&
      maxRiskScore <= this.config.maxRiskScore;

    return {
      approved,
      violations: allViolations,
      riskScore: maxRiskScore,
      requiresDifferentialPrivacy: maxRiskScore > 0.2 || highViolations.length > 0,
    };
  }

  /**
   * Quick check: does a record contain any operational ID or free text?
   */
  isClean(record: Record<string, unknown>): { clean: boolean; violations: GateViolation[] } {
    const violations = this.checkRecord(record, 'inline-check');
    return { clean: violations.length === 0, violations };
  }

  /**
   * Generate an audit log entry for a gate check.
   */
  auditLog(
    product: ResearchDataProduct,
    result: GateCheckResult
  ): {
    timestamp: string;
    productId: string;
    approved: boolean;
    violationCount: number;
    riskScore: number;
    gateVersion: string;
  } {
    return {
      timestamp: new Date().toISOString(),
      productId: product.productId,
      approved: result.approved,
      violationCount: result.violations.length,
      riskScore: result.riskScore,
      gateVersion: this.config.version,
    };
  }
}

export function createDefaultGate(): PrivacyReleaseGate {
  return new PrivacyReleaseGate();
}
