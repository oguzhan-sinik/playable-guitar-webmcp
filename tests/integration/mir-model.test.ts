import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PythonMirWorker } from '../../src/providers/music-analysis/python/python-worker.js';
import { MadmomChordProvider } from '../../src/providers/music-analysis/python/madmom-chord-provider.js';
import { AllInOneRhythmStructureProvider } from '../../src/providers/music-analysis/python/all-in-one-provider.js';
import { BeatThisRhythmProvider, MadmomDownbeatProvider } from '../../src/providers/music-analysis/python/beat-this-provider.js';
import { writeWav, clickTrack, chordProgressionTrack, accentPatternTrack } from '../helpers/synth-audio.js';

/**
 * Opt-in learned-model tests: RUN_MIR_MODEL_TESTS=1 pnpm test
 * These download/load real model weights and are slow; default `pnpm test`
 * skips them so CI stays fast and deterministic.
 */
const run = process.env.RUN_MIR_MODEL_TESTS === '1';
const maybe = run ? it : it.skip;

let dir: string;
const worker = new PythonMirWorker();

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'guitar-mir-model-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!run)('Python MIR worker (learned models)', () => {
  maybe('worker doctor reports healthy components', async () => {
    const report = await worker.doctor();
    expect(report.components.find((c) => c.name === 'madmom-infer')?.ok).toBe(true);
    expect(report.components.find((c) => c.name === 'all-in-one')?.ok).toBe(true);
  }, 120000);

  maybe('DeepChroma recovers C-G-Am-F on synthetic audio', async () => {
    const wav = path.join(dir, 'prog.wav');
    await writeWav(wav, chordProgressionTrack([
      { root: 'C', minor: false }, { root: 'G', minor: false },
      { root: 'A', minor: true }, { root: 'F', minor: false },
    ], 2));
    const provider = new MadmomChordProvider('deepchroma', { worker });
    const result = await provider.analyze(wav);
    const timeline = result.chords![0]!;
    const segments = timeline.segments.filter((s) => s.label !== 'NO_CHORD');
    expect(segments.length).toBeGreaterThanOrEqual(4);
    const collapsed: string[] = [];
    for (const s of segments) {
      if (collapsed[collapsed.length - 1] !== s.label) collapsed.push(s.label);
    }
    expect(collapsed.join(' ')).toMatch(/C(:maj)?\s+G(:maj)?\s+A(:min)?m?\s+F(:maj)?/);
  }, 300000);

  maybe('CNN+CRF pipeline runs and produces normalized labels', async () => {
    const wav = path.join(dir, 'prog2.wav');
    await writeWav(wav, chordProgressionTrack([
      { root: 'C', minor: false }, { root: 'G', minor: false },
      { root: 'A', minor: true }, { root: 'F', minor: false },
    ], 2));
    const provider = new MadmomChordProvider('cnn-crf', { worker });
    const result = await provider.analyze(wav);
    const timeline = result.chords![0]!;
    expect(timeline.segments.length).toBeGreaterThan(0);
    // adapter normalizes 'C:maj'/'N' into 'C'/'NO_CHORD'
    const harmonic = timeline.segments.filter((s) => s.label !== 'NO_CHORD');
    expect(harmonic.length).toBeGreaterThan(0);
    expect(harmonic.some((s) => s.label === 'C')).toBe(true);
    expect(harmonic.some((s) => s.label === 'Am')).toBe(true);
  }, 300000);

  maybe('All-In-One produces beats, downbeats, positions, and segments', async () => {
    // chord changes every 0.5s at 4/4-like grouping; needs a pulse — use a click+chords hybrid
    const wav = path.join(dir, 'rhythm.wav');
    await writeWav(wav, chordProgressionTrack([
      { root: 'C', minor: false }, { root: 'G', minor: false },
      { root: 'A', minor: true }, { root: 'F', minor: false },
    ], 4));
    const provider = new AllInOneRhythmStructureProvider({ worker, device: process.env.MIR_DEVICE ?? 'cpu' });
    const result = await provider.analyze(wav);
    const rs = result.rhythmStructure!;
    expect(rs.beats!.length).toBeGreaterThan(8);
    expect(rs.downbeats!.length).toBeGreaterThan(1);
    expect(rs.beatPositions!.length).toBeGreaterThan(8);
    expect(rs.segments!.length).toBeGreaterThan(0);
    // downbeats should be roughly periodic (within 25% of the median gap)
    const gaps = rs.downbeats!.slice(1).map((d, i) => d - rs.downbeats![i]!);
    const median = gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!;
    for (const gap of gaps) {
      expect(Math.abs(gap - median) / median).toBeLessThan(0.25);
    }
  }, 600000);

  maybe('tempo consensus picks the click tempo over a rogue provider', async () => {
    const wav = path.join(dir, 'click120.wav');
    await writeWav(wav, clickTrack(120, 30));
    const provider = new AllInOneRhythmStructureProvider({ worker, device: process.env.MIR_DEVICE ?? 'cpu' });
    const result = await provider.analyze(wav);
    const bpm = result.rhythmStructure!.bpm ?? 0;
    const related = [120, 60, 240].some((t) => Math.abs(bpm - t) / t < 0.04);
    expect(related, `all-in-one tempo ${bpm} not in {60,120,240}`).toBe(true);
  }, 600000);
});

describe.skipIf(!run)('synthetic meter acceptance (V3 rhythm)', () => {
  maybe('acceptance A: straight 4/4 accents resolve to ~tempo with 4-beat grouping', async () => {
    const wav = path.join(dir, 'acc44.wav');
    // 2s per bar, 4 beats per bar -> 120 BPM beat level
    await writeWav(wav, accentPatternTrack([1, 0.3, 0.5, 0.3], 16, 2));
    const provider = new BeatThisRhythmProvider({ worker, device: process.env.MIR_DEVICE ?? 'cpu' });
    const madmom = new MadmomDownbeatProvider({ worker, device: process.env.MIR_DEVICE ?? 'cpu' });
    const [bt, md] = await Promise.all([provider.analyze(wav), madmom.analyze(wav)]);
    const beats = bt.rhythmResult!.beats;
    expect(beats.length).toBeGreaterThan(30);
    const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const intervals = beats.slice(1).map((b, i) => b - beats[i]!);
    const beatBpm = 60 / median(intervals);
    // the tracker must find the pulse at some metrical level of 120
    expect([30, 60, 120, 240].some((t) => Math.abs(beatBpm - t) / t < 0.05)).toBe(true);
    // madmom downbeat: 4-beat grouping hypothesis should win the bar structure
    expect(md.rhythmResult!.meterHypotheses!.length).toBe(4);
  }, 600000);

  maybe('acceptance B: 6/8 accents resolve to compound grouping, not a flat 6-pulse', async () => {
    const wav = path.join(dir, 'acc68.wav');
    // STRONG weak weak MEDIUM weak weak, 1.9s per bar (like the target ballad case)
    await writeWav(wav, accentPatternTrack([1, 0.25, 0.25, 0.6, 0.25, 0.25], 16, 1.9));
    const provider = new BeatThisRhythmProvider({ worker, device: process.env.MIR_DEVICE ?? 'cpu' });
    const result = await provider.analyze(wav);
    const beats = result.rhythmResult!.beats;
    const downbeats = result.rhythmResult!.downbeats!;
    expect(beats.length).toBeGreaterThan(40);
    expect(downbeats.length).toBeGreaterThan(8);
    const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    const beatBpm = 60 / median(beats.slice(1).map((b, i) => b - beats[i]!));
    const barBpm = 60 / median(downbeats.slice(1).map((b, i) => b - downbeats[i]!));
    // grouping: beats per bar in the compound 3-subdivision family
    const beatsPerBar = beatBpm / barBpm;
    expect(Math.abs(beatsPerBar - 6) / 6).toBeLessThan(0.15);
  }, 600000);
});
