import { describe, expect, it } from 'vitest';
import { evaluateGraph } from '../../src/engines/songgraph/evaluate-graph.js';
import type { SongGraph } from '../../src/domain/music/song-graph.js';

const graph = (bpm: number, chords: SongGraph['harmony']['chords']): SongGraph => ({
  id: 'song_000000000000',
  metadata: { durationMs: 8000 },
  global: { bpm, timeSignature: { numerator: 4, denominator: 4, confidence: 1, source: 'ANALYZED' }, tuningReferenceHz: 440 },
  beats: [],
  sections: [],
  harmony: { chords },
  motifs: [],
  confidence: { overall: 1 },
});

const chord = (startBeat: number, durationBeats: number, root: SongGraph['harmony']['chords'][number]['root'], quality: 'major' | 'minor') => ({
  startBeat,
  durationBeats,
  root,
  quality,
  confidence: 1,
});

// 4 bars of C at 120 BPM (2s per chord, 8s total)
const reference = graph(120, [
  chord(0, 4, 'C', 'major'),
  chord(4, 4, 'G', 'major'),
  chord(8, 4, 'A', 'minor'),
  chord(12, 4, 'F', 'major'),
]);

describe('evaluateGraph V2 metrics', () => {
  it('metrical tempo relations: double-time counts as related', () => {
    const exact = evaluateGraph(graph(120, []), reference);
    expect(exact.tempo.metricalRelation).toBe('1:1');
    const doubled = evaluateGraph(graph(240, []), reference);
    expect(doubled.tempo.metricalRelation).toBe('2:1');
    expect(doubled.tempo.musicallyRelated).toBe(true);
    const half = evaluateGraph(graph(60, []), reference);
    expect(half.tempo.metricalRelation).toBe('1:2');
    const wrong = evaluateGraph(graph(95, []), reference);
    expect(wrong.tempo.metricalRelation).toBe('OTHER');
    expect(wrong.tempo.musicallyRelated).toBe(false);
  });

  it('fragmentation ratio exposes over-segmentation explicitly', () => {
    // same harmony but every beat its own segment -> 16 segments vs 4
    const fragmented = graph(120, Array.from({ length: 16 }, (_, i) => chord(i, 1, 'C', 'major')));
    const evaluation = evaluateGraph(fragmented, reference);
    expect(evaluation.chords.fragmentationRatio).toBeCloseTo(16 / 4, 5);
    // root accuracy still counts: C matches only the first bar
    expect(evaluation.chords.rootAccuracy).toBeGreaterThan(0);
    expect(evaluation.chords.rootAccuracy).toBeLessThan(0.4);
  });

  it('scores clean recognition as perfect, without fragmentation', () => {
    const evaluation = evaluateGraph(reference, reference);
    expect(evaluation.chords.rootAccuracy).toBe(1);
    expect(evaluation.chords.qualityAccuracy).toBe(1);
    expect(evaluation.chords.fragmentationRatio).toBeCloseTo(1, 5);
  });

  it('penalizes wrong quality on right root', () => {
    const wrongQuality = graph(120, [
      chord(0, 4, 'C', 'major'),
      chord(4, 4, 'G', 'major'),
      chord(8, 4, 'A', 'major'), // reference: minor
      chord(12, 4, 'F', 'major'),
    ]);
    const evaluation = evaluateGraph(wrongQuality, reference);
    expect(evaluation.chords.rootAccuracy).toBe(1);
    expect(evaluation.chords.qualityAccuracy).toBeLessThan(1);
  });
});
