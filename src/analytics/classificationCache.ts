/**
 * ChoreScore V3 — Classification Cache
 *
 * Caches taxonomy classifications to avoid redundant work.
 * The same normalized label + taxonomy version always produces
 * the same category. The cache prevents repeated matching for
 * identical labels across the pipeline.
 *
 * V3_BACKEND_FRUGAL.md §15: "Classifier une seule fois autant que possible."
 *
 * The cache key is: normalizedLabel + taxonomyVersion + classifierVersion.
 * Deterministic: same input → same output, no randomness.
 */

import { TaxonomyCategoryId, ClassificationCacheEntry } from './types';
import { TaskTaxonomyService } from './taxonomy';

/**
 * ClassificationCache — memoizes taxonomy mappings.
 *
 * Keyed by: normalizedLabel:taxonomyVersion:classifierVersion
 * Values: taxonomyCategoryId + confidence + timestamp
 */
export class ClassificationCache {
  private cache = new Map<string, ClassificationCacheEntry>();
  private taxonomyService: TaskTaxonomyService;

  constructor(taxonomyService?: TaskTaxonomyService) {
    this.taxonomyService = taxonomyService ?? new TaskTaxonomyService();
  }

  /**
   * Classify a label, returning cached result if available.
   * Returns { result, cacheHit }.
   */
  classify(
    label: string,
    classifierVersion: string = '1.0.0'
  ): { result: ClassificationCacheEntry; cacheHit: boolean } {
    const normalized = this.normalizeLabel(label);
    const taxVersion = this.taxonomyService.getVersion();
    const key = this.buildKey(normalized, taxVersion, classifierVersion);

    const cached = this.cache.get(key);
    if (cached) {
      return { result: cached, cacheHit: true };
    }

    // Classify and cache
    const categoryId = this.taxonomyService.mapLabel(label);
    const entry: ClassificationCacheEntry = {
      normalizedLabel: normalized,
      taxonomyVersion: taxVersion,
      taxonomyCategoryId: categoryId,
      classifierVersion,
      confidence: 1.0, // Deterministic rule-based classifier = full confidence
      processedAt: new Date().toISOString(),
    };

    this.cache.set(key, entry);
    return { result: entry, cacheHit: false };
  }

  /**
   * Classify a batch of labels, returning stats about cache usage.
   */
  classifyBatch(
    labels: string[],
    classifierVersion: string = '1.0.0'
  ): {
    results: ClassificationCacheEntry[];
    stats: { total: number; cacheHits: number; cacheMisses: number };
  } {
    const results: ClassificationCacheEntry[] = [];
    let cacheHits = 0;
    let cacheMisses = 0;

    for (const label of labels) {
      const { result, cacheHit } = this.classify(label, classifierVersion);
      results.push(result);
      if (cacheHit) cacheHits++;
      else cacheMisses++;
    }

    return {
      results,
      stats: { total: labels.length, cacheHits, cacheMisses },
    };
  }

  /**
   * Check if a label is already cached (without mutating).
   */
  has(label: string, classifierVersion: string = '1.0.0'): boolean {
    const normalized = this.normalizeLabel(label);
    const taxVersion = this.taxonomyService.getVersion();
    const key = this.buildKey(normalized, taxVersion, classifierVersion);
    return this.cache.has(key);
  }

  /**
   * Get cache size.
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get all cached entries (for audit/debug).
   */
  entries(): ClassificationCacheEntry[] {
    return Array.from(this.cache.values());
  }

  private normalizeLabel(label: string): string {
    return label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .replace(/\s+/g, '_');
  }

  private buildKey(normalized: string, taxonomyVersion: string, classifierVersion: string): string {
    return `${normalized}:${taxonomyVersion}:${classifierVersion}`;
  }
}

export function createClassificationCache(): ClassificationCache {
  return new ClassificationCache();
}
