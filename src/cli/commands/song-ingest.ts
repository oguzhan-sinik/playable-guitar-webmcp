import { Command } from 'commander';
import { config } from '../../config/env.js';
import { ingestSong } from '../../application/ingest-song.js';
import { FfmpegNormalizer } from '../../providers/audio/ffmpeg-provider.js';
import { YtDlpDownloader } from '../../providers/audio/yt-dlp-provider.js';
import { LocalArtifactStore } from '../../storage/local-artifact-store.js';
import { LocalSongRepository } from '../../repositories/song-repository.js';

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function registerSongIngestCommand(song: Command): void {
  song.addCommand(
    new Command('ingest')
      .description('Ingest a local audio file or an http(s) media URL')
      .argument('<source>', 'local file path or URL (only content you have permission to download)')
      .option('--title <title>')
      .option('--artist <artist>')
      .option('--json', 'output machine-readable JSON')
      .action(async (source: string, opts: { title?: string; artist?: string; json?: boolean }) => {
        const result = await ingestSong(
          source,
          {
            ...(opts.title !== undefined && { title: opts.title }),
            ...(opts.artist !== undefined && { artist: opts.artist }),
          },
          {
            downloader: new YtDlpDownloader(),
            normalizer: new FfmpegNormalizer(),
            artifacts: new LocalArtifactStore(config.dataDir),
            songs: new LocalSongRepository(config.songsDir),
            songsDir: config.songsDir,
          },
        );

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        console.log('✓ Imported audio');
        console.log('✓ Normalized audio');
        console.log();
        console.log('Song ID:');
        console.log(result.song.id);
        console.log();
        console.log('Duration:');
        console.log(formatDuration(result.song.durationMs));
        console.log();
        console.log('Source:');
        console.log(result.sourcePath);
        console.log();
        console.log('Analysis audio:');
        console.log(result.analysisPath);
      }),
  );
}
