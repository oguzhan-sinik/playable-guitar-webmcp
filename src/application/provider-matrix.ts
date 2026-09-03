import { config } from '../config/env.js';
import type { SongGraph } from '../domain/music/song-graph.js';
import type { AnalysisAudioVariant } from '../domain/analysis/raw-music-analysis.js';
import { analyzeSong, type AnalyzeSongDeps, type AnalyzeOptions } from './analyze-song.js';
import { evaluateGraph, type GraphEvaluation } from '../engines/songgraph/evaluate-graph.js';
import { DEFAULT_ANALYSIS_STRATEGY, type AnalysisStrategyConfig } from '../config/analysis-strategy.js';

export interface MatrixRow {
  name: string;
  strategy: Partial<AnalysisStrategyConfig>;
  graph?: SongGraph;
  error?: string;
  evaluation?: GraphEvaluation;
  runtimeMs?: number;
}

export interface MatrixOptions extends AnalyzeOptions {
  /** Skip separation-dependent rows (e.g. when demixing is unavailable). */
  withVariants?: boolean;
}

const VAR: AnalysisAudioVariant = 'FULL_MIX';

function base(partial: Partial<AnalysisStrategyConfig>): Partial<AnalysisStrategyConfig> {
  return { ...partial };
}

/**
 * Provider comparison matrix (benchmarking, not the production path):
 * each row runs the pipeline under a single-provider (or consensus) strategy
 * and evaluates against the reference graph. Rows never see the reference.
 */
export async function runProviderMatrix(
  songId: string,
  reference: SongGraph,
  deps: AnalyzeSongDeps,
  options: MatrixOptions = {},
): Promise<MatrixRow[]> {
  const withVariants = options.withVariants ?? true;
  const chordVariants: AnalysisAudioVariant[] = withVariants
    ? DEFAULT_ANALYSIS_STRATEGY.chordAudioVariants
    : [VAR];

  const rows: MatrixRow[] = [
    {
      name: 'Essentia (full mix)',
      strategy: base({
        rhythmProviders: ['essentia'],
        chordProviders: ['essentia'],
        useSourceSeparation: false,
        chordAudioVariants: [VAR],
        consensus: { enabled: false },
      }),
    },
    ...['deepchroma', 'cnn-crf'].flatMap((p) => [
      {
        name: `${p} (full mix)`,
        strategy: base({
          rhythmProviders: ['all-in-one'],
          chordProviders: [p],
          useSourceSeparation: false,
          chordAudioVariants: [VAR],
          consensus: { enabled: false },
        }),
      },
      ...(withVariants
        ? [
            {
              name: `${p} (no vocals)`,
              strategy: base({
                rhythmProviders: ['all-in-one'],
                chordProviders: [p],
                useSourceSeparation: true,
                chordAudioVariants: ['NO_VOCALS' as AnalysisAudioVariant],
                consensus: { enabled: false },
              }),
            },
            {
              name: `${p} (harmonic mix)`,
              strategy: base({
                rhythmProviders: ['all-in-one'],
                chordProviders: [p],
                useSourceSeparation: true,
                chordAudioVariants: ['HARMONIC_MIX' as AnalysisAudioVariant],
                consensus: { enabled: false },
              }),
            },
          ]
        : []),
    ]),
    {
      name: 'Consensus (all providers)',
      strategy: base({
        rhythmProviders: DEFAULT_ANALYSIS_STRATEGY.rhythmProviders,
        chordProviders: DEFAULT_ANALYSIS_STRATEGY.chordProviders,
        useSourceSeparation: withVariants,
        chordAudioVariants: chordVariants,
        consensus: { enabled: true },
      }),
    },
  ];

  const results: MatrixRow[] = [];
  for (const row of rows) {
    try {
      const t = Date.now();
      const result = await analyzeSong(songId, deps, { ...options, strategy: row.strategy, saveGraph: false });
      results.push({
        ...row,
        graph: result.graph,
        evaluation: evaluateGraph(result.graph, reference),
        runtimeMs: Date.now() - t,
      });
    } catch (err) {
      results.push({ ...row, error: (err as Error).message });
    }
  }
  return results;
}

export function formatMatrixTable(rows: MatrixRow[]): string {
  const header = 'Provider                    Tempo   Relation   Key     Root Acc   Quality Acc   Coverage   Segments   Frag';
  const lines = [header, '-'.repeat(header.length)];
  for (const row of rows) {
    if (row.error !== undefined || row.evaluation === undefined) {
      lines.push(`${row.name.padEnd(28)}error: ${row.error?.slice(0, 60)}`);
      continue;
    }
    const e = row.evaluation;
    lines.push(
      [
        row.name.padEnd(28),
        e.tempo.detected.toFixed(1).padStart(5),
        e.tempo.metricalRelation.padStart(8),
        (e.key !== null ? (e.key.match ? 'match' : 'no') : '-').padStart(6),
        pct(e.chords.rootAccuracy).padStart(9),
        pct(e.chords.qualityAccuracy).padStart(12),
        pct(e.chords.coverage).padStart(9),
        String(e.chords.detectedChordChanges).padStart(8),
        `${e.chords.fragmentationRatio.toFixed(2)}x`.padStart(6),
      ].join('  '),
    );
  }
  return lines.join('\n');
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
