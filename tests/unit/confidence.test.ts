import { describe, expect, it } from 'vitest';
import { aggregateConfidence, averageChordConfidence } from '../../src/engines/songgraph/confidence.js';
import type { RawMusicAnalysis } from '../../src/domain/analysis/raw-music-analysis.js';

const weights = { rhythm: 0.3, key: 0.3, chord: 0.4 };

const analysis = (over: {
  rhythmConfidence?: number;
  keyConfidence?: number;
  chords?: Array<{ start: number; end: number; confidence: number }>;
}): RawMusicAnalysis => ({
  provider: 'fake',
  rhythm: {
    bpm: 120,
    beats: [{ timeSeconds: 0 }],
    ...(over.rhythmConfidence !== undefined && { confidence: over.rhythmConfidence }),
  },
  tonal: {
    ...(over.keyConfidence !== undefined && {
      key: { root: 'C', scale: 'major', confidence: over.keyConfidence },
    }),
    chords: (over.chords ?? []).map((c) => ({
      startSeconds: c.start,
      endSeconds: c.end,
      label: 'C',
      confidence: c.confidence,
    })),
  },
  warnings: [],
});

describe('aggregateConfidence', () => {
  it('is the documented weighted heuristic', () => {
    const c = aggregateConfidence(analysis({ rhythmConfidence: 1, keyConfidence: 1, chords: [{ start: 0, end: 1, confidence: 1 }] }), weights, 1);
    expect(c.overall).toBeCloseTo(1, 5);
    expect(c.rhythm).toBe(1);
    expect(c.key).toBe(1);
    expect(c.chord).toBe(1);
  });
  it('treats missing key/rhythm as zero confidence, not as certainty', () => {
    const c = aggregateConfidence(analysis({ chords: [{ start: 0, end: 1, confidence: 0.5 }] }), weights, 0.5);
    expect(c.rhythm).toBe(0);
    expect(c.key).toBe(0);
    expect(c.overall).toBeCloseTo(0.4 * 0.5, 5);
  });
  it('stays inside [0, 1]', () => {
    const c = aggregateConfidence(analysis({ rhythmConfidence: 1, keyConfidence: 1 }), weights, 1);
    expect(c.overall).toBeLessThanOrEqual(1);
  });
});

describe('averageChordConfidence', () => {
  it('weights by observation duration', () => {
    const a = analysis({ chords: [{ start: 0, end: 3, confidence: 1 }, { start: 3, end: 4, confidence: 0 }] });
    expect(averageChordConfidence(a)).toBeCloseTo(0.75, 5);
  });
  it('is zero with no observations', () => {
    expect(averageChordConfidence(analysis({}))).toBe(0);
  });
});
