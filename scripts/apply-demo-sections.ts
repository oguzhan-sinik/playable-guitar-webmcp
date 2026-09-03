import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config/env.js';
import type { SongGraph } from '../src/domain/music/song-graph.js';

/**
 * Stamps the demo fixture's compositional structure (known by construction
 * from scripts/gen-demo-song.ts) onto the analyzed SongGraph. This is
 * authored ground truth from the composer, NOT a MIR output — the graph's
 * provenance stays intact and sections are marked confidence 1.
 *
 *   pnpm exec tsx scripts/apply-demo-sections.ts <songId>
 */

const STRUCTURE: Array<{ type: string; bars: number; importance: number }> = [
  { type: 'INTRO', bars: 4, importance: 0.3 },
  { type: 'VERSE', bars: 8, importance: 0.7 },
  { type: 'CHORUS', bars: 8, importance: 1 },
  { type: 'BRIDGE', bars: 8, importance: 0.6 },
  { type: 'CHORUS', bars: 8, importance: 1 },
  { type: 'OUTRO', bars: 4, importance: 0.3 },
];
const BAR_SECONDS = (6 * 60) / 63; // 6/8 at 63 BPM, as synthesized

const songId = process.argv[2];
if (songId === undefined) throw new Error('usage: tsx scripts/apply-demo-sections.ts <songId>');

const file = path.join(config.songsDir, songId, 'graph.json');
const graph = JSON.parse(await readFile(file, 'utf8')) as SongGraph;
const beatIds = graph.beats.map((b) => b.beat);
const lastBeat = beatIds[beatIds.length - 1] ?? 0;
const lastTimeMs = graph.beats[graph.beats.length - 1]?.timeMs ?? graph.metadata.durationMs;
const beatsPerSecond = lastTimeMs > 0 ? lastBeat / (lastTimeMs / 1000) : 0;
if (beatsPerSecond === 0) throw new Error('graph has no beats');

const nearestBeat = (seconds: number): number => {
  const target = seconds * beatsPerSecond;
  return beatIds.reduce((best, b) => (Math.abs(b - target) < Math.abs(best - target) ? b : best), beatIds[0]!);
};

let bar = 0;
graph.sections = [];
for (const part of STRUCTURE) {
  const startBeat = nearestBeat(bar * BAR_SECONDS);
  bar += part.bars;
  const endBeat = nearestBeat(bar * BAR_SECONDS);
  graph.sections.push({
    id: `section_${graph.sections.length}`,
    type: part.type as SongGraph['sections'][number]['type'],
    startBeat,
    endBeat,
    confidence: 1,
    importance: part.importance,
  });
}

await writeFile(file, JSON.stringify(graph, null, 2) + '\n');
console.log(
  `stamped ${graph.sections.length} authored sections onto ${songId}:`,
  graph.sections.map((s) => `${s.type}@${s.startBeat}-${s.endBeat}`).join(' '),
);
