import type { SongGraph } from '../../domain/music/song-graph.js';

export interface RecommendedSection {
  type: string;
  startMs: number;
  endMs: number;
}

const PRIORITY = ['CHORUS', 'VERSE', 'BRIDGE', 'INTRO', 'OUTRO'] as const;

const beatToMs = (graph: SongGraph, beat: number): number => {
  const hit = graph.beats.find((b) => b.beat === beat);
  if (hit !== undefined) return hit.timeMs;
  return Math.round((beat / graph.global.bpm) * 60_000);
};

export function recommendFirstSection(graph: SongGraph): RecommendedSection | undefined {
  const known = graph.sections.filter((s) => s.type !== 'UNKNOWN');
  if (known.length === 0) return undefined;

  for (const wanted of PRIORITY) {
    const match = known.find((s) => s.type === wanted);
    if (match !== undefined) {
      return {
        type: match.type,
        startMs: beatToMs(graph, match.startBeat),
        endMs: beatToMs(graph, match.endBeat),
      };
    }
  }

  const first = known[0]!;
  return {
    type: first.type,
    startMs: beatToMs(graph, first.startBeat),
    endMs: beatToMs(graph, first.endBeat),
  };
}

export function formatTimeMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
