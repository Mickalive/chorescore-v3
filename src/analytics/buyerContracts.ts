/**
 * ChoreScore V3 — Buyer Contracts Service
 *
 * Manages contracts with data product buyers.
 * Preserved from V2. Every contract explicitly prohibits
 * re-identification and unauthorized redistribution.
 */

import { BuyerContract, DataProcessingPurpose, Jurisdiction } from './types';

export class BuyerContractsService {
  private contracts: Map<string, BuyerContract> = new Map();
  private counter = 0;

  createContract(data: {
    buyerName: string;
    buyerType: BuyerContract['buyerType'];
    productIds: string[];
    permittedPurposes: DataProcessingPurpose[];
    buyerJurisdiction: Jurisdiction;
    endDate?: string | null;
  }): BuyerContract {
    this.counter++;
    const contract: BuyerContract = {
      contractId: `bc-${Date.now()}-${this.counter}`,
      buyerName: data.buyerName,
      buyerType: data.buyerType,
      productIds: data.productIds,
      permittedPurposes: data.permittedPurposes,
      buyerJurisdiction: data.buyerJurisdiction,
      reIdentificationProhibited: true,
      redistributionProhibited: true,
      commercialUseProhibited: true,
      startDate: new Date().toISOString(),
      endDate: data.endDate ?? null,
      auditRightsGranted: true,
      reIdentificationReportingRequired: true,
    };

    this.contracts.set(contract.contractId, contract);
    return contract;
  }

  getContract(contractId: string): BuyerContract | undefined {
    return this.contracts.get(contractId);
  }

  getBuyerContracts(buyerName: string): BuyerContract[] {
    return Array.from(this.contracts.values()).filter(
      c => c.buyerName === buyerName
    );
  }

  getActiveContracts(): BuyerContract[] {
    const now = Date.now();
    return Array.from(this.contracts.values()).filter(c => {
      if (!c.endDate) return true;
      return new Date(c.endDate).getTime() > now;
    });
  }

  isPurposePermitted(contractId: string, purpose: DataProcessingPurpose): boolean {
    const contract = this.contracts.get(contractId);
    if (!contract) return false;
    return contract.permittedPurposes.includes(purpose);
  }

  isReIdentificationProhibited(contractId: string): boolean {
    const contract = this.contracts.get(contractId);
    if (!contract) return true;
    return contract.reIdentificationProhibited;
  }

  isRedistributionProhibited(contractId: string): boolean {
    const contract = this.contracts.get(contractId);
    if (!contract) return true;
    return contract.redistributionProhibited;
  }

  revokeContract(contractId: string): void {
    const contract = this.contracts.get(contractId);
    if (contract) {
      contract.endDate = new Date().toISOString();
      this.contracts.set(contractId, contract);
    }
  }

  getContractsForProduct(productId: string): BuyerContract[] {
    return Array.from(this.contracts.values()).filter(
      c => c.productIds.includes(productId)
    );
  }
}

export function createDefaultBuyerContracts(): BuyerContractsService {
  return new BuyerContractsService();
}
