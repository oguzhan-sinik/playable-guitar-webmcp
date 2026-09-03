export * from './transformation.js';
export * from './measurement.js';
export * from './tempo-reduction.js';
export * from './fingering-optimization.js';
export * from './capo-optimization.js';
export * from './chord-simplification.js';
export * from './rhythm-simplification.js';
export * from './melody-reduction.js';

import type { ArrangementTransformation, TransformationContext, TransformationResult } from './transformation.js';
import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import { TempoReduction } from './tempo-reduction.js';
import { FingeringOptimization } from './fingering-optimization.js';
import { CapoOptimization } from './capo-optimization.js';
import { ChordSimplification } from './chord-simplification.js';
import { RhythmSimplification } from './rhythm-simplification.js';
import { MelodyReduction } from './melody-reduction.js';

export type OperatorKey = 'tempo' | 'capo' | 'chords' | 'rhythm' | 'melody' | 'fingering';

/** All operators, keyed as the CLI's --operator option names them. */
export function allOperators(): Record<OperatorKey, ArrangementTransformation> {
  return {
    tempo: new TempoReduction(),
    fingering: new FingeringOptimization(),
    capo: new CapoOptimization(),
    chords: new ChordSimplification(),
    rhythm: new RhythmSimplification(),
    melody: new MelodyReduction(),
  };
}

/**
 * Candidate generation for simplify: every operator applied to the base
 * arrangement, then fidelity-costing operators (melody, rhythm) also chained
 * onto the best zero-loss candidate so the frontier shows real trade-offs.
 */
export function generateCandidates(
  base: GuitarArrangement,
  context: TransformationContext,
  keys?: OperatorKey[],
): GuitarArrangement[] {
  const operators = allOperators();
  const active: OperatorKey[] = keys ?? (Object.keys(operators) as OperatorKey[]);

  const results: TransformationResult[] = [];
  for (const key of active) {
    results.push(...operators[key].apply(base, context));
  }

  const zeroLoss = results
    .filter((r) => r.fidelityAfter.total >= 0.999)
    .sort((a, b) => a.difficultyAfter.total - b.difficultyAfter.total)[0];
  if (zeroLoss) {
    for (const key of (['melody', 'rhythm'] as const).filter((k) => active.includes(k))) {
      results.push(...operators[key].apply(zeroLoss.arrangement, context));
    }
  }

  return results.map((r) => r.arrangement);
}
