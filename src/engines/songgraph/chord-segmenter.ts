import type { ChordEvent } from '../../domain/music/chord.js';
import type { NormalizedChordObservation } from './chord-normalizer.js';
import { timeRangeToBeatRange } from './beat-normalizer.js';
import type { BeatEvent } from '../../domain/music/beat.js';
import type { AnalysisWarning } from '../../domain/analysis/raw-music-analysis.js';

/**
 * Deterministic temporal smoothing: a single-observation chord surrounded by
 * the same chord on both sides is replaced by that surrounding chord when its
 * confidence is lower (one-beat glitch, e.g. G G Bm G). Conservative by design
 * — only length-1 runs, only lower confidence, and every change is reported.
 */
export function smoothSingleBeatGlitches(
  observations: NormalizedChordObservation[],
): { observations: NormalizedChordObservation[]; warnings: AnalysisWarning[] } {
  const warnings: AnalysisWarning[] = [];
  const key = (o: NormalizedChordObservation) => (o.chord === null ? 'NO_CHORD' : `${o.chord.root} ${o.chord.quality}`);
  const out = [...observations];
  let changed = 0;
  for (let i = 1; i < out.length - 1; i++) {
    const prev = out[i - 1]!;
    const cur = out[i]!;
    const next = out[i + 1]!;
    if (key(prev) === key(next) && key(cur) !== key(prev) && cur.confidence < Math.min(prev.confidence, next.confidence)) {
      out[i] = { ...cur, chord: prev.chord === null ? null : { ...prev.chord }, confidence: Math.min(prev.confidence, next.confidence) };
      changed++;
    }
  }
  if (changed > 0) {
    warnings.push({
      code: 'SMOOTHED_GLITCHES',
      message: `Replaced ${changed} one-observation chord glitch(es) with their surroundings`,
    });
  }
  return { observations: out, warnings };
}

/**
 * Merge consecutive harmonically identical observations into ChordEvents on
 * the beat grid. NO_CHORD observations are dropped — they create gaps in the
 * timeline rather than fake chords. Segment confidence is the duration-
 * weighted mean of its observations.
 */
export function segmentChordTimeline(observations: NormalizedChordObservation[], beats: BeatEvent[]): ChordEvent[] {
  // 1. merge consecutive identical chords on the seconds timeline
  interface Segment {
    startSeconds: number;
    endSeconds: number;
    chord: { root: import('../../domain/music/pitch.js').PitchClass; quality: import('../../domain/music/chord.js').ChordQuality };
    confidenceSum: number;
  }
  const segments: Segment[] = [];
  for (const o of observations) {
    if (o.chord === null) continue;
    const duration = Math.max(o.endSeconds - o.startSeconds, 0.0001);
    const last = segments[segments.length - 1];
    if (
      last !== undefined &&
      last.chord.root === o.chord.root &&
      last.chord.quality === o.chord.quality
    ) {
      last.endSeconds = o.endSeconds;
      last.confidenceSum += o.confidence * duration;
      continue;
    }
    segments.push({
      startSeconds: o.startSeconds,
      endSeconds: o.endSeconds,
      chord: o.chord,
      confidenceSum: o.confidence * duration,
    });
  }

  // 2. map merged segments onto the detected beat grid
  const events: ChordEvent[] = [];
  for (const s of segments) {
    const range = timeRangeToBeatRange(s.startSeconds, s.endSeconds, beats);
    const lastEnd = events.length > 0 ? events[events.length - 1]!.startBeat + events[events.length - 1]!.durationBeats : 0;
    const startBeat = Math.max(range.startBeat, lastEnd); // never overlap backwards
    if (startBeat >= range.endBeat) continue;
    const weight = Math.max(s.endSeconds - s.startSeconds, 0.0001);
    events.push({
      startBeat,
      durationBeats: range.endBeat - startBeat,
      root: s.chord.root,
      quality: s.chord.quality,
      confidence: Math.min(1, s.confidenceSum / weight),
    });
  }
  return events;
}
