import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EssentiaMusicAnalysisProvider } from '../../src/providers/music-analysis/essentia/essentia-provider.js';
import { EssentiaRuntime } from '../../src/providers/music-analysis/essentia/essentia-loader.js';
import { writeWav, clickTrack, chordProgressionTrack } from '../helpers/synth-audio.js';

/**
 * Essentia integration tests on generated synthetic audio. These validate the
 * PROVIDER (DSP + our decoding/normalization), not our graph-building logic —
 * the fake provider covers that deterministically. Assertions use musical
 * tolerances; half/double-time tempo equivalences are accepted.
 */
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'guitar-essentia-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

// skipped lazily if the WASM runtime cannot initialize in this environment
const available = EssentiaRuntimeAvailable();
function EssentiaRuntimeAvailable(): boolean {
  try {
    EssentiaRuntime.getInstance();
    return true;
  } catch {
    return false;
  }
}
const maybe = available ? it : it.skip;

describe('Essentia provider on synthetic audio', () => {
  maybe('fixture A: 120 BPM click -> tempo ~120 (half/double accepted)', async () => {
    const provider = new EssentiaMusicAnalysisProvider();
    const wav = path.join(dir, 'click120.wav');
    await writeWav(wav, clickTrack(120, 30));
    const result = await provider.analyze(wav);
    const rhythm = result.rhythm!;
    const key = result.key;
    const chordResult = result.chords![0]!;
    const bpm = rhythm.bpm;
    const related =
      (Math.abs(bpm - 120) < 4) ||
      (Math.abs(bpm - 60) < 3) ||
      (Math.abs(bpm - 240) < 8);
    expect(related, `detected ${bpm} BPM`).toBe(true);
    expect(rhythm.beats.length).toBeGreaterThan(20);
  }, 60000);

  maybe('fixture B: sustained C major -> key C major, chords C', async () => {
    const provider = new EssentiaMusicAnalysisProvider();
    const wav = path.join(dir, 'cmaj.wav');
    await writeWav(wav, chordProgressionTrack([{ root: 'C', minor: false }], 10));
    const result = await provider.analyze(wav);
    const rhythm = result.rhythm!;
    const key = result.key;
    const chordResult = result.chords![0]!;
    expect(key?.root).toBe('C');
    expect(key?.scale).toBe('major');
    const labels = chordResult.segments.map((c) => c.label);
    const majorCount = labels.filter((l) => l === 'C').length;
    expect(majorCount / labels.length).toBeGreaterThan(0.6);
  }, 60000);

  maybe('fixture C: C G Am F progression -> chord ordering recovered', async () => {
    const provider = new EssentiaMusicAnalysisProvider();
    const wav = path.join(dir, 'prog.wav');
    await writeWav(wav, chordProgressionTrack([
      { root: 'C', minor: false },
      { root: 'G', minor: false },
      { root: 'A', minor: true },
      { root: 'F', minor: false },
    ], 2));
    const result = await provider.analyze(wav);
    const rhythm = result.rhythm!;
    const key = result.key;
    const chordResult = result.chords![0]!;
    // collapse consecutive identical labels into segments
    const segments: string[] = [];
    for (const c of chordResult.segments) {
      if (segments[segments.length - 1] !== c.label) segments.push(c.label);
    }
    expect(segments).toContain('C');
    expect(segments).toContain('G');
    expect(segments).toContain('Am');
    expect(segments).toContain('F');
    // ordering: C before G before Am before F (allowing repeats)
    const idx = (l: string) => segments.indexOf(l);
    expect(idx('C')).toBeLessThan(idx('G'));
    expect(idx('G')).toBeLessThan(idx('Am'));
    expect(idx('Am')).toBeLessThan(idx('F'));
  }, 60000);
});
