import type { SongGraph } from '../domain/music/song-graph.js';
import type { SongRepository } from '../repositories/song-repository.js';
import type { SongGraphRepository } from '../repositories/song-graph-repository.js';
import { buildBaseArrangement } from '../engines/arrangement/build-base-arrangement.js';
import { computeDifficulty } from '../engines/difficulty/arrangement-difficulty.js';
import { computeFidelity } from '../engines/fidelity/arrangement-fidelity.js';
import { generateCandidates } from '../engines/transformations/index.js';
import { paretoFilter } from '../engines/arrangement/pareto-filter.js';
import type { GuitarArrangement } from '../domain/arrangement/arrangement.js';
import type { AnalysisWarning } from '../domain/analysis/raw-music-analysis.js';

export interface PrepareSongDeps {
  songs: SongRepository;
  graphs: SongGraphRepository;
}

export interface PreparedSong {
  song: SongGraph;
  base: GuitarArrangement;
  frontier: GuitarArrangement[];
  warnings: AnalysisWarning[];
}

/**
 * graph.json -> base arrangement -> difficulty/fidelity -> simplification
 * candidates -> Pareto frontier. Reuses the existing engines; nothing here
 * duplicates arrangement logic.
 */
export async function prepareSong(songId: string, deps: PrepareSongDeps): Promise<PreparedSong> {
  const song = await deps.graphs.load(songId);
  await deps.songs.get(songId); // ensure the song record exists

  const base = buildBaseArrangement(song);
  base.difficulty = computeDifficulty({ arrangement: base, song });
  base.fidelity = computeFidelity({ arrangement: base, original: song });

  const candidates = generateCandidates(base, { song });
  const frontier = paretoFilter(candidates);

  const warnings: AnalysisWarning[] = [];
  const conf = song.confidence;
  warnings.push({
    code: 'ANALYSIS_CONFIDENCE',
    message: `Overall analysis confidence ${(conf.overall * 100).toFixed(0)}% — detected, not transcribed, chords`,
  });
  if (song.sections.every((s) => s.type === 'UNKNOWN')) {
    warnings.push({ code: 'SECTION_UNKNOWN', message: 'Structure not analyzed; only unknown sections' });
  }

  return { song, base, frontier, warnings };
}
