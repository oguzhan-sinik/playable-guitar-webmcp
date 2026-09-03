import { Command } from 'commander';
import { config } from '../../config/env.js';
import { LocalSongRepository } from '../../repositories/song-repository.js';
import { LocalSongGraphRepository } from '../../repositories/song-graph-repository.js';
import {
  benchmarkRhythmForSong,
  formatRhythmBenchmark,
  loadBenchmarkManifest,
  loadReferenceGraph,
  type RhythmBenchmarkRow,
} from '../../application/rhythm-benchmark.js';

export function registerBenchmarkCommand(program: Command): void {
  const benchmark = program.command('benchmark').description('Run local benchmarks (references stay out of inference)');

  benchmark
    .command('rhythm')
    .description('Benchmark rhythm providers against every song in .local-benchmarks/manifest.json')
    .option('--force', 'recompute cached provider results')
    .option('--json', 'machine-readable JSON output')
    .action(async (opts: { force?: boolean; json?: boolean }) => {
      const manifest = await loadBenchmarkManifest();
      if (manifest.songs.length === 0) {
        console.log('No benchmark songs. Add .local-benchmarks/manifest.json:');
        console.log('{ "songs": [ { "songId": "song_xxx", "referenceGraph": "perfect.json" } ] }');
        return;
      }
      const rows: RhythmBenchmarkRow[] = [];
      for (const entry of manifest.songs) {
        let reference;
        try {
          reference = await loadReferenceGraph(entry);
        } catch (err) {
          console.error(`skipping ${entry.songId}: ${(err as Error).message}`);
          continue;
        }
        try {
          // touch the song record; missing local songs are skipped cleanly
          await new LocalSongRepository(config.songsDir).get(entry.songId);
        } catch {
          console.error(`skipping ${entry.songId}: song not ingested locally`);
          continue;
        }
        rows.push(
          ...(await benchmarkRhythmForSong(entry.songId, reference, {
            songs: new LocalSongRepository(config.songsDir),
            graphs: new LocalSongGraphRepository(config.songsDir),
          }, { force: opts.force === true })),
        );
      }
      if (opts.json === true) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      console.log(formatRhythmBenchmark(rows));
    });
}
