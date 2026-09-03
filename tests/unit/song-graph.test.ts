import { describe, expect, it } from 'vitest';
import { SongGraphSchema, type SongGraph } from '../../src/domain/music/song-graph.js';
import { generateBeatGrid } from '../../src/domain/music/rhythm.js';

const validGraph: SongGraph = {
  id: 'song_abc123def456',
  metadata: { title: 'T', artist: 'A', durationMs: 100_000 },
  global: {
    bpm: 120,
    timeSignature: { numerator: 4, denominator: 4, confidence: 1, source: 'ANALYZED' },
    key: 'C major',
    tuningReferenceHz: 440,
  },
  beats: generateBeatGrid(8, { bpm: 120, timeSignature: { numerator: 4, denominator: 4, confidence: 1, source: 'ANALYZED' } }),
  sections: [
    {
      id: 'sec_1',
      type: 'VERSE',
      startBeat: 0,
      endBeat: 8,
      confidence: 0.9,
      importance: 0.8,
    },
  ],
  harmony: {
    chords: [
      { startBeat: 0, durationBeats: 4, root: 'C', quality: 'major', confidence: 0.95 },
    ],
  },
  melody: {
    notes: [
      { id: 'n1', midi: 64, startBeat: 0, durationBeats: 1, confidence: 0.9 },
    ],
  },
  motifs: [],
  confidence: { overall: 0.9 },
};

describe('SongGraph validation', () => {
  it('accepts a valid graph', () => {
    expect(SongGraphSchema.parse(validGraph)).toBeDefined();
  });
  it('rejects bad bpm', () => {
    expect(
      SongGraphSchema.safeParse({ ...validGraph, global: { ...validGraph.global, bpm: 0 } }).success,
    ).toBe(false);
    expect(
      SongGraphSchema.safeParse({ ...validGraph, global: { ...validGraph.global, bpm: -10 } }).success,
    ).toBe(false);
  });
  it('rejects bad time signatures', () => {
    const badTs = (n: number, d: number) =>
      SongGraphSchema.safeParse({
        ...validGraph,
        global: { ...validGraph.global, timeSignature: { numerator: n, denominator: d } },
      }).success;
    expect(badTs(0, 4)).toBe(false);
    expect(badTs(4, 3)).toBe(false); // not a power of two
    expect(badTs(4, 8)).toBe(true);
  });
  it('rejects invalid confidence', () => {
    expect(
      SongGraphSchema.safeParse({ ...validGraph, confidence: { overall: 1.5 } }).success,
    ).toBe(false);
    expect(
      SongGraphSchema.safeParse({ ...validGraph, confidence: { overall: -0.1 } }).success,
    ).toBe(false);
  });
  it('rejects invalid midi in melody notes', () => {
    expect(
      SongGraphSchema.safeParse({
        ...validGraph,
        melody: { notes: [{ id: 'x', midi: 128, startBeat: 0, durationBeats: 1, confidence: 1 }] },
      }).success,
    ).toBe(false);
  });
  it('rejects invalid section boundaries', () => {
    expect(
      SongGraphSchema.safeParse({
        ...validGraph,
        sections: [{ ...validGraph.sections[0]!, endBeat: 0 }],
      }).success,
    ).toBe(false);
    expect(
      SongGraphSchema.safeParse({
        ...validGraph,
        sections: [{ ...validGraph.sections[0]!, startBeat: 5, endBeat: 5 }],
      }).success,
    ).toBe(false);
  });
  it('rejects out-of-range section confidence/importance', () => {
    expect(
      SongGraphSchema.safeParse({
        ...validGraph,
        sections: [{ ...validGraph.sections[0]!, importance: 2 }],
      }).success,
    ).toBe(false);
  });
});

describe('beat grid generation', () => {
  it('marks 4/4 downbeats deterministically', () => {
    const beats = generateBeatGrid(8, { bpm: 120, timeSignature: { numerator: 4, denominator: 4, confidence: 1, source: 'ANALYZED' } });
    expect(beats.map((b) => b.isDownbeat)).toEqual([true, false, false, false, true, false, false, false]);
    expect(beats[1]!.timeMs).toBe(500);
  });
  it('handles 3/4', () => {
    const beats = generateBeatGrid(6, { bpm: 60, timeSignature: { numerator: 3, denominator: 4 } });
    expect(beats.map((b) => b.isDownbeat)).toEqual([true, false, false, true, false, false]);
  });
});
