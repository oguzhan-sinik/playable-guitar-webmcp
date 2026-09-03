import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import type { AppliedTransformation, TransformationType } from '../../domain/arrangement/transformation.js';
import type { ArrangementValidation } from '../arrangement/validate-arrangement.js';
import type { DifficultyScore } from '../../domain/arrangement/difficulty.js';
import type { FidelityScore } from '../../domain/arrangement/fidelity.js';
import type { SongGraph } from '../../domain/music/song-graph.js';

export interface TransformationContext {
  /** Source SongGraph — needed for difficulty tempo and fidelity comparison. */
  song: SongGraph;
}

export interface TransformationResult {
  arrangement: GuitarArrangement;
  transformation: AppliedTransformation;
  validation: ArrangementValidation;
  difficultyBefore: DifficultyScore;
  difficultyAfter: DifficultyScore;
  fidelityBefore: FidelityScore;
  fidelityAfter: FidelityScore;
}

export interface ArrangementTransformation {
  name: TransformationType;
  /**
   * Pure: must not mutate `arrangement`. Returns zero or more candidates;
   * only candidates that measure as improvements are worth returning.
   */
  apply(arrangement: GuitarArrangement, context: TransformationContext): TransformationResult[];
}
