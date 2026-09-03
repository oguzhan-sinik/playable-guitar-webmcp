import type { GuitarChordShape } from '../../domain/guitar/chord-shape.js';
import { shapeToPositions } from '../../domain/guitar/chord-shape.js';

export interface DifficultyWeights {
  frettedString: number;
  finger: number;
  barre: number;
  fretSpan: number;
}

export const DEFAULT_DIFFICULTY_WEIGHTS: DifficultyWeights = {
  frettedString: 1,
  finger: 1,
  barre: 3,
  fretSpan: 0.5,
};

/**
 * Deterministic relative difficulty. Fingers ≈ fretted strings (barre counts
 * as one finger for its strings). Not a calibrated 0–10 score; ordering only.
 */
export function calculateChordDifficulty(
  shape: GuitarChordShape,
  weights: DifficultyWeights = DEFAULT_DIFFICULTY_WEIGHTS,
): number {
  const sounding = shapeToPositions(shape);
  const fretted = sounding.filter((p) => p.fret > 0);
  const barreStrings = shape.barre
    ? fretted.filter(
        (p) =>
          p.fret === shape.barre!.fret &&
          p.string >= Math.min(shape.barre!.fromString, shape.barre!.toString) &&
          p.string <= Math.max(shape.barre!.fromString, shape.barre!.toString),
      ).length
    : 0;
  const nonBarre = fretted.length - barreStrings;
  const fingers = nonBarre + (shape.barre ? 1 : 0);
  const fretValues = fretted.map((p) => p.fret);
  const span =
    fretValues.length > 0 ? Math.max(...fretValues) - Math.min(...fretValues) : 0;
  return (
    fretted.length * weights.frettedString +
    fingers * weights.finger +
    (shape.barre ? weights.barre : 0) +
    span * weights.fretSpan
  );
}

export interface TransitionCostBreakdown {
  fingersMoved: number;
  averageFretMovement: number;
  barreChange: number;
  handShift: number;
  total: number;
}

const TRANSITION_WEIGHTS = {
  finger: 1,
  fretMovement: 0.5,
  barreChange: 2,
  handShift: 1.5,
} as const;

/**
 * Deterministic approximation: strings whose fretting status changes must be
 * re-fingered; barre appearing/disappearing costs extra; hand shift is the
 * fret delta of the fretted group centroid.
 */
export function calculateChordTransitionCost(
  from: GuitarChordShape,
  to: GuitarChordShape,
): TransitionCostBreakdown {
  const a = shapeToPositions(from);
  const b = shapeToPositions(to);

  const aByString = new Map(a.map((p) => [p.string, p.fret]));
  const bByString = new Map(b.map((p) => [p.string, p.fret]));

  let moved = 0;
  let fretMovementSum = 0;
  const strings = new Set([...aByString.keys(), ...bByString.keys()]);
  for (const s of strings) {
    const fa = aByString.get(s);
    const fb = bByString.get(s);
    if (fa !== fb) {
      moved++;
      fretMovementSum += fa !== undefined && fb !== undefined ? Math.abs(fb - fa) : 1;
    }
  }

  const centroid = (positions: Array<{ fret: number }>) =>
    positions.filter((p) => p.fret > 0).length > 0
      ? positions.filter((p) => p.fret > 0).reduce((sum, p) => sum + p.fret, 0) /
        positions.filter((p) => p.fret > 0).length
      : 0;

  const barreChange =
    (from.barre ? 1 : 0) !== (to.barre ? 1 : 0) ? 1 : 0;
  const handShift = Math.round(Math.abs(centroid(b) - centroid(a)) * 10) / 10;

  const total =
    moved * TRANSITION_WEIGHTS.finger +
    (moved > 0 ? (fretMovementSum / moved) * TRANSITION_WEIGHTS.fretMovement : 0) +
    barreChange * TRANSITION_WEIGHTS.barreChange +
    handShift * TRANSITION_WEIGHTS.handShift;

  return {
    fingersMoved: moved,
    averageFretMovement: moved > 0 ? Math.round((fretMovementSum / moved) * 100) / 100 : 0,
    barreChange,
    handShift,
    total,
  };
}
