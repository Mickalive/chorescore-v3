/**
 * ChoreScore V3 — Local Research Analytics Adapter
 *
 * Disabled by default. No facts emitted unless explicitly enabled.
 * Disabling MUST NOT break any product functionality.
 */

import { ResearchAnalyticsGateway, AnalyticsFact } from '../../application/ports';

export class LocalResearchAnalyticsAdapter implements ResearchAnalyticsGateway {
  private enabled = false;

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  emitFact(_fact: AnalyticsFact): void {
    // No-op unless explicitly enabled and a pipeline exists
  }

  isAvailable(): boolean {
    return false;
  }
}
