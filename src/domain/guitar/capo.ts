import type { GuitarConfig } from './tuning.js';
import { AppError } from '../../errors/app-error.js';

/**
 * Capo is part of GuitarConfig and flows through all pitch math:
 * pitch = openStringPitch + capo + fret (fret relative to capo).
 * This module only owns capo validation/construction.
 */
export function withCapo(guitar: GuitarConfig, capo: number): GuitarConfig {
  if (!Number.isInteger(capo) || capo < 0 || capo > guitar.frets - 1) {
    throw new AppError(
      'DOMAIN_VALIDATION',
      `Capo ${capo} invalid for ${guitar.frets}-fret guitar`,
    );
  }
  return { ...guitar, capo };
}
