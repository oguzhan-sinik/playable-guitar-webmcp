export interface FidelityWeights {
  harmony: number;
  melody: number;
  rhythm: number;
  motifCoverage: number;
  structure: number;
}

export interface FidelityConfig {
  /** Weights must sum to 1. Components that don't apply score 1 (no loss). */
  weights: FidelityWeights;
  /** Motifs with recognizabilityImportance >= this are "highly recognizable". */
  highRecognitionThreshold: number;
}

export const DEFAULT_FIDELITY_CONFIG: FidelityConfig = {
  weights: { harmony: 0.35, melody: 0.3, rhythm: 0.15, motifCoverage: 0.15, structure: 0.05 },
  highRecognitionThreshold: 0.7,
};
