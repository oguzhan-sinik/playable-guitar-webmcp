import type { NoteEvent } from '../../domain/music/note.js';
import type { ArrangementNoteEvent } from '../../domain/arrangement/note-event.js';

export function effectiveSalience(note: NoteEvent, motifIdsOf: (id: string) => string[]): number {
  if (note.salience !== undefined) return note.salience;
  let s = 0.3;
  if (Number.isInteger(note.startBeat) && note.startBeat % 4 === 0) s += 0.25; // downbeat
  s += Math.min(0.2, note.durationBeats * 0.1);
  if (motifIdsOf(note.id).length > 0) s += 0.25;
  return Math.min(1, s);
}

/**
 * Retained weighted salience: sum of salience over arrangement notes (mapped
 * back to source ids) divided by total original salience.
 */
export function melodySimilarity(
  originalNotes: NoteEvent[],
  arrangementNotes: ArrangementNoteEvent[],
  motifIdsOf: (id: string) => string[],
): number {
  if (originalNotes.length === 0) return 1;
  const total = originalNotes.reduce((a, n) => a + effectiveSalience(n, motifIdsOf), 0);
  if (total === 0) return arrangementNotes.length > 0 ? 1 : 0;
  const retained = arrangementNotes.reduce((a, n) => {
    if (n.sourceNoteId === undefined) return a;
    const src = originalNotes.find((o) => o.id === n.sourceNoteId);
    return a + (src ? effectiveSalience(src, motifIdsOf) : 0);
  }, 0);
  return retained / total;
}
