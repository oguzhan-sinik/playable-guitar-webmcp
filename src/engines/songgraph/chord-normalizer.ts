import type { RawChordObservation } from '../../domain/analysis/raw-music-analysis.js';
import { normalizeChordLabel, NO_CHORD } from '../../domain/music/normalize.js';
import type { PitchClass } from '../../domain/music/pitch.js';
import type { ChordQuality } from '../../domain/music/chord.js';

export interface NormalizedChordObservation {
  startSeconds: number;
  endSeconds: number;
  /** null = NO_CHORD (unknown, silence, or below confidence threshold). */
  chord: { root: PitchClass; quality: ChordQuality } | null;
  confidence: number;
  /** Raw provider label, kept for traceability/debugging. */
  rawLabel: string;
}

/**
 * Normalize provider labels into our vocabulary. Observations below threshold
 * become explicit NO_CHORD — we never convert weak evidence into a guess.
 */
export function normalizeChordObservations(
  raw: RawChordObservation[],
  config: { minimumChordConfidence: number },
): NormalizedChordObservation[] {
  return raw.map((o) => {
    const base = { startSeconds: o.startSeconds, endSeconds: o.endSeconds, confidence: o.confidence, rawLabel: o.label };
    if (o.label.toUpperCase() === NO_CHORD) {
      return { ...base, chord: null };
    }
    const parsed = normalizeChordLabel(o.label);
    if (parsed === null || o.confidence < config.minimumChordConfidence) {
      return { ...base, chord: null, confidence: parsed === null ? 0 : o.confidence };
    }
    return { ...base, chord: parsed };
  });
}
