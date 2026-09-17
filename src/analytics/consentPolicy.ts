/**
 * ChoreScore V3 — Consent / Purpose / Jurisdiction Policy Service
 *
 * Manages consent records and policy rules per jurisdiction/purpose.
 * Preserved from V2, adapted for V3.
 */

import {
  ConsentRecord,
  ConsentPolicy,
  DataProcessingPurpose,
  Jurisdiction,
} from './types';

const DEFAULT_POLICIES: ConsentPolicy[] = [
  {
    policyId: 'eu-gdpr-default',
    jurisdiction: 'EU-GDPR',
    purposeConsentRequired: {
      'product-improvement': false,
      'research-statistics': true,
      'anonymized-data-product': true,
      'synthetic-data-generation': true,
      'academic-collaboration': true,
    },
    explicitOptInRequired: true,
    retroactiveWithdrawalSupported: true,
    retentionDays: 365 * 3,
    deletionOnWithdrawal: true,
  },
  {
    policyId: 'us-ccpa-default',
    jurisdiction: 'US-CCPA',
    purposeConsentRequired: {
      'product-improvement': false,
      'research-statistics': false,
      'anonymized-data-product': false,
      'synthetic-data-generation': false,
      'academic-collaboration': false,
    },
    explicitOptInRequired: false,
    retroactiveWithdrawalSupported: true,
    retentionDays: 365 * 2,
    deletionOnWithdrawal: true,
  },
  {
    policyId: 'ch-dsg-default',
    jurisdiction: 'CH-DSG',
    purposeConsentRequired: {
      'product-improvement': false,
      'research-statistics': true,
      'anonymized-data-product': true,
      'synthetic-data-generation': true,
      'academic-collaboration': true,
    },
    explicitOptInRequired: true,
    retroactiveWithdrawalSupported: true,
    retentionDays: 365 * 3,
    deletionOnWithdrawal: true,
  },
  {
    policyId: 'uk-gdpr-default',
    jurisdiction: 'UK-GDPR',
    purposeConsentRequired: {
      'product-improvement': false,
      'research-statistics': true,
      'anonymized-data-product': true,
      'synthetic-data-generation': true,
      'academic-collaboration': true,
    },
    explicitOptInRequired: true,
    retroactiveWithdrawalSupported: true,
    retentionDays: 365 * 3,
    deletionOnWithdrawal: true,
  },
];

export class ConsentPolicyService {
  private policies: ConsentPolicy[];
  private consentRecords: ConsentRecord[] = [];

  constructor(policies?: ConsentPolicy[]) {
    this.policies = policies ?? [...DEFAULT_POLICIES];
  }

  getPolicyForJurisdiction(jurisdiction: Jurisdiction): ConsentPolicy | undefined {
    return this.policies.find(p => p.jurisdiction === jurisdiction);
  }

  getAllPolicies(): ConsentPolicy[] {
    return [...this.policies];
  }

  setPolicy(policy: ConsentPolicy): void {
    const existingIndex = this.policies.findIndex(p => p.jurisdiction === policy.jurisdiction);
    if (existingIndex >= 0) {
      this.policies[existingIndex] = policy;
    } else {
      this.policies.push(policy);
    }
  }

  isConsentRequired(jurisdiction: Jurisdiction, purpose: DataProcessingPurpose): boolean {
    const policy = this.getPolicyForJurisdiction(jurisdiction);
    if (!policy) return true;
    return policy.purposeConsentRequired[purpose] ?? true;
  }

  recordConsent(record: Omit<ConsentRecord, 'timestamp'>): ConsentRecord {
    const fullRecord: ConsentRecord = {
      ...record,
      timestamp: new Date().toISOString(),
    };
    this.consentRecords.push(fullRecord);
    return fullRecord;
  }

  hasConsent(userId: string, purpose: DataProcessingPurpose): boolean {
    const relevantRecords = this.consentRecords
      .filter(r => r.userId === userId && r.purpose === purpose);

    if (relevantRecords.length === 0) return false;
    return relevantRecords[relevantRecords.length - 1].granted;
  }

  withdrawConsent(userId: string, purpose: DataProcessingPurpose, jurisdiction: Jurisdiction): ConsentRecord {
    return this.recordConsent({
      userId,
      purpose,
      granted: false,
      jurisdiction,
      noticeVersion: '3.0.0',
      withdrawable: true,
    });
  }

  getUserConsentRecords(userId: string): ConsentRecord[] {
    return this.consentRecords.filter(r => r.userId === userId);
  }

  canProcessData(
    userId: string,
    jurisdiction: Jurisdiction,
    purpose: DataProcessingPurpose
  ): boolean {
    const consentRequired = this.isConsentRequired(jurisdiction, purpose);
    if (!consentRequired) return true;
    return this.hasConsent(userId, purpose);
  }

  getRetentionDays(jurisdiction: Jurisdiction): number {
    const policy = this.getPolicyForJurisdiction(jurisdiction);
    return policy?.retentionDays ?? 365 * 3;
  }

  isDeletionRequiredOnWithdrawal(jurisdiction: Jurisdiction): boolean {
    const policy = this.getPolicyForJurisdiction(jurisdiction);
    return policy?.deletionOnWithdrawal ?? true;
  }

  getExpiredRecords(jurisdiction: Jurisdiction): ConsentRecord[] {
    const retentionDays = this.getRetentionDays(jurisdiction);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    return this.consentRecords.filter(r => {
      if (r.jurisdiction !== jurisdiction) return false;
      return new Date(r.timestamp).getTime() < cutoff;
    });
  }

  purgeExpiredRecords(jurisdiction: Jurisdiction): number {
    const expired = this.getExpiredRecords(jurisdiction);
    const expiredTimestamps = new Set(expired.map(r => r.timestamp));
    this.consentRecords = this.consentRecords.filter(r => !expiredTimestamps.has(r.timestamp));
    return expired.length;
  }
}

export function createDefaultConsentPolicy(): ConsentPolicyService {
  return new ConsentPolicyService();
}
