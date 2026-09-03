import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SongGraphSchema, type SongGraph } from '../../src/domain/music/song-graph.js';
import { buildBaseArrangement } from '../../src/engines/arrangement/build-base-arrangement.js';
import { computeFidelity } from '../../src/engines/fidelity/arrangement-fidelity.js';
import { chordSimilarity } from '../../src/engines/fidelity/harmony-similarity.js';
import type { ChordEvent } from '../../src/domain/music/chord.js';
import type { GuitarArrangement } from '../../src/domain/arrangement/arrangement.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/songgraphs');
const load = (name: string): SongGraph =>
  SongGraphSchema.parse(JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8')));

const fidelityOf = (arr: GuitarArrangement, song: SongGraph) =>
  computeFidelity({ arrangement: arr, original: song });

describe('fidelity engine', () => {
  it('base arrangement of the source graph has fidelity 1.0', () => {
    const song = load('mixed-beginner-song.json');
    expect(fidelityOf(buildBaseArrangement(song), song).total).toBe(1);
  });

  it('identical symbolic content stays at 1.0 even at reduced tempo', () => {
    const song = load('mixed-beginner-song.json');
    const arr = buildBaseArrangement(song);
    arr.tempoFactor = 0.5;
    expect(fidelityOf(arr, song).total).toBe(1);
  });

  it('removing a passing note costs little; motif notes cost more', () => {
    const song = load('mixed-beginner-song.json');
    const arr = buildBaseArrangement(song);
    const full = fidelityOf(arr, song).total;

    const dropPassing = structuredClone(arr);
    dropPassing.notes = dropPassing.notes.filter((n) => n.sourceNoteId !== 'n10');
    const dropMotif = structuredClone(arr);
    dropMotif.notes = dropMotif.notes.filter((n) => n.sourceNoteId !== 'n0');

    const fPassing = fidelityOf(dropPassing, song).total;
    const fMotif = fidelityOf(dropMotif, song).total;
    expect(fPassing).toBeLessThan(full);
    expect(fMotif).toBeLessThan(fPassing);
  });

  it('Cmaj7 → C has high-but-not-perfect harmony fidelity; C → F# very low', () => {
    const chord = (root: ChordEvent['root'], quality: ChordEvent['quality']): ChordEvent => ({
      startBeat: 0, durationBeats: 4, root, quality, confidence: 1,
    });
    // Cmaj7 vs C: 3 of 4 pitch classes shared
    const maj7Sim = chordSimilarity(chord('C', 'major7'), chord('C', 'major'));
    expect(maj7Sim).toBeGreaterThan(0.7);
    expect(maj7Sim).toBeLessThan(1);
    // C vs F#: no common tones
    expect(chordSimilarity(chord('C', 'major'), chord('F#', 'major'))).toBe(0);
  });
});
