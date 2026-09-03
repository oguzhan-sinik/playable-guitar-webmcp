import { z } from 'zod';

export const PITCH_CLASSES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

export type PitchClass = (typeof PITCH_CLASSES)[number];

/** C = 0, C# = 1, ... B = 11. */
export function pitchClassToNumber(pc: PitchClass): number {
  return PITCH_CLASSES.indexOf(pc);
}

export function numberToPitchClass(n: number): PitchClass {
  return PITCH_CLASSES[((n % 12) + 12) % 12]!;
}

export function isValidMidi(midi: number): boolean {
  return Number.isInteger(midi) && midi >= 0 && midi <= 127;
}

/** MIDI 60 -> "C", 61 -> "C#". */
export function midiToPitchClass(midi: number): PitchClass {
  assertMidi(midi);
  return numberToPitchClass(midi);
}

/** MIDI 60 -> "C4", 69 -> "A4". Scientific pitch notation. */
export function midiToPitchName(midi: number): string {
  assertMidi(midi);
  return `${midiToPitchClass(midi)}${Math.floor(midi / 12) - 1}`;
}

export function transposeMidi(midi: number, semitones: number): number {
  assertMidi(midi);
  const out = midi + semitones;
  if (!isValidMidi(out)) {
    throw new Error(`Transposed MIDI ${out} out of range 0-127`);
  }
  return out;
}

export function transposePitchClass(pc: PitchClass, semitones: number): PitchClass {
  return numberToPitchClass(pitchClassToNumber(pc) + semitones);
}

/** MIDI number for a pitch class in a specific octave (C4 = 60). */
export function pitchToMidi(pc: PitchClass, octave: number): number {
  return (octave + 1) * 12 + pitchClassToNumber(pc);
}

function assertMidi(midi: number): void {
  if (!isValidMidi(midi)) {
    throw new Error(`MIDI ${midi} out of range 0-127`);
  }
}

export const MidiSchema = z
  .number()
  .int()
  .min(0)
  .max(127);

export const PitchClassSchema = z.enum(PITCH_CLASSES);
