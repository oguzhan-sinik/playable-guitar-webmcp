import type { ArrangementChordEvent, ArrangementNoteEvent } from '../../domain/arrangement/index.js';
import { findShape, shapeToPositions } from '../../domain/guitar/chord-shape.js';
import {
  computeFingeringCost,
  DEFAULT_FINGERING_WEIGHTS,
} from '../../domain/guitar/fingering.js';
import { AppError } from '../../errors/app-error.js';
import { clamp10 } from './config.js';

/**
 * Mean physical movement between consecutive chord grips and melody positions.
 * Typical hard shift ≈ cost 6+; normalize /6 → 0-10.
 */
const MOVEMENT_NORMALIZER = 6;

export function computeHandMovement(
  chords: ArrangementChordEvent[],
  notes: ArrangementNoteEvent[],
): number {
  const costs: number[] = [];

  const chordShifts = chords
    .slice()
    .sort((a, b) => a.startBeat - b.startBeat)
    .map((ev) => {
      const shape = findShape(ev.shapeName);
      if (!shape) throw new AppError('DOMAIN_VALIDATION', `Unknown chord shape "${ev.shapeName}"`);
      // representative hand anchor: lowest fretted position of the grip
      const fretted = shapeToPositions(shape).filter((p) => p.fret > 0);
      return fretted.reduce((m, p) => (p.fret < m.fret ? p : m), { string: 0, fret: Infinity });
    })
    .filter((p) => p.string > 0);
  for (let i = 1; i < chordShifts.length; i++) {
    costs.push(computeFingeringCost(chordShifts[i - 1]!, chordShifts[i]!, DEFAULT_FINGERING_WEIGHTS).total);
  }

  for (let i = 1; i < notes.length; i++) {
    costs.push(computeFingeringCost(notes[i - 1]!.position, notes[i]!.position, DEFAULT_FINGERING_WEIGHTS).total);
  }

  if (costs.length === 0) return 0;
  return clamp10((costs.reduce((a, b) => a + b, 0) / costs.length / MOVEMENT_NORMALIZER) * 10);
}
