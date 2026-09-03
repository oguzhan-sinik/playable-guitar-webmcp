import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import type { FidelityScore } from '../../domain/arrangement/fidelity.js';
import type { SongGraph } from '../../domain/music/song-graph.js';
import { harmonySimilarity } from './harmony-similarity.js';
import { melodySimilarity, effectiveSalience } from './melody-similarity.js';
import { rhythmSimilarity } from './rhythm-similarity.js';
import { motifCoverage } from './motif-coverage.js';
import { DEFAULT_FIDELITY_CONFIG, type FidelityConfig } from './config.js';

export interface FidelityInput {
  arrangement: GuitarArrangement;
  original: SongGraph;
  config?: FidelityConfig;
}

function motifIdsOf(song: SongGraph): (noteId: string) => string[] {
  return (noteId) => song.motifs.filter((m) => m.eventIds.includes(noteId)).map((m) => m.id);
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Compare an arrangement against its source SongGraph. All components 0-1. */
export function computeFidelity({ arrangement, original, config = DEFAULT_FIDELITY_CONFIG }: FidelityInput): FidelityScore {
  const motifLookup = motifIdsOf(original);
  const w = config.weights;

  const harmony = original.harmony.chords.length === 0
    ? 1
    : harmonySimilarity(original.harmony.chords, arrangement.chords);

  const melody = !original.melody || original.melody.notes.length === 0
    ? 1
    : melodySimilarity(original.melody.notes, arrangement.notes, motifLookup);

  const rhythm = original.harmony.chords.length === 0
    ? 1
    : rhythmSimilarity(original.harmony.chords, arrangement.chords);

  const motifs = motifCoverage(original.motifs, arrangement.notes, config);

  const structure = original.sections.length === 0
    ? 1
    : original.sections.filter((sec) => {
        const hasChord = arrangement.chords.some(
          (c) => c.startBeat >= sec.startBeat && c.startBeat < sec.endBeat,
        );
        const hasNote = arrangement.notes.some(
          (n) => n.startBeat >= sec.startBeat && n.startBeat < sec.endBeat,
        );
        return hasChord || hasNote;
      }).length / original.sections.length;

  const total =
    harmony * w.harmony +
    melody * w.melody +
    rhythm * w.rhythm +
    motifs * w.motifCoverage +
    structure * w.structure;

  return {
    total: round3(total),
    harmony: round3(harmony),
    melody: round3(melody),
    rhythm: round3(rhythm),
    motifCoverage: round3(motifs),
    structure: round3(structure),
  };
}

export { effectiveSalience };
