import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyzeSong, type AnalyzeSongDeps } from '../../src/application/analyze-song.js';
import { prepareSong } from '../../src/application/prepare-song.js';
import { FakeMusicAnalysisProvider } from '../../src/providers/music-analysis/fake/fake-music-analysis-provider.js';
import { LocalSongRepository } from '../../src/repositories/song-repository.js';
import { LocalSongGraphRepository } from '../../src/repositories/song-graph-repository.js';
import type { Song } from '../../src/domain/song/song.js';
import { writeWav } from '../../src/utils/wav.js';
import { buildBaseArrangement } from '../../src/engines/arrangement/build-base-arrangement.js';
import { computeDifficulty } from '../../src/engines/difficulty/arrangement-difficulty.js';
import { computeFidelity } from '../../src/engines/fidelity/arrangement-fidelity.js';

let dataDir: string;
let songsDir: string;
let deps: AnalyzeSongDeps;

const song: Song = {
  id: 'song_07c596988b8d',
  title: 'Fake Analysis Song',
  artist: 'Fake Artist',
  source: { type: 'local', original: 'test.wav' },
  durationMs: 8000,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const scenario = {
  bpm: 120,
  beatTimes: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  key: { root: 'C', scale: 'major' as const, confidence: 0.9 },
  chordLabels: [
    { label: 'C', confidence: 0.9 },
    { label: 'C', confidence: 0.9 },
    { label: 'G', confidence: 0.9 },
    { label: 'G', confidence: 0.9 },
    { label: 'Am', confidence: 0.9 },
    { label: 'Am', confidence: 0.9 },
    { label: 'F', confidence: 0.9 },
  ],
};

const strategy = {
  rhythmProviders: ['fake'],
  chordProviders: ['fake'],
  useSourceSeparation: false,
  chordAudioVariants: ['FULL_MIX' as const],
  consensus: { enabled: true },
  device: 'cpu',
};

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'guitar-analysis-'));
  songsDir = path.join(dataDir, 'songs');
  const songDir = path.join(songsDir, song.id, 'audio');
  await mkdir(songDir, { recursive: true });
  await writeFile(path.join(songsDir, song.id, 'metadata.json'), JSON.stringify(song));
  await writeWav(path.join(songDir, 'analysis.wav'), new Float32Array(44100 * 4));
  deps = {
    songs: new LocalSongRepository(songsDir),
    graphs: new LocalSongGraphRepository(songsDir),
    providers: [new FakeMusicAnalysisProvider(scenario)],
    songsDir,
  };
});

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('analyzeSong (fake provider, V2 pipeline)', () => {
  it('persisted per-provider artifacts and graph.json', async () => {
    const result = await analyzeSong(song.id, deps, { strategy });
    await stat(path.join(songsDir, song.id, 'analysis', 'raw', 'fake.FULL_MIX.json'));
    await stat(path.join(songsDir, song.id, 'analysis', 'normalized.json'));
    await stat(result.graphPath);
    const raw = JSON.parse(
      await readFile(path.join(songsDir, song.id, 'analysis', 'raw', 'fake.FULL_MIX.json'), 'utf8'),
    );
    expect(raw.meta.provider).toBe('fake');
    expect(raw.meta.audioSha256).toMatch(/^[0-9a-f]{64}$/);
    const graph = JSON.parse(await readFile(result.graphPath, 'utf8'));
    expect(graph.global.bpm).toBe(120);
    expect(graph.harmony.chords.map((c: { root: string }) => c.root)).toEqual(['C', 'G', 'A', 'F']);
  });

  it('reuses provider cache, invalidates with --force and changed audio', async () => {
    await rm(path.join(songsDir, song.id, 'analysis'), { recursive: true, force: true });
    const first = await analyzeSong(song.id, deps, { strategy });
    expect(first.cachedProviders).toHaveLength(0);
    const second = await analyzeSong(song.id, deps, { strategy });
    expect(second.cachedProviders.length).toBeGreaterThan(0);
    const forced = await analyzeSong(song.id, deps, { strategy, force: true });
    expect(forced.cachedProviders).toHaveLength(0);
    // changed audio -> cache invalid
    const wavPath = path.join(songsDir, song.id, 'audio', 'analysis.wav');
    await writeWav(wavPath, new Float32Array(44100 * 5));
    const changed = await analyzeSong(song.id, deps, { strategy });
    expect(changed.cachedProviders).toHaveLength(0);
  });
});

describe('prepareSong (fake provider)', () => {
  it('loads graph.json and produces a scored arrangement plus frontier', async () => {
    await analyzeSong(song.id, deps, { strategy });
    const prepared = await prepareSong(song.id, {
      songs: new LocalSongRepository(songsDir),
      graphs: new LocalSongGraphRepository(songsDir),
    });
    expect(prepared.song.global.bpm).toBe(120);
    expect(prepared.base.chords.length).toBeGreaterThan(0);
    expect(prepared.base.difficulty?.total).toBeGreaterThan(0);
    expect(prepared.base.fidelity?.total).toBeGreaterThan(0);
    for (const cand of prepared.frontier) {
      expect(cand.difficulty!.total).toBeLessThanOrEqual(prepared.base.difficulty!.total + 1e-9);
    }
    const direct = buildBaseArrangement(prepared.song);
    direct.difficulty = computeDifficulty({ arrangement: direct, song: prepared.song });
    direct.fidelity = computeFidelity({ arrangement: direct, original: prepared.song });
    expect(direct.difficulty.total).toBeCloseTo(prepared.base.difficulty!.total, 6);
  });
});
