import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { detectSourceType, validateUrl } from '../domain/song/audio-source.js';
import type { Song } from '../domain/song/song.js';
import { importLocalFile } from '../providers/audio/local-audio-provider.js';
import type { AudioDownloader } from '../providers/audio/audio-downloader.js';
import type { AudioNormalizer } from '../providers/audio/audio-normalizer.js';
import type { ArtifactStore } from '../storage/artifact-store.js';
import type { SongRepository } from '../repositories/song-repository.js';
import { newSongId } from '../utils/ids.js';
import { logger } from '../utils/logger.js';

export interface IngestDeps {
  downloader: AudioDownloader;
  normalizer: AudioNormalizer;
  artifacts: ArtifactStore;
  songs: SongRepository;
  songsDir: string;
}

export interface IngestResult {
  song: Song;
  sourcePath: string;
  analysisPath: string;
}

export async function ingestSong(
  input: string,
  meta: { title?: string; artist?: string },
  deps: IngestDeps,
): Promise<IngestResult> {
  const id = newSongId();
  const songDir = path.join(deps.songsDir, id);
  await deps.artifacts.put(id, '.keep', ''); // ensure song dir exists

  const type = detectSourceType(input);

  // 1. acquire source
  let sourcePath: string;
  let source: Song['source'];
  let title = meta.title;
  let artist = meta.artist;
  let durationMs: number | undefined;

  if (type === 'local') {
    sourcePath = await importLocalFile(input, songDir);
    source = { type: 'local', original: path.resolve(input) };
  } else {
    validateUrl(input);
    const downloaded = await deps.downloader.download(input, songDir);
    sourcePath = downloaded.filePath;
    title = title ?? downloaded.title;
    artist = artist ?? downloaded.artist;
    durationMs = downloaded.durationMs;
    source = { type: 'url', url: input };
  }

  logger.info('source acquired', { id, sourcePath });

  // 2. normalize to WAV 44.1kHz PCM alongside source, then move into audio/
  const normalized = await deps.normalizer.normalize(sourcePath);
  const analysisRef = await deps.artifacts.put(
    id,
    'audio/analysis.wav',
    await readFile(normalized.filePath),
  );
  await rm(normalized.filePath); // temp file from normalizer, now stored as artifact
  durationMs = normalized.durationMs;

  // 3. build + save song record
  const song: Song = {
    id,
    title: title ?? path.basename(input, path.extname(input)),
    ...(artist ? { artist } : {}),
    source,
    durationMs,
    createdAt: new Date().toISOString(),
  };
  await deps.songs.save(song);
  logger.info('song ingested', { id });

  return {
    song,
    sourcePath: path.join('songs', id, 'source', path.basename(sourcePath)),
    analysisPath: analysisRef.relativePath,
  };
}
