import type { ArrangementChordEvent, ArrangementNoteEvent } from '../../domain/arrangement/index.js';
import { clamp10 } from './config.js';

/** Notes+chord onsets per beat; 4/beat (16ths at quarter grid) ≈ full score. */
export function computeNoteDensity(
  chords: ArrangementChordEvent[],
  notes: ArrangementNoteEvent[],
  durationBeats: number,
): number {
  if (durationBeats <= 0) return 0;
  const perBeat = (chords.length + notes.length) / durationBeats;
  return clamp10(perBeat * 2.5);
}

/** Melody-only picking load: melody notes per beat. */
export function computePickingComplexity(
  notes: ArrangementNoteEvent[],
  durationBeats: number,
): number {
  if (notes.length === 0 || durationBeats <= 0) return 0;
  return clamp10((notes.length / durationBeats) * 4);
}
