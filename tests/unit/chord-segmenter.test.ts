import { describe, expect, it } from 'vitest';
import { normalizeChordObservations } from '../../src/engines/songgraph/chord-normalizer.js';
import { smoothSingleBeatGlitches, segmentChordTimeline } from '../../src/engines/songgraph/chord-segmenter.js';
import { ticksToBeats } from '../../src/engines/songgraph/beat-normalizer.js';
import type { RawChordObservation } from '../../src/domain/analysis/raw-music-analysis.js';

const config = { minimumChordConfidence: 0.5 };
const raw = (label: string, start: number, end: number, confidence = 0.9): RawChordObservation => ({
  startSeconds: start,
  endSeconds: end,
  label,
  confidence,
});

describe('normalizeChordObservations', () => {
  it('parses labels and keeps confidence', () => {
    const out = normalizeChordObservations([raw('G', 0, 1), raw('G#m', 1, 2)], config);
    expect(out.map((o) => o.chord)).toEqual([
      { root: 'G', quality: 'major' },
      { root: 'G#', quality: 'minor' },
    ]);
  });
  it('treats below-threshold observations as NO_CHORD, preserving their confidence', () => {
    const out = normalizeChordObservations([raw('C', 0, 1, 0.2)], config);
    expect(out[0]!.chord).toBeNull();
    expect(out[0]!.confidence).toBe(0.2);
  });
  it('maps NO_CHORD labels to null', () => {
    const out = normalizeChordObservations([raw('NO_CHORD', 0, 1, 0.9)], config);
    expect(out[0]!.chord).toBeNull();
  });
});

describe('smoothSingleBeatGlitches', () => {
  it('replaces a lower-confidence one-observation glitch with its surroundings', () => {
    // G G Bm G G on 0.5s beats — classic detector hiccup
    const obs = normalizeChordObservations(
      [
        raw('G', 0, 0.5, 0.9),
        raw('G', 0.5, 1.0, 0.9),
        raw('Bm', 1.0, 1.5, 0.4),
        raw('G', 1.5, 2.0, 0.9),
        raw('G', 2.0, 2.5, 0.9),
      ],
      config,
    );
    const { observations, warnings } = smoothSingleBeatGlitches(obs);
    expect(observations[2]!.chord).toEqual({ root: 'G', quality: 'major' });
    expect(warnings.some((w) => w.code === 'SMOOTHED_GLITCHES')).toBe(true);
  });
  it('keeps a confident short chord that differs from its neighbours', () => {
    const obs = normalizeChordObservations(
      [raw('G', 0, 1, 0.9), raw('C', 1, 2, 0.95), raw('G', 2, 3, 0.9)], config);
    const { observations, warnings } = smoothSingleBeatGlitches(obs);
    expect(observations[1]!.chord).toEqual({ root: 'C', quality: 'major' });
    expect(warnings).toHaveLength(0);
  });
  it('never touches a genuine harmonic change (multi-observation run)', () => {
    const obs = normalizeChordObservations(
      [raw('G', 0, 1, 0.9), raw('C', 1, 2, 0.6), raw('C', 2, 3, 0.6), raw('G', 3, 4, 0.9)], config);
    const { observations } = smoothSingleBeatGlitches(obs);
    expect(observations[1]!.chord).toEqual({ root: 'C', quality: 'major' });
    expect(observations[2]!.chord).toEqual({ root: 'C', quality: 'major' });
  });
});

describe('segmentChordTimeline', () => {
  const beats = ticksToBeats([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], 4);
  it('merges consecutive identical chords into one event', () => {
    const obs = normalizeChordObservations(
      [raw('G', 0, 0.5), raw('G', 0.5, 1), raw('G', 1, 1.5), raw('G', 1.5, 2)], config);
    const events = segmentChordTimeline(obs, beats);
    expect(events).toEqual([
      { startBeat: 0, durationBeats: 4, root: 'G', quality: 'major', confidence: 0.9 },
    ]);
  });
  it('produces the G 0-4 / C 4-8 style timeline from repeated labels', () => {
    const obs = normalizeChordObservations(
      [...Array(4).fill(null).map((_, i) => raw('G', i * 0.5, (i + 1) * 0.5)),
       ...Array(4).fill(null).map((_, i) => raw('C', 2 + i * 0.5, 2 + (i + 1) * 0.5))], config);
    const events = segmentChordTimeline(obs, beats);
    expect(events.map((e) => `${e.root} ${e.startBeat}-${e.startBeat + e.durationBeats}`))
      .toEqual(['G 0-4', 'C 4-8']);
  });
  it('drops NO_CHORD observations, leaving a gap instead of a fake chord', () => {
    const obs = normalizeChordObservations(
      [raw('G', 0, 0.5), raw('NO_CHORD', 0.5, 1), raw('C', 1, 1.5)], config);
    const events = segmentChordTimeline(obs, beats);
    expect(events.map((e) => e.root)).toEqual(['G', 'C']);
    expect(events[1]!.startBeat).toBe(2);
  });
  it('weights merged confidence by duration', () => {
    const obs = normalizeChordObservations(
      [raw('G', 0, 0.5, 1.0), raw('G', 0.5, 1.0, 0.5)], config);
    const events = segmentChordTimeline(obs, beats);
    expect(events[0]!.confidence).toBeCloseTo(0.75, 5);
  });
});
