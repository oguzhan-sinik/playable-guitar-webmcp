import { z } from 'zod';
import type { GuitarConfig } from './tuning.js';
import { AppError } from '../../errors/app-error.js';

export const GuitarPositionSchema = z.object({
  /** 1-based string number; 1 = high E, 6 = low E. */
  string: z.number().int().min(1).max(6),
  /**
   * Fret relative to the capo: 0 = play open above the capo.
   * Absolute fret on the instrument = fret + capo.
   */
  fret: z.number().int().min(0),
  midi: z.number().int().min(0).max(127),
});
export type GuitarPosition = z.infer<typeof GuitarPositionSchema>;

/** Structural validation only (no pitch check). Use fretboard.isValidPosition for pitch too. */
export function isValidPositionShape(guitar: GuitarConfig, pos: GuitarPosition): boolean {
  return (
    Number.isInteger(pos.string) &&
    pos.string >= 1 &&
    pos.string <= 6 &&
    Number.isInteger(pos.fret) &&
    pos.fret >= 0 &&
    pos.fret + guitar.capo <= guitar.frets
  );
}

export class UnplayableNoteError extends AppError {
  constructor(midi: number, detail: string) {
    super('UNPLAYABLE_NOTE', `MIDI ${midi} cannot be played: ${detail}`);
    this.name = 'UnplayableNoteError';
  }
}
