import { z } from 'zod';
import { isValidMidi } from '../music/pitch.js';

/**
 * String convention used across the whole codebase:
 *
 *   tuning[0] = string 1 = high E
 *   tuning[5] = string 6 = low E
 *
 * Standard tuning string 1 -> string 6 = E4 B3 G3 D3 A2 E2 = MIDI [64,59,55,50,45,40].
 * Never store low-to-high; all code assumes this single convention.
 */
export const STANDARD_TUNING = [64, 59, 55, 50, 45, 40] as const;

export const STRING_LABELS = ['e', 'B', 'G', 'D', 'A', 'E'] as const;

export const GuitarConfigSchema = z.object({
  /** Open string MIDI pitches, string 1 (high E) first — see STANDARD_TUNING. */
  tuning: z
    .tuple([z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int(), z.number().int()])
    .readonly(),
  /** Total physical frets on the instrument. */
  frets: z.number().int().positive(),
  /** Capo fret position: 0 = no capo. */
  capo: z.number().int().min(0),
});
export type GuitarConfig = z.infer<typeof GuitarConfigSchema>;

export const DEFAULT_GUITAR: GuitarConfig = {
  tuning: STANDARD_TUNING,
  frets: 24,
  capo: 0,
};

export function defaultGuitar(capo = 0): GuitarConfig {
  return { ...DEFAULT_GUITAR, capo };
}

export function isValidTuning(tuning: readonly number[]): boolean {
  return tuning.length === 6 && tuning.every((m) => isValidMidi(m));
}

/** Human label for a 1-based string number: 1 = "e" (high), 6 = "E" (low). */
export function stringLabel(stringNumber: number): string {
  return STRING_LABELS[stringNumber - 1] ?? '?';
}
