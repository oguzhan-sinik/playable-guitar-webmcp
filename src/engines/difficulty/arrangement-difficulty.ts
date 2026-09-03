import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import type { DifficultyScore } from '../../domain/arrangement/difficulty.js';
import type { SongGraph } from '../../domain/music/song-graph.js';
import { computeChordComplexity } from './chord-complexity.js';
import { computeFingeringComplexity } from './fingering-complexity.js';
import { computeHandMovement } from './movement-complexity.js';
import { computeTransitionSpeed } from './transition-speed.js';
import { computeRhythmComplexity, extractRhythmFeatures } from './rhythm-complexity.js';
import { computeNoteDensity, computePickingComplexity } from './note-density.js';
import { computeTechniqueComplexity } from './technique-complexity.js';
import { DEFAULT_DIFFICULTY_CONFIG, type DifficultyConfig } from './config.js';

export interface DifficultyInput {
  arrangement: GuitarArrangement;
  /** Source graph supplies bpm and time signature. */
  song: Pick<SongGraph, 'global'>;
  config?: DifficultyConfig;
}

/**
 * Deterministic difficulty V1. Total = weighted sum of 0-10 components.
 * Ordering is the contract; absolute values are approximate.
 */
export function computeDifficulty({ arrangement, song, config = DEFAULT_DIFFICULTY_CONFIG }: DifficultyInput): DifficultyScore {
  const { chords, notes, techniques, tuning, tempoFactor, durationBeats } = arrangement;
  const rhythm = extractRhythmFeatures(chords, notes, song.global.timeSignature.numerator);

  const chordComplexity = computeChordComplexity(chords, tuning, config);
  const fingeringComplexity = computeFingeringComplexity(chords);
  const handMovement = computeHandMovement(chords, notes);
  const transitionSpeed = computeTransitionSpeed(
    chords, notes, song.global.bpm, tempoFactor, config,
  );
  const rhythmComplexity = computeRhythmComplexity(rhythm);
  const noteDensity = computeNoteDensity(chords, notes, durationBeats);
  const techniqueComplexity = computeTechniqueComplexity(techniques, config);
  const pickingComplexity = computePickingComplexity(notes, durationBeats);

  const w = config.weights;
  const total =
    chordComplexity * w.chord +
    fingeringComplexity * w.fingering +
    handMovement * w.movement +
    transitionSpeed * w.transitionSpeed +
    rhythmComplexity * w.rhythm +
    noteDensity * w.noteDensity +
    techniqueComplexity * w.technique +
    pickingComplexity * w.picking;

  return {
    total: round2(total),
    chordComplexity: round2(chordComplexity),
    fingeringComplexity: round2(fingeringComplexity),
    handMovement: round2(handMovement),
    transitionSpeed: round2(transitionSpeed),
    rhythmComplexity: round2(rhythmComplexity),
    noteDensity: round2(noteDensity),
    techniqueComplexity: round2(techniqueComplexity),
    pickingComplexity: round2(pickingComplexity),
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
