import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SongGraphSchema, type SongGraph } from '../../src/domain/music/song-graph.js';
import { buildBaseArrangement } from '../../src/engines/arrangement/build-base-arrangement.js';
import { validateArrangement } from '../../src/engines/arrangement/validate-arrangement.js';
import { computeDifficulty } from '../../src/engines/difficulty/arrangement-difficulty.js';
import { computeFidelity } from '../../src/engines/fidelity/arrangement-fidelity.js';
import { TempoReduction } from '../../src/engines/transformations/tempo-reduction.js';
import { FingeringOptimization } from '../../src/engines/transformations/fingering-optimization.js';
import { CapoOptimization } from '../../src/engines/transformations/capo-optimization.js';
import { ChordSimplification } from '../../src/engines/transformations/chord-simplification.js';
import { RhythmSimplification } from '../../src/engines/transformations/rhythm-simplification.js';
import { MelodyReduction } from '../../src/engines/transformations/melody-reduction.js';
import { generateCandidates } from '../../src/engines/transformations/index.js';
import { paretoFilter } from '../../src/engines/arrangement/pareto-filter.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/songgraphs');
const load = (name: string): SongGraph =>
  SongGraphSchema.parse(JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')));

describe('transformation framework', () => {
  it('every operator is pure: input arrangement not mutated', () => {
    const song = load('mixed-beginner-song.json');
    const base = buildBaseArrangement(song);
    const snapshot = JSON.stringify(base);
    const operators = [
      new TempoReduction(), new FingeringOptimization(), new CapoOptimization(),
      new ChordSimplification(), new RhythmSimplification(), new MelodyReduction(),
    ];
    for (const op of operators) op.apply(base, { song });
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('all accepted candidates are valid and not harder', () => {
    for (const fixture of ['mixed-beginner-song.json', 'difficult-chords.json', 'dense-rhythm.json', 'fast-melody.json', 'simple-open-chords.json']) {
      const song = load(fixture);
      const base = buildBaseArrangement(song);
      for (const cand of generateCandidates(base, { song })) {
        const v = validateArrangement(cand);
        expect(v.valid, `${fixture}: ${JSON.stringify(v.errors)}`).toBe(true);
        expect(cand.difficulty!.total).toBeLessThanOrEqual(base.difficulty?.total ?? computeDifficulty({ arrangement: base, song }).total + 0.001);
      }
    }
  });
});

describe('tempo reduction', () => {
  it('symbolic content unchanged, difficulty strictly decreases with factor', () => {
    const song = load('difficult-chords.json');
    const base = buildBaseArrangement(song);
    const results = new TempoReduction().apply(base, { song });
    expect(results.length).toBeGreaterThan(0);
    const byFactor = results.sort((a, b) =>
      (a.transformation.parameters!.factor as number) - (b.transformation.parameters!.factor as number));
    for (const r of results) {
      expect(r.arrangement.chords).toEqual(base.chords); // symbolic content identical
      expect(r.fidelityAfter.total).toBe(1);
    }
    // factors sorted ascending → difficulty strictly ascending
    for (let i = 1; i < byFactor.length; i++) {
      expect(byFactor[i]!.difficultyAfter.total).toBeGreaterThan(byFactor[i - 1]!.difficultyAfter.total);
    }
  });
});

describe('fingering optimization', () => {
  it('keeps notes identical and never increases movement', () => {
    const song = load('fast-melody.json');
    const base = buildBaseArrangement(song);
    const results = new FingeringOptimization().apply(base, { song });
    for (const r of results) {
      expect(r.arrangement.notes.map((n) => [n.midi, n.startBeat]))
        .toEqual(base.notes.map((n) => [n.midi, n.startBeat]));
      expect(r.fidelityAfter.total).toBe(1);
      expect(r.difficultyAfter.total).toBeLessThanOrEqual(r.difficultyBefore.total);
    }
  });
});

describe('capo optimization', () => {
  it('finds easier capo configuration for Bb Eb Gm F with identical sounding harmony', () => {
    const song = load('difficult-chords.json');
    const base = buildBaseArrangement(song);
    const results = new CapoOptimization().apply(base, { song });
    expect(results.length).toBe(1);
    const r = results[0]!;
    // sounding harmony preserved: fidelity (incl. harmony) stays 1
    expect(r.fidelityAfter.harmony).toBe(1);
    expect(r.fidelityAfter.total).toBe(1);
    // easier
    expect(r.difficultyAfter.total).toBeLessThan(r.difficultyBefore.total);
    // capo actually changed and open-family shapes chosen
    expect(r.transformation.parameters!.capo).toBeGreaterThan(0);
    const shapes = new Set(r.arrangement.chords.map((c) => c.shapeName));
    expect(shapes.has('Bb')).toBe(false);
    expect(r.arrangement.tuning.capo).toBe(r.transformation.parameters!.capo);
    // validation clean
    expect(r.validation.valid).toBe(true);
  });

  it('only ever proposes capo configs that preserve sounding harmony', () => {
    const song = load('simple-open-chords.json');
    const base = buildBaseArrangement(song);
    for (const r of new CapoOptimization().apply(base, { song })) {
      expect(r.fidelityAfter.harmony).toBe(1);
      expect(r.fidelityAfter.total).toBe(1);
      expect(r.difficultyAfter.total).toBeLessThan(r.difficultyBefore.total);
    }
  });
});

describe('chord simplification', () => {
  it('F barre → Fmaj7 open grip: valid, easier, controlled fidelity loss', () => {
    const song = load('simple-open-chords.json');
    const base = buildBaseArrangement(song);
    const results = new ChordSimplification().apply(base, { song });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.validation.valid).toBe(true);
      expect(r.difficultyAfter.total).toBeLessThan(r.difficultyBefore.total);
      expect(r.fidelityAfter.total).toBeLessThan(r.fidelityBefore.total);
      expect(r.fidelityAfter.harmony).toBeGreaterThan(0.7); // controlled reduction
    }
  });
});

describe('rhythm simplification', () => {
  it('16ths → 8ths → quarters: fewer events, downbeats kept, easier', () => {
    const song = load('dense-rhythm.json');
    const base = buildBaseArrangement(song);
    const results = new RhythmSimplification().apply(base, { song });
    expect(results.length).toBeGreaterThanOrEqual(2);

    const counts = results.map((r) => r.arrangement.chords.length);
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeLessThan(counts[i - 1]!);
    expect(counts[0]!).toBeLessThan(base.chords.length);

    const downbeats = [0, 4]; // dense-rhythm fixture spans 2 bars
    for (const r of results) {
      const onsets = new Set(r.arrangement.chords.map((c) => c.startBeat));
      const isMerge = r.transformation.parameters!.grid === 'merge';
      if (!isMerge) {
        // grid levels must keep every downbeat
        for (const d of downbeats) expect(onsets.has(d), `missing downbeat ${d}`).toBe(true);
      } else {
        expect(onsets.has(0)).toBe(true); // one event per chord run, starts at song start
      }
      expect(r.difficultyAfter.total).toBeLessThan(r.difficultyBefore.total);
      expect(r.validation.valid).toBe(true);
    }
  });
});

describe('melody reduction', () => {
  it('16-note fixture: counts drop, motif survives, fidelity decreases gradually', () => {
    const song = load('fast-melody.json');
    const base = buildBaseArrangement(song);
    expect(base.notes).toHaveLength(16);
    const results = new MelodyReduction().apply(base, { song }).sort(
      (a, b) => b.arrangement.notes.length - a.arrangement.notes.length,
    );
    expect(results.map((r) => r.arrangement.notes.length)).toEqual([12, 8, 4]);

    const motifIds = new Set(['n0', 'n1', 'n2', 'n3']);
    const fidelities = results.map((r) => {
      const keptSources = r.arrangement.notes.map((n) => n.sourceNoteId);
      for (const id of motifIds) expect(keptSources).toContain(id); // motif notes survive
      expect(r.difficultyAfter.total).toBeLessThan(r.difficultyBefore.total);
      expect(r.validation.valid).toBe(true);
      return r.fidelityAfter.total;
    });
    // gradual decrease as more notes are removed
    expect(fidelities[0]!).toBeGreaterThan(fidelities[1]!);
    expect(fidelities[1]!).toBeGreaterThan(fidelities[2]!);
  });

  it('at 25% density exactly the protected motif notes remain', () => {
    const song = load('fast-melody.json');
    const base = buildBaseArrangement(song);
    const smallest = new MelodyReduction().apply(base, { song })
      .sort((a, b) => a.arrangement.notes.length - b.arrangement.notes.length)[0]!;
    const kept = new Set(smallest.arrangement.notes.map((n) => n.sourceNoteId));
    expect([...kept].sort()).toEqual(['n0', 'n1', 'n2', 'n3']);
  });
});

describe('pareto filter', () => {
  it('removes dominated candidates, keeps trade-offs', () => {
    const song = load('mixed-beginner-song.json');
    const base = buildBaseArrangement(song);
    const score = (a: ReturnType<typeof buildBaseArrangement>, d: number, f: number) => {
      a.difficulty = { ...base.difficulty!, total: d };
      a.fidelity = { ...base.fidelity!, total: f };
      return a;
    };
    const a = score(structuredClone(base), 2, 0.8);   // dominates b
    const b = score(structuredClone(base), 3, 0.75);
    const c = score(structuredClone(base), 4, 0.95);  // trade-off vs a
    const frontier = paretoFilter([a, b, c]);
    expect(frontier).toHaveLength(2);
    expect(frontier.map((x) => x.fidelity!.total).sort()).toEqual([0.8, 0.95]);
  });
});
