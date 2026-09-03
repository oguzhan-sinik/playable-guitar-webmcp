import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SongGraphSchema, type SongGraph } from '../../src/domain/music/song-graph.js';
import { buildBaseArrangement } from '../../src/engines/arrangement/build-base-arrangement.js';
import { computeDifficulty } from '../../src/engines/difficulty/arrangement-difficulty.js';
import { validateArrangement } from '../../src/engines/arrangement/validate-arrangement.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/songgraphs');
const load = (name: string): SongGraph =>
  SongGraphSchema.parse(JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')));

describe('arrangement builder + validator', () => {
  it('builds a valid arrangement from the mixed fixture', () => {
    const song = load('mixed-beginner-song.json');
    const arr = buildBaseArrangement(song);
    const v = validateArrangement(arr);
    expect(v.errors).toEqual([]);
    expect(v.valid).toBe(true);
    expect(arr.chords.map((c) => c.shapeName)).toEqual(['C', 'G', 'Am', 'F']);
    expect(arr.notes).toHaveLength(16);
  });

  it('rejects impossible chords with a typed error', () => {
    const song = load('simple-open-chords.json');
    const bad = structuredClone(song);
    bad.harmony.chords[0]!.quality = 'augmented';
    expect(() => buildBaseArrangement(bad)).toThrowError(/No built-in shape/);
  });

  it('detects corrupted arrangements', () => {
    const song = load('mixed-beginner-song.json');
    const arr = buildBaseArrangement(song);
    const broken = structuredClone(arr);
    broken.notes[0]!.position.midi = 99; // position no longer matches pitch
    expect(validateArrangement(broken).valid).toBe(false);
    const neg = structuredClone(arr);
    neg.chords[0]!.durationBeats = -1;
    expect(validateArrangement(neg).valid).toBe(false);
    const tempo = structuredClone(arr);
    tempo.tempoFactor = 0;
    expect(validateArrangement(tempo).valid).toBe(false);
  });
});

describe('difficulty ordering', () => {
  const diffOf = (name: string) => {
    const song = load(name);
    const arr = buildBaseArrangement(song);
    return computeDifficulty({ arrangement: arr, song });
  };

  it('open-chord progression easier than barre-heavy progression', () => {
    const open = diffOf('simple-open-chords.json');
    const hard = diffOf('difficult-chords.json');
    expect(hard.chordComplexity).toBeGreaterThan(open.chordComplexity);
    expect(hard.total).toBeGreaterThan(open.total);
  });

  it('slow version easier than fast version (tempoFactor respected)', () => {
    const song = load('difficult-chords.json');
    const base = buildBaseArrangement(song);
    const slow = structuredClone(base);
    slow.tempoFactor = 0.5;
    const dFast = computeDifficulty({ arrangement: base, song });
    const dSlow = computeDifficulty({ arrangement: slow, song });
    expect(dSlow.transitionSpeed).toBeLessThan(dFast.transitionSpeed);
    expect(dSlow.total).toBeLessThan(dFast.total);
    expect(dSlow.total).toBeLessThan(dFast.total);
    // strict ordering 1.0 > 0.7 > 0.5
    const mid = structuredClone(base);
    mid.tempoFactor = 0.7;
    const dMid = computeDifficulty({ arrangement: mid, song });
    expect(dFast.total).toBeGreaterThan(dMid.total);
    expect(dMid.total).toBeGreaterThan(dSlow.total);
  });

  it('sparse melody easier than dense melody', () => {
    const song = load('fast-melody.json');
    const dense = buildBaseArrangement(song);
    const sparse = structuredClone(dense);
    sparse.notes = sparse.notes.filter((_, i) => i % 4 === 0);
    sparse.durationBeats = Math.max(...sparse.notes.map((n) => n.startBeat + n.durationBeats));
    const dDense = computeDifficulty({ arrangement: dense, song });
    const dSparse = computeDifficulty({ arrangement: sparse, song });
    expect(dSparse.noteDensity).toBeLessThan(dDense.noteDensity);
    expect(dSparse.pickingComplexity).toBeLessThan(dDense.pickingComplexity);
    expect(dSparse.total).toBeLessThan(dDense.total);
  });

  it('quarter rhythm easier than sixteenth rhythm', () => {
    const song = load('dense-rhythm.json');
    const dense = buildBaseArrangement(song);
    const quarter = structuredClone(dense);
    quarter.chords = quarter.chords.filter((c) => Number.isInteger(c.startBeat));
    const dDense = computeDifficulty({ arrangement: dense, song });
    const dQuarter = computeDifficulty({ arrangement: quarter, song });
    expect(dQuarter.rhythmComplexity).toBeLessThan(dDense.rhythmComplexity);
    expect(dQuarter.noteDensity).toBeLessThan(dDense.noteDensity);
    expect(dQuarter.total).toBeLessThan(dDense.total);
  });
});
