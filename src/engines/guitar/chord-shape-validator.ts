import type { GuitarChordShape } from '../../domain/guitar/chord-shape.js';
import { shapeToPositions } from '../../domain/guitar/chord-shape.js';
import { getPitchAtPosition } from '../../domain/guitar/fretboard.js';
import type { GuitarConfig } from '../../domain/guitar/tuning.js';
import { DEFAULT_GUITAR } from '../../domain/guitar/tuning.js';
import { midiToPitchClass, pitchClassToNumber, numberToPitchClass, type PitchClass } from '../../domain/music/pitch.js';

export interface ShapeValidationResult {
  valid: boolean;
  soundingPitches: Array<{ string: number; fret: number; midi: number; pitchClass: PitchClass }>;
  problems: string[];
}

/**
 * Check a shape against a guitar:
 * 1. every sounding string yields a valid pitch,
 * 2. all sounding pitch classes belong to the intended chord,
 * 3. required chord tones are present (fifth may be omitted on 7th chords),
 * 4. mute/open/fretted entries are structurally valid.
 */
export function validateChordShape(
  shape: GuitarChordShape,
  qualityIntervals: readonly number[],
  root: PitchClass,
  guitar: GuitarConfig = DEFAULT_GUITAR,
): ShapeValidationResult {
  const problems: string[] = [];
  const rootNum = pitchClassToNumber(root);
  const chordTones = new Set(qualityIntervals.map((i) => numberToPitchClass(rootNum + i)));

  const sounding = shapeToPositions(shape);
  const pitches: ShapeValidationResult['soundingPitches'] = [];

  for (const pos of sounding) {
    if (pos.fret < 0 || pos.fret > guitar.frets) {
      problems.push(`string ${pos.string}: fret ${pos.fret} out of range`);
      continue;
    }
    const midi = getPitchAtPosition(guitar, pos.string, pos.fret);
    const pc = midiToPitchClass(midi);
    pitches.push({ string: pos.string, fret: pos.fret, midi, pitchClass: pc });
    if (!chordTones.has(pc)) {
      problems.push(`string ${pos.string} sounds ${pc}, not a chord tone of ${root}`);
    }
  }

  const present = new Set(pitches.map((p) => p.pitchClass));
  const has = (interval: number) => present.has(numberToPitchClass(rootNum + interval));
  if (!has(0)) problems.push('root missing');
  // third (or sus tone) is structurally required
  const thirdInterval = qualityIntervals.find((i) => i === 3 || i === 4 || i === 2 || i === 5);
  if (thirdInterval !== undefined && !has(thirdInterval)) {
    problems.push('third/sus tone missing');
  }
  // fifth optional only for 7th chords
  const isSeventh = qualityIntervals.includes(10) || qualityIntervals.includes(11);
  if (qualityIntervals.includes(7)) {
    if (!has(7) && !isSeventh) problems.push('fifth missing');
  }

  return { valid: problems.length === 0, soundingPitches: pitches, problems };
}
