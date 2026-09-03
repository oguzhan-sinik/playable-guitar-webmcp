import { z } from 'zod';
import { PitchClassSchema, pitchClassToNumber, numberToPitchClass, type PitchClass } from './pitch.js';

export const CHORD_QUALITIES = [
  'major',
  'minor',
  'dominant7',
  'major7',
  'minor7',
  'sus2',
  'sus4',
  'diminished',
  'augmented',
  'power',
  'other',
] as const;
export type ChordQuality = (typeof CHORD_QUALITIES)[number];

export const ChordEventSchema = z.object({
  startBeat: z.number().min(0),
  durationBeats: z.number().positive(),
  root: PitchClassSchema,
  quality: z.enum(CHORD_QUALITIES),
  bass: PitchClassSchema.optional(),
  extensions: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
});
export type ChordEvent = z.infer<typeof ChordEventSchema>;

/** Interval structure from the root, in semitones. 'other' contributes only the root. */
const QUALITY_INTERVALS: Record<Exclude<ChordQuality, 'other'>, readonly number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  diminished: [0, 3, 6],
  augmented: [0, 4, 8],
  power: [0, 7],
};

export function getChordPitchClasses(chord: ChordEvent): PitchClass[] {
  const intervals = chord.quality === 'other' ? [0] : QUALITY_INTERVALS[chord.quality];
  const pcs = intervals.map((i) => numberToPitchClass(pitchClassToNumber(chord.root) + i));
  if (chord.bass && !pcs.includes(chord.bass)) {
    pcs.push(chord.bass);
  }
  return pcs;
}

export function transposeChord(chord: ChordEvent, semitones: number): ChordEvent {
  const shift = (pc: PitchClass) => numberToPitchClass(pitchClassToNumber(pc) + semitones);
  return {
    ...chord,
    root: shift(chord.root),
    ...(chord.bass !== undefined && { bass: shift(chord.bass) }),
  };
}
