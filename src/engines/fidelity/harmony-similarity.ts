import type { ChordEvent } from '../../domain/music/chord.js';
import { getChordPitchClasses } from '../../domain/music/chord.js';
import type { ArrangementChordEvent } from '../../domain/arrangement/chord-event.js';

/**
 * Jaccard similarity of pitch-class sets between an original chord and the
 * arrangement chord sounding at the same time. Cmaj7→C = 0.75; C→F# = 0.
 */
export function chordSimilarity(original: ChordEvent, played: ChordEvent): number {
  const a = new Set(getChordPitchClasses(original));
  const b = new Set(getChordPitchClasses(played));
  let inter = 0;
  for (const pc of a) if (b.has(pc)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** Mean similarity between each original chord and the arrangement's sounding chord at that time. */
export function harmonySimilarity(
  originalChords: ChordEvent[],
  arrangementChords: ArrangementChordEvent[],
): number {
  if (originalChords.length === 0) return 1;
  const sorted = arrangementChords.slice().sort((x, y) => x.startBeat - y.startBeat);
  const scores = originalChords.map((orig) => {
    const mid = orig.startBeat + orig.durationBeats / 2;
    const played = sorted.find((c) => mid >= c.startBeat && mid < c.startBeat + c.durationBeats);
    if (!played) return 0;
    return chordSimilarity(orig, played.chord);
  });
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}
