import type { RawMusicAnalysis } from '../../domain/analysis/raw-music-analysis.js';

export interface AggregatedConfidence {
  rhythm: number;
  key: number;
  chord: number;
  overall: number;
}

/**
 * Heuristic confidence aggregation. NOT statistically calibrated — a weighted
 * mean of the per-stage confidences so downstream code and humans get one
 * honest number to sort by. Documented as a heuristic, not a probability.
 */
export function aggregateConfidence(
  analysis: RawMusicAnalysis,
  weights: { rhythm: number; key: number; chord: number },
  averageChordConfidence: number,
): AggregatedConfidence {
  const rhythm = analysis.rhythm.confidence ?? 0;
  const key = analysis.tonal.key?.confidence ?? 0;
  const chord = averageChordConfidence;
  return {
    rhythm,
    key,
    chord,
    overall: Math.min(1, Math.max(0, weights.rhythm * rhythm + weights.key * key + weights.chord * chord)),
  };
}

/** Duration-weighted mean confidence over raw chord observations. */
export function averageChordConfidence(analysis: RawMusicAnalysis): number {
  let weighted = 0;
  let total = 0;
  for (const o of analysis.tonal.chords) {
    const d = Math.max(o.endSeconds - o.startSeconds, 0);
    weighted += o.confidence * d;
    total += d;
  }
  return total > 0 ? weighted / total : 0;
}
