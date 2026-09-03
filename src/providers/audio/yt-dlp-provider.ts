import path from 'node:path';
import { AppError } from '../../errors/app-error.js';
import type { AudioDownloader, DownloadedAudio } from './audio-downloader.js';
import { checkBinary, runBinary } from './run-binary.js';

export async function checkYtDlp(): Promise<string> {
  return checkBinary('yt-dlp', ['--version']);
}

// ponytail: title/duration parsed from yt-dlp JSON print; --newline not needed for single URL
export class YtDlpDownloader implements AudioDownloader {
  async download(url: string, outputDir: string): Promise<DownloadedAudio> {
    const outTemplate = path.join(outputDir, 'original.%(ext)s');
    const jsonArgs = [
      '--no-playlist',
      '--print-json',
      '--no-simulate',
      '-f', 'bestaudio',
      '-o', outTemplate,
      url,
    ];
    const stdout = await runBinary('yt-dlp', jsonArgs, 'DOWNLOAD_FAILED');

    let filePath = '';
    let title: string | undefined;
    let artist: string | undefined;
    let durationMs: number | undefined;
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line) as {
          filepath?: string;
          filename?: string;
          _filename?: string;
          title?: string;
          artist?: string;
          uploader?: string;
          duration?: number;
        };
        const out = j.filepath ?? j.filename ?? j._filename;
        if (out) {
          filePath = out;
          title = j.title;
          artist = j.artist ?? j.uploader;
          durationMs = j.duration != null ? Math.round(j.duration * 1000) : undefined;
        }
      } catch {
        // ignore non-JSON lines
      }
    }
    if (!filePath) {
      throw new AppError('DOWNLOAD_FAILED', `yt-dlp did not report an output file for ${url}`);
    }
    return {
      filePath,
      ...(title !== undefined && { title }),
      ...(artist !== undefined && { artist }),
      ...(durationMs !== undefined && { durationMs }),
    };
  }
}
