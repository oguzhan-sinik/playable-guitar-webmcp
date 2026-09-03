import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { AppError } from '../errors/app-error.js';
import { SongGraphSchema, type SongGraph } from '../domain/music/song-graph.js';
import type { AnalyzeSongDeps } from './analyze-song.js';
import { analyzeSong } from './analyze-song.js';
import { evaluateEvents, evaluateMeter } from '../engines/songgraph/evaluate-rhythm.js';

export interface RhythmBenchmarkRow {
  songId: string;
  songTitle: string;
  provider: string;
  bpm: number | null;
  relation: string;
  beatF1: number | null;
  downbeatF1: number | null;
  meter: string;
  error?: string;
  runtimeMs?: number;
}

export interface LocalBenchmarkManifest {
  songs: Array<{ songId: string; referenceGraph: string; title?: string }>;
}

export async function loadBenchmarkManifest(manifestPath?: string): Promise<LocalBenchmarkManifest> {
  const file = manifestPath ?? path.join(process.cwd(), '.local-benchmarks', 'manifest.json');
  try {
    return JSON.parse(await readFile(file, 'utf8')) as LocalBenchmarkManifest;
  } catch {
    return { songs: [] };
  }
}

const meterLabel = (graph: SongGraph): string => {
  const t = graph.global.timeSignature;
  return `${t.numerator}/${t.denominator}`;
};

const relationBetween = (bpm: number, refBpm: number): string => {
  const ratio = bpm / refBpm;
  const targets: Array<[number, string]> = [
    [1, '1:1'], [0.5, '1:2'], [2, '2:1'], [2 / 3, '2:3'], [1.5, '3:2'], [1 / 3, '1:3'], [3, '3:1'],
  ];
  for (const [target, label] of targets) {
    if (Math.abs(ratio - target) < 0.04) return label;
  }
  return 'OTHER';
};

const beatTimes = (graph: SongGraph): number[] => graph.beats.map((b) => b.timeMs / 1000);
const downbeatTimes = (graph: SongGraph): number[] => graph.beats.filter((b) => b.isDownbeat).map((b) => b.timeMs / 1000);

/** Single-provider (or consensus) rhythm benchmark row. Inference never sees
 * the reference; evaluation happens afterwards, on the graph. */
export async function benchmarkRhythmForSong(
  songId: string,
  reference: SongGraph,
  deps: AnalyzeSongDeps,
  options: { force?: boolean; rhythmProviders?: string[] } = {},
): Promise<RhythmBenchmarkRow[]> {
  const providerSets: Array<{ name: string; rhythmProviders: string[]; consensus: boolean }> = [
    ...['beat-this', 'madmom-downbeat', 'madmom-beat', 'all-in-one', 'essentia']
      .filter((p) => options.rhythmProviders === undefined || options.rhythmProviders.includes(p))
      .map((p) => ({ name: p, rhythmProviders: [p], consensus: false })),
    { name: 'consensus', rhythmProviders: options.rhythmProviders ?? ['beat-this', 'madmom-downbeat', 'madmom-beat', 'all-in-one', 'essentia'], consensus: true },
  ];

  const rows: RhythmBenchmarkRow[] = [];
  for (const set of providerSets) {
    try {
      const t = Date.now();
      const result = await analyzeSong(songId, deps, {
        force: options.force === true,
        saveGraph: false,
        strategy: {
          rhythmProviders: set.rhythmProviders,
          chordProviders: [],
          useSourceSeparation: false,
          chordAudioVariants: [],
          consensus: { enabled: false },
          rhythmConsensus: { enabled: set.consensus },
          rhythmWeights: {},
          device: 'cpu',
        },
      });
      const g = result.graph;
      const meterEval = evaluateMeter(g, reference);
      rows.push({
        songId,
        songTitle: g.metadata.title ?? songId,
        provider: set.name,
        bpm: g.global.bpm,
        relation: relationBetween(g.global.bpm, reference.global.bpm),
        beatF1: reference.beats.length > 0 ? evaluateEvents(beatTimes(g), beatTimes(reference)).f1 : null,
        downbeatF1:
          reference.beats.some((b) => b.isDownbeat)
            ? evaluateEvents(downbeatTimes(g), downbeatTimes(reference)).f1
            : null,
        meter: meterEval !== null ? `${meterLabel(g)} (${meterEval.verdict.toLowerCase()} of ${meterLabel(reference)})` : meterLabel(g),
        runtimeMs: Date.now() - t,
      });
    } catch (err) {
      rows.push({
        songId,
        songTitle: songId,
        provider: set.name,
        bpm: null,
        relation: '-',
        beatF1: null,
        downbeatF1: null,
        meter: '-',
        error: (err as Error).message,
      });
    }
  }
  return rows;
}

export function formatRhythmBenchmark(rows: RhythmBenchmarkRow[]): string {
  const header = 'Song'.padEnd(24) + 'Provider'.padEnd(18) + 'BPM'.padStart(7) + '  Relation' + '  BeatF1'.padStart(9) + '  DownF1'.padStart(9) + '  Meter';
  const lines = [header, '-'.repeat(header.length)];
  for (const r of rows) {
    const song = r.songTitle.length > 22 ? `${r.songTitle.slice(0, 21)}…` : r.songTitle;
    if (r.error !== undefined) {
      lines.push(song.padEnd(24) + r.provider.padEnd(18) + `error: ${r.error.slice(0, 60)}`);
      continue;
    }
    lines.push(
      song.padEnd(24) +
        r.provider.padEnd(18) +
        (r.bpm !== null ? r.bpm.toFixed(1).padStart(7) : '-'.padStart(7)) +
        '  ' +
        r.relation.padEnd(9) +
        (r.beatF1 !== null ? r.beatF1.toFixed(2).padStart(9) : '-'.padStart(9)) +
        (r.downbeatF1 !== null ? r.downbeatF1.toFixed(2).padStart(9) : '-'.padStart(9)) +
        '  ' +
        r.meter,
    );
  }
  return lines.join('\n');
}

/** Load one reference graph from the manifest entry. */
export async function loadReferenceGraph(entry: { songId: string; referenceGraph: string }): Promise<SongGraph> {
  const file = path.isAbsolute(entry.referenceGraph)
    ? entry.referenceGraph
    : path.join(process.cwd(), '.local-benchmarks', entry.referenceGraph);
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    throw new AppError('FILE_NOT_FOUND', `Cannot read reference graph ${file}`, { cause: err });
  }
  const parsed = SongGraphSchema.safeParse(json);
  if (!parsed.success) throw new AppError('DOMAIN_VALIDATION', `Invalid reference graph: ${file}`);
  return parsed.data;
}
