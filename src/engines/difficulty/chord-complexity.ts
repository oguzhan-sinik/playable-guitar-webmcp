import type { ArrangementChordEvent } from '../../domain/arrangement/chord-event.js';
import type { GuitarConfig } from '../../domain/guitar/tuning.js';
import { findShape } from '../../domain/guitar/chord-shape.js';
import { calculateChordDifficulty } from '../guitar/chord-difficulty.js';
import { AppError } from '../../errors/app-error.js';
import { clamp10, type DifficultyConfig } from './config.js';

/** A shape at fret 6 with a full barre ≈ 16 raw points; normalize /1.6 → 10. */
const SHAPE_DIFFICULTY_NORMALIZER = 1.6;

/** Mean normalized shape difficulty across chord events (0-10). */
export function computeChordComplexity(
  chords: ArrangementChordEvent[],
  _guitar: GuitarConfig,
  _config: DifficultyConfig,
): number {
  if (chords.length === 0) return 0;
  const sum = chords.reduce((acc, ev) => {
    const shape = findShape(ev.shapeName);
    if (!shape) {
      throw new AppError('DOMAIN_VALIDATION', `Unknown chord shape "${ev.shapeName}"`);
    }
    return acc + clamp10(calculateChordDifficulty(shape) / SHAPE_DIFFICULTY_NORMALIZER);
  }, 0);
  return sum / chords.length;
}
