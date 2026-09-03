/**
 * Per-field confidence. Uncertainty is never hidden behind a single number —
 * overallUsabilityConfidence exists only for downstream readiness decisions.
 */
export interface ResearchConfidence {
  identity: number;
  key: number;
  tempo: number;
  meter: number;
  harmony: number;
  structure: number;
  overallUsability: number;
}

export const EMPTY_CONFIDENCE: ResearchConfidence = {
  identity: 0,
  key: 0,
  tempo: 0,
  meter: 0,
  harmony: 0,
  structure: 0,
  overallUsability: 0,
};

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * Noisy-or over independent source families: one strong source alone never
 * reaches 1.0, agreement multiplies toward certainty. Weights are per-source
 * priors, so branding alone caps what a single page can contribute.
 */
export function combineWeights(weights: number[]): number {
  const independent = 1 - weights.reduce((acc, w) => acc * (1 - Math.min(0.95, Math.max(0.05, w))), 1);
  return clamp01(independent);
}

/** Research schema versions, persisted for reproducibility. */
export const RESEARCH_SCHEMA_VERSION = 1;
export const RESOLVER_VERSION = 'research-resolver/1';
