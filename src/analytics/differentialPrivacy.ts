/**
 * ChoreScore V3 — Differential Privacy Service
 *
 * Provides mathematical privacy guarantees for query results.
 * Preserved from V2.
 */

import { DifferentialPrivacyConfig } from './types';

const DEFAULT_DP_CONFIG: DifferentialPrivacyConfig = {
  enabled: false,
  epsilon: 1.0,
  delta: 1e-5,
  mechanism: 'laplace',
  maxQueries: 1000,
  remainingBudget: 1000,
};

export class DifferentialPrivacyService {
  private config: DifferentialPrivacyConfig;

  constructor(config?: Partial<DifferentialPrivacyConfig>) {
    this.config = { ...DEFAULT_DP_CONFIG, ...config };
  }

  getConfig(): DifferentialPrivacyConfig {
    return { ...this.config };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  hasRemainingBudget(): boolean {
    return this.config.remainingBudget > 0;
  }

  getRemainingBudget(): number {
    return this.config.remainingBudget;
  }

  addNoise(value: number, sensitivity: number = 1): number {
    if (!this.config.enabled) return value;
    if (!this.hasRemainingBudget()) return value;

    let noise: number;
    if (this.config.mechanism === 'laplace') {
      noise = this.laplaceMechanism(sensitivity, this.config.epsilon);
    } else {
      noise = this.gaussianMechanism(sensitivity, this.config.epsilon, this.config.delta);
    }

    this.config.remainingBudget--;
    return value + noise;
  }

  addNoiseToArray(values: number[], sensitivity: number = 1): number[] {
    return values.map(v => this.addNoise(v, sensitivity));
  }

  clipValue(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private laplaceMechanism(sensitivity: number, epsilon: number): number {
    const scale = sensitivity / epsilon;
    const u = Math.random() - 0.5;
    return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
  }

  private gaussianMechanism(sensitivity: number, epsilon: number, delta: number): number {
    const sigma = (sensitivity * Math.sqrt(2 * Math.log(1.25 / delta))) / epsilon;
    const u1 = Math.random();
    const u2 = Math.random();
    return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  resetBudget(): void {
    this.config.remainingBudget = this.config.maxQueries;
  }

  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }
}

export function createDefaultDifferentialPrivacy(): DifferentialPrivacyService {
  return new DifferentialPrivacyService();
}
