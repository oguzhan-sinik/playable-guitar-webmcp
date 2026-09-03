import { describe, expect, it } from 'vitest';
import { buildSongGraph } from '../../src/engines/songgraph/build-song-graph.js';
import { FakeMusicAnalysisProvider } from '../../src/providers/music-analysis/fake/fake-music-analysis-provider.js';
import type { Song } from '../../src/domain/song/song.js';
import { AppError } from '../../src/errors/app-error.js';

const song: Song = {
  id: 'song_07c596988b8d',
  title: 'Test Song',
  artist: 'Test Artist',
  source: { type: 'local', original: 'test.wav' },
  durationMs: 8000,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const scenario = {
  bpm: 120,
  beatTimes: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  key: { root: 'Ab', scale: 'major' as const, confidence: 0.8 },
  chordLabels: [
    { label: 'Ab', confidence: 0.9 },
    { label: 'Ab', confidence: 0.9 },
    { label: 'Bb', confidence: 0.85 },
    { label: 'Bb', confidence: 0.85 },
    { label: 'Gm', confidence: 0.8 },
    { label: 'Gm', confidence: 0.8 },
    { label: 'Db', confidence: 0.7 },
  ],
};

describe('buildSongGraph', () => {
  it('builds bpm, beats, key, chords from raw analysis', async () => {
    const analysis = await new FakeMusicAnalysisProvider(scenario).analyze('x.wav');
    const graph = buildSongGraph(song, analysis);
    expect(graph.global.bpm).toBe(120);
    expect(graph.global.key).toBe('G# major'); // flat normalized into domain spelling
    expect(graph.beats).toHaveLength(8);
    expect(graph.beats[0]!.isDownbeat).toBe(true);
    const chords = graph.harmony.chords;
    expect(chords.map((c) => c.root)).toEqual(['G#', 'A#', 'G', 'C#']);
    expect(chords[0]!.startBeat).toBe(0);
    expect(chords[0]!.durationBeats).toBe(2);
  });
  it('sets a single UNKNOWN section with honest low confidence, no melody/motifs', async () => {
    const analysis = await new FakeMusicAnalysisProvider(scenario).analyze('x.wav');
    const graph = buildSongGraph(song, analysis);
    expect(graph.sections).toHaveLength(1);
    expect(graph.sections[0]!.type).toBe('UNKNOWN');
    expect(graph.sections[0]!.confidence).toBeLessThanOrEqual(0.3);
    expect(graph.melody).toBeUndefined();
    expect(graph.motifs).toEqual([]);
  });
  it('falls back to 4/4 marked DEFAULT with low confidence', async () => {
    const analysis = await new FakeMusicAnalysisProvider(scenario).analyze('x.wav');
    const graph = buildSongGraph(song, analysis);
    expect(graph.global.timeSignature).toMatchObject({ numerator: 4, denominator: 4, source: 'DEFAULT' });
    expect(graph.global.timeSignature.confidence).toBeLessThanOrEqual(0.2);
  });
  it('stores heuristic confidence components and provenance', async () => {
    const analysis = await new FakeMusicAnalysisProvider(scenario).analyze('x.wav');
    const graph = buildSongGraph(song, analysis, { sourceAudioSha256: 'abc', analysisVersion: '1' });
    expect(graph.confidence.overall).toBeGreaterThan(0);
    expect(graph.confidence.rhythm).toBeDefined();
    expect(graph.confidence.key).toBeDefined();
    expect(graph.confidence.chord).toBeDefined();
    expect(graph.provenance).toMatchObject({ provider: 'fake', analysisVersion: '1', sourceAudioSha256: 'abc' });
  });
  it('fails with INSUFFICIENT_BEATS when the beat grid is empty', async () => {
    const analysis = await new FakeMusicAnalysisProvider({ ...scenario, beatTimes: [] }).analyze('x.wav');
    try {
      buildSongGraph(song, analysis);
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('INSUFFICIENT_BEATS');
    }
  });
  it('warns (non-fatally) on low overall confidence', async () => {
    const lowScenario = {
      ...scenario,
      rhythmConfidence: 0.1,
      key: { root: 'C', scale: 'major' as const, confidence: 0.1 },
      chordLabels: scenario.chordLabels.map((c) => ({ ...c, confidence: 0.05 })),
    };
    const analysis = await new FakeMusicAnalysisProvider(lowScenario).analyze('x.wav');
    const graph = buildSongGraph(song, analysis);
    expect(graph.confidence.overall).toBeLessThan(0.35);
    expect(graph.harmony.chords).toHaveLength(0); // all below threshold -> NO_CHORD, no fake chords
  });
});
