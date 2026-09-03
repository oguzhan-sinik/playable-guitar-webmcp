import type { ArrangementChordEvent, ArrangementNoteEvent } from '../../domain/arrangement/index.js';
import { clamp10 } from './config.js';

export interface RhythmFeatures {
  eventCount: number;
  /** Events starting off the eighth grid (1 e & a → the "e"/"a" positions). */
  sixteenthFraction: number;
  /** Events starting on off-beats ("&" positions). */
  offBeatFraction: number;
  /** Events NOT starting on a bar downbeat. */
  nonDownbeatFraction: number;
}

export function extractRhythmFeatures(
  chords: ArrangementChordEvent[],
  notes: ArrangementNoteEvent[],
  beatsPerBar: number,
): RhythmFeatures {
  const onsets = [
    ...chords.map((c) => c.startBeat),
    ...notes.map((n) => n.startBeat),
  ];
  if (onsets.length === 0) {
    return { eventCount: 0, sixteenthFraction: 0, offBeatFraction: 0, nonDownbeatFraction: 0 };
  }
  const trueSixteenths = onsets.filter((b) => {
    const q = b * 4;
    return Math.abs(q - Math.round(q)) < 1e-9 && Math.abs(q % 2) > 1e-9;
  }).length;
  const offBeats = onsets.filter((b) => Math.abs(b - Math.round(b)) > 1e-9).length;
  const nonDownbeats = onsets.filter((b) => Math.abs(b % beatsPerBar) > 1e-9).length;
  return {
    eventCount: onsets.length,
    sixteenthFraction: trueSixteenths / onsets.length,
    offBeatFraction: offBeats / onsets.length,
    nonDownbeatFraction: nonDownbeats / onsets.length,
  };
}

/** Weighted mix of the three syncopation/subdivision features. */
export function computeRhythmComplexity(f: RhythmFeatures): number {
  if (f.eventCount === 0) return 0;
  return clamp10(
    10 * (0.4 * f.sixteenthFraction + 0.3 * f.offBeatFraction + 0.3 * f.nonDownbeatFraction),
  );
}
