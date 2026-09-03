import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import type { AppliedTransformation, TransformationType } from '../../domain/arrangement/transformation.js';
import { GuitarArrangementSchema } from '../../domain/arrangement/arrangement.js';
import { validateArrangement } from '../arrangement/validate-arrangement.js';
import { computeDifficulty } from '../difficulty/arrangement-difficulty.js';
import { computeFidelity } from '../fidelity/arrangement-fidelity.js';
import type { TransformationContext, TransformationResult } from './transformation.js';
import { newArrangementId } from '../../utils/ids.js';

/**
 * Clone an arrangement deeply. All operators work clone→modify→measure;
 * the input object is never mutated.
 */
export function cloneArrangement(arr: GuitarArrangement): GuitarArrangement {
  return structuredClone(arr);
}

/** Measure a candidate, score it, and reject it unless strictly easier. */
export function measureCandidate(
  candidate: GuitarArrangement,
  original: GuitarArrangement,
  transformation: Omit<AppliedTransformation, 'difficultyBefore' | 'difficultyAfter' | 'fidelityBefore' | 'fidelityAfter'>,
  context: TransformationContext,
): TransformationResult | null {
  const validation = validateArrangement(candidate);
  if (!validation.valid) return null;

  const difficultyBefore = computeDifficulty({ arrangement: original, song: context.song });
  const difficultyAfter = computeDifficulty({ arrangement: candidate, song: context.song });
  const fidelityBefore = computeFidelity({ arrangement: original, original: context.song });
  const fidelityAfter = computeFidelity({ arrangement: candidate, original: context.song });

  // Simplification rule: must not get harder. (Zero-loss operators like
  // fingering optimization also pass with equality.)
  if (difficultyAfter.total > difficultyBefore.total) return null;

  candidate.id = newArrangementId(); // candidates are distinct arrangements

  const full: AppliedTransformation = {
    ...transformation,
    difficultyBefore: difficultyBefore.total,
    difficultyAfter: difficultyAfter.total,
    fidelityBefore: fidelityBefore.total,
    fidelityAfter: fidelityAfter.total,
  };
  candidate.transformations = [...candidate.transformations, full];
  candidate.difficulty = difficultyAfter;
  candidate.fidelity = fidelityAfter;

  return {
    arrangement: GuitarArrangementSchema.parse(candidate) as GuitarArrangement,
    transformation: full,
    validation,
    difficultyBefore,
    difficultyAfter,
    fidelityBefore,
    fidelityAfter,
  };
}

export const transformationOf = (type: TransformationType, description: string, affectedEventIds: string[], parameters?: Record<string, unknown>) => ({
  type,
  description,
  affectedEventIds,
  ...(parameters !== undefined && { parameters }),
});
