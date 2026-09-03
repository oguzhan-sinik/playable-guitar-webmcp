import type { GuitarConfig } from './tuning.js';
import type { GuitarPosition } from './guitar-position.js';
import { isValidPositionShape } from './guitar-position.js';

/**
 * Pitch at a position.
 *
 * Invariant: pitch = openStringPitch + capo + fret,
 * where fret is relative to the capo (fret 0 = open above the capo).
 */
export function getPitchAtPosition(
  guitar: GuitarConfig,
  string: number,
  fret: number,
): number {
  if (!Number.isInteger(string) || string < 1 || string > 6) {
    throw new RangeError(`Invalid string ${string}; must be 1-6`);
  }
  if (!Number.isInteger(fret) || fret < 0) {
    throw new RangeError(`Invalid fret ${fret}; must be >= 0`);
  }
  const absoluteFret = fret + guitar.capo;
  if (absoluteFret > guitar.frets) {
    throw new RangeError(`Fret ${fret} + capo ${guitar.capo} exceeds ${guitar.frets} frets`);
  }
  const open = guitar.tuning[string - 1];
  if (open === undefined) {
    throw new RangeError(`No tuning entry for string ${string}`);
  }
  return open + fret + guitar.capo;
}

/** Full validation: structure and pitch consistency. */
export function isValidPosition(guitar: GuitarConfig, pos: GuitarPosition): boolean {
  if (!isValidPositionShape(guitar, pos)) return false;
  return getPitchAtPosition(guitar, pos.string, pos.fret) === pos.midi;
}

/**
 * Every physical place a MIDI note can be played. Deterministic order:
 * lowest fret first, then lowest string number. Does NOT pick an "optimal" spot.
 */
export function getPositionsForMidi(
  guitar: GuitarConfig,
  midi: number,
): GuitarPosition[] {
  const positions: GuitarPosition[] = [];
  for (let string = 1; string <= 6; string++) {
    const fret = midi - (guitar.tuning[string - 1] as number) - guitar.capo;
    if (fret >= 0 && fret + guitar.capo <= guitar.frets) {
      positions.push({ string, fret, midi });
    }
  }
  return positions.sort((a, b) => a.fret - b.fret || a.string - b.string);
}
