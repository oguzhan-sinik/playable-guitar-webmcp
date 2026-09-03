import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import type { ArrangementTransformation, TransformationContext, TransformationResult } from './transformation.js';
import { cloneArrangement, measureCandidate, transformationOf } from './measurement.js';

const TEMPO_FACTORS = [0.9, 0.8, 0.7, 0.6, 0.5];

/**
 * Symbolic content untouched; only performance tempo drops. Fidelity is
 * unchanged by construction (fidelity compares symbolic content).
 */
export class TempoReduction implements ArrangementTransformation {
  name = 'TEMPO_REDUCTION' as const;

  apply(arrangement: GuitarArrangement, context: TransformationContext): TransformationResult[] {
    const results: TransformationResult[] = [];
    for (const factor of TEMPO_FACTORS) {
      if (factor >= arrangement.tempoFactor) continue;
      const candidate = cloneArrangement(arrangement);
      candidate.tempoFactor = factor;
      const measured = measureCandidate(
        candidate,
        arrangement,
        transformationOf(
          this.name,
          `Reduced practice tempo factor to ${factor}`,
          [],
          { factor },
        ),
        context,
      );
      if (measured) results.push(measured);
    }
    return results;
  }
}
