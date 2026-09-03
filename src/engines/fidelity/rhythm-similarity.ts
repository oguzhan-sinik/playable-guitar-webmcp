import type { ChordEvent } from '../../domain/music/chord.js';
import type { ArrangementChordEvent } from '../../domain/arrangement/chord-event.js';

/**
 * Fraction of original chord onsets preserved at the same beat. Rhythm
 * simplification keeps chord boundaries, so a correct simplification of one
 * chord per bar retains the downbeat onsets.
 */
export function rhythmSimilarity(
  originalChords: ChordEvent[],
  arrangementChords: ArrangementChordEvent[],
): number {
  if (originalChords.length === 0) return 1;
  const onsets = new Set(arrangementChords.map((c) => c.startBeat));
  const kept = originalChords.filter((c) => onsets.has(c.startBeat)).length;
  return kept / originalChords.length;
}
