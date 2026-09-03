import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { config } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { SongGraphSchema, type SongGraph } from '../../domain/music/song-graph.js';
import { LocalSongRepository } from '../../repositories/song-repository.js';
import { LocalSongGraphRepository } from '../../repositories/song-graph-repository.js';
import { DemucsStemSeparationProvider } from '../../providers/music-analysis/registry.js';
import { runProviderMatrix, formatMatrixTable, type MatrixRow } from '../../application/provider-matrix.js';

/** Shared implementation for `analyze-providers` (no reference) and
 * `evaluate-providers` (with reference scoring). */
export async function runProviderReport(
  songId: string,
  referencePath: string | null,
  opts: { force?: boolean; withVariants?: boolean; json?: boolean },
): Promise<MatrixRow[]> {
  let reference: SongGraph | null = null;
  if (referencePath !== null) {
    let refJson: unknown;
    try {
      refJson = JSON.parse(await readFile(referencePath, 'utf8'));
    } catch (err) {
      throw new AppError('FILE_NOT_FOUND', `Cannot read reference graph: ${referencePath}`, { cause: err });
    }
    const parsed = SongGraphSchema.safeParse(refJson);
    if (!parsed.success) {
      throw new AppError('DOMAIN_VALIDATION', `Not a valid SongGraph: ${referencePath}`);
    }
    reference = parsed.data as SongGraph;
  }

  const rows = await runProviderMatrix(
    songId,
    // placeholder reference when none given; matrix rows that evaluate will be skipped
    reference ?? placeholderGraph(songId),
    {
      songs: new LocalSongRepository(config.songsDir),
      graphs: new LocalSongGraphRepository(config.songsDir),
      stems: new DemucsStemSeparationProvider(),
    },
    { force: opts.force === true, ...(opts.withVariants !== undefined && { withVariants: opts.withVariants }) },
  );

  if (opts.json) {
    console.log(
      JSON.stringify(
        rows.map((r) => ({
          name: r.name,
          ...(r.error !== undefined && { error: r.error }),
          ...(r.graph !== undefined && {
            bpm: r.graph.global.bpm,
            key: r.graph.global.key ?? null,
            beats: r.graph.beats.length,
            sections: r.graph.sections.map((s) => s.type),
            chordEvents: r.graph.harmony.chords.length,
          }),
          ...(r.evaluation !== undefined && reference !== null && { evaluation: r.evaluation }),
          ...(r.runtimeMs !== undefined && { runtimeMs: r.runtimeMs }),
        })),
        null,
        2,
      ),
    );
    return rows;
  }

  console.log('Provider matrix');
  console.log();
  if (reference !== null) {
    console.log(formatMatrixTable(rows));
  } else {
    for (const r of rows) {
      console.log(r.name);
      if (r.error !== undefined) {
        console.log(`  error: ${r.error}`);
        continue;
      }
      const g = r.graph!;
      console.log(`  BPM: ${g.global.bpm.toFixed(1)}  key: ${g.global.key ?? '?'}`);
      console.log(`  beats: ${g.beats.length} (downbeats ${g.beats.filter((b) => b.isDownbeat).length})`);
      console.log(`  chord events: ${g.harmony.chords.length}`);
      console.log(`  sections: ${g.sections.map((s) => s.type).join(' -> ')}`);
      console.log();
    }
  }
  return rows;
}

function placeholderGraph(songId: string): SongGraph {
  return {
    id: songId,
    metadata: { durationMs: 0 },
    global: { bpm: 1, timeSignature: { numerator: 4, denominator: 4, confidence: 0, source: 'DEFAULT' }, tuningReferenceHz: 440 },
    beats: [],
    sections: [],
    harmony: { chords: [] },
    motifs: [],
    confidence: { overall: 0 },
  };
}

export function registerSongEvaluateProvidersCommand(song: Command): void {
  song
    .command('evaluate-providers')
    .description('(dev/benchmark) Run the provider matrix and score against a reference graph')
    .argument('<songId>')
    .argument('<referenceGraphJson>')
    .option('--force', 'recompute cached provider results')
    .option('--no-variants', 'skip demixed audio variants')
    .option('--json', 'machine-readable JSON output')
    .action(async (songId: string, referencePath: string, opts: { force?: boolean; variants?: boolean; json?: boolean }) => {
      await runProviderReport(songId, referencePath, {
        ...(opts.force !== undefined && { force: opts.force }),
        withVariants: opts.variants !== false,
        json: opts.json === true,
      });
    });
}
