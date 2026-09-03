import { PITCH_CLASSES, type PitchClass } from './pitch.js';
import { CHORD_QUALITIES, type ChordQuality } from './chord.js';
import { AppError } from '../../errors/app-error.js';

/**
 * Single centralized enharmonic/spelling normalization layer. Provider output
 * (Essentia, future providers) may spell pitch classes with flats (Bb, Eb, ...)
 * or odd casing; domain APIs only accept the sharp-spelled PITCH_CLASSES.
 */
const FLAT_TO_SHARP: Record<string, string> = {
  Bb: 'A#',
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
};

/**
 * Normalize a pitch-class spelling to the sharp-spelled domain convention.
 * Accepts any case ("ab" -> "G#"), flats, and double accidentals are NOT
 * supported ("Fb" is not enharmonically folded into E; it is rejected).
 */
export function normalizePitchClass(input: string): PitchClass {
  const text = input.trim();
  const letter = text.charAt(0).toUpperCase();
  const canonical = `${letter}${text.slice(1)}`;
  const candidate = FLAT_TO_SHARP[canonical] ?? canonical;
  if ((PITCH_CLASSES as readonly string[]).includes(candidate)) {
    return candidate as PitchClass;
  }
  throw new AppError('DOMAIN_VALIDATION', `Cannot normalize pitch class: "${input}"`);
}

/** Sentinel label for regions where no confident chord could be determined. */
export const NO_CHORD = 'NO_CHORD';

const QUALITY_ALIASES: Record<string, ChordQuality> = {
  '': 'major',
  maj: 'major',
  M: 'major',
  min: 'minor',
  m: 'minor',
  '-': 'minor',
};

/**
 * Normalize a provider chord label into root + our quality vocabulary.
 * Returns null for NO_CHORD / unrecognizable labels so callers can represent
 * "no chord" explicitly instead of guessing.
 */
export function normalizeChordLabel(label: string): { root: PitchClass; quality: ChordQuality } | null {
  const text = label.trim();
  if (text === '' || text.toUpperCase() === NO_CHORD) return null;
  const match = /^([A-Ga-g][#b]?)(.*)$/.exec(text);
  if (!match) return null;
  let root: PitchClass;
  try {
    root = normalizePitchClass(match[1]!);
  } catch {
    return null;
  }
  // Only triads are supported in V0; anything richer degrades to the triad.
  // madmom-style colon labels ('C:maj', 'A:min') normalize via the same table.
  const qualityText = match[2]!.startsWith(':') ? match[2]!.slice(1) : match[2]!;
  const baseQuality = QUALITY_ALIASES[qualityText];
  if (baseQuality === undefined) return null;
  if ((CHORD_QUALITIES as readonly string[]).includes(baseQuality)) {
    return { root, quality: baseQuality };
  }
  return null;
}
