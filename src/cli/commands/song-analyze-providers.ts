import { Command } from 'commander';
import { runProviderReport } from './song-evaluate-providers.js';

export function registerSongAnalyzeProvidersCommand(song: Command): void {
  song
    .command('analyze-providers')
    .description('Run every analysis provider on a song and report tempo/chords/sections per provider')
    .argument('<songId>')
    .option('--force', 'recompute cached provider results')
    .option('--no-variants', 'skip demixed audio variants')
    .option('--json', 'machine-readable JSON output')
    .action(async (songId: string, opts: { force?: boolean; variants?: boolean; json?: boolean }) => {
      await runProviderReport(songId, null, {
        ...(opts.force !== undefined && { force: opts.force }),
        withVariants: opts.variants !== false,
        json: opts.json === true,
      });
    });
}
