import type { SongGraph } from '../../domain/music/song-graph.js';

export interface EventMatchMetrics {
  precision: number;
  recall: number;
  f1: number;
  meanErrorMs: number;
  medianErrorMs: number;
}

/** Greedy nearest-neighbour matching within tolerance (standard MIR beat
 * evaluation simplification; deterministic). */
export function evaluateEvents(
  predicted: number[],
  reference: number[],
  toleranceSeconds = 0.07,
): EventMatchMetrics {
  if (reference.length === 0) {
    return { precision: 0, recall: 0, f1: 0, meanErrorMs: 0, medianErrorMs: 0 };
  }
  const used = new Set<number>();
  const errors: number[] = [];
  let hits = 0;
  for (const p of predicted) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < reference.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(reference[i]! - p);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestDist <= toleranceSeconds) {
      used.add(bestIdx);
      hits++;
      errors.push(bestDist * 1000);
    }
  }
  const precision = predicted.length > 0 ? hits / predicted.length : 0;
  const recall = hits / reference.length;
  const sortedErrors = [...errors].sort((a, b) => a - b);
  return {
    precision,
    recall,
    f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    meanErrorMs: errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0,
    medianErrorMs: sortedErrors.length > 0 ? sortedErrors[Math.floor(sortedErrors.length / 2)]! : 0,
  };
}

export interface MeterEvaluation {
  reference: string;
  predicted: string;
  /** CORRECT = same numerator; EQUIVALENT = musically equivalent grouping
   * (e.g. 3/4 vs 6/8-like grouping of 3); INCORRECT otherwise. */
  verdict: 'CORRECT' | 'EQUIVALENT' | 'INCORRECT';
}

/** Meter comparison: 6/8 and 3/4 both describe a grouping of 3 (+3); treat
 * them as equivalent but say so explicitly. */
export function evaluateMeter(inferred: SongGraph, reference: SongGraph): MeterEvaluation | null {
  const p = inferred.global.timeSignature;
  const r = reference.global.timeSignature;
  const label = (t: { numerator: number; denominator: number }): string => `${t.numerator}/${t.denominator}`;
  if (p.numerator === r.numerator && p.denominator === r.denominator) {
    return { reference: label(r), predicted: label(p), verdict: 'CORRECT' };
  }
  const groupingOf = (t: { numerator: number; denominator: number }): number =>
    t.numerator === 6 || t.numerator === 12 ? 3 : t.numerator;
  if (groupingOf(p) === groupingOf(r)) {
    return { reference: label(r), predicted: label(p), verdict: 'EQUIVALENT' };
  }
  return { reference: label(r), predicted: label(p), verdict: 'INCORRECT' };
}
