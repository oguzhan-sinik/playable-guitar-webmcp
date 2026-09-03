import type { GuitarTechnique } from '../../domain/arrangement/technique.js';

export interface DifficultyWeights {
  chord: number;
  fingering: number;
  movement: number;
  transitionSpeed: number;
  rhythm: number;
  noteDensity: number;
  technique: number;
  picking: number;
}

export interface DifficultyConfig {
  /** Component weights; must sum to 1 for total to stay 0-10. */
  weights: DifficultyWeights;
  /** Reference BPM for transition speed normalization. */
  refBpm: number;
  /** Technique costs on the 0-10 component scale. */
  techniqueCosts: Record<GuitarTechnique, number>;
}

export const DEFAULT_DIFFICULTY_CONFIG: DifficultyConfig = {
  weights: {
    chord: 0.25,
    fingering: 0.1,
    movement: 0.15,
    transitionSpeed: 0.15,
    rhythm: 0.1,
    noteDensity: 0.1,
    technique: 0.05,
    picking: 0.1,
  },
  refBpm: 120,
  techniqueCosts: {
    NORMAL: 0,
    HAMMER_ON: 1.5,
    PULL_OFF: 1.5,
    SLIDE: 3,
    BEND: 6,
    PALM_MUTE: 1,
    BARRE: 4,
    ARPEGGIO: 2,
  },
};

/** Clamp helper shared by all difficulty components. */
export function clamp10(x: number): number {
  return Math.max(0, Math.min(10, x));
}
