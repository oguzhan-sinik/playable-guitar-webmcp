/**
 * Fingering cost primitives. Deterministic; weights come from config, never
 * duplicated inline.
 */
export interface FingeringWeights {
  fretMovement: number;
  stringMovement: number;
  positionShift: number;
}

export const DEFAULT_FINGERING_WEIGHTS: FingeringWeights = {
  fretMovement: 1,
  stringMovement: 0.5,
  positionShift: 2,
};

export interface FingeringCost {
  fretMovement: number;
  stringMovement: number;
  /** 1 when hand position (fret) changes, 0 otherwise. */
  positionShift: number;
  total: number;
}

export function computeFingeringCost(
  from: { string: number; fret: number },
  to: { string: number; fret: number },
  weights: FingeringWeights = DEFAULT_FINGERING_WEIGHTS,
): FingeringCost {
  const fretMovement = Math.abs(to.fret - from.fret);
  const stringMovement = Math.abs(to.string - from.string);
  const positionShift = fretMovement === 0 ? 0 : 1;
  return {
    fretMovement,
    stringMovement,
    positionShift,
    total:
      fretMovement * weights.fretMovement +
      stringMovement * weights.stringMovement +
      positionShift * weights.positionShift,
  };
}
