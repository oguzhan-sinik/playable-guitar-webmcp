import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { LocalSongRepository } from '../repositories/song-repository.js';
import { LocalSongGraphRepository } from '../repositories/song-graph-repository.js';
import { LocalArtifactStore } from '../storage/local-artifact-store.js';
import { ingestSong } from './ingest-song.js';
import { analyzeSong } from './analyze-song.js';
import { summarizeAnalysis, type AnalysisSummary } from './prepare-arrangement.js';
import { FfmpegNormalizer } from '../providers/audio/ffmpeg-provider.js';
import { YtDlpDownloader } from '../providers/audio/yt-dlp-provider.js';
import type { AudioDownloader } from '../providers/audio/audio-downloader.js';
import type { AudioNormalizer } from '../providers/audio/audio-normalizer.js';
import type { ResolvedSongLink } from '../providers/song-links/song-link-provider.js';
import type { SongGraph } from '../domain/music/song-graph.js';
import { resolveSongLink } from '../providers/song-links/song-link-resolver.js';

/**
 * Link-first ingestion: resolve → (cache) → ingest via the existing
 * downloader/normalizer → analyze → compact result. No agents involved.
 */

export type LoadSongStatus = 'READY' | 'RESEARCHABLE' | 'LOADED_PLAYBACK_ONLY' | 'ANALYZING' | 'FAILED';

export interface LoadSongFromLinkResult {
  songId?: string;
  source: ResolvedSongLink;
  status: LoadSongStatus;
  cached?: boolean;
  analysis?: AnalysisSummary;
  title?: string;
  artist?: string;
  artworkUrl?: string;
  researchAvailable?: boolean;
  nextSuggestedTools?: string[];
}

export interface LoadSongFromLinkDeps {
  downloader?: AudioDownloader;
  normalizer?: AudioNormalizer;
  songsDir?: string;
  dataDir?: string;
  /** Tests inject the fetch used for direct-audio download. */
  fetchFn?: typeof fetch;
  /** Tests inject the analysis step (default: the real multi-provider analyzeSong). */
  analyzeFn?: (songId: string) => Promise<{ graph: SongGraph }>;
  /**
   * HUMAN rights attestation for external-media ingestion (YouTube/direct
   * audio). Must be an explicit request-level choice — agents may not assert
   * it silently. Spotify never needs it (no audio is processed).
   */
  rightsConfirmed?: boolean;
}

interface LinkCacheEntry {
  songId: string;
  sourceId: string;
  cachedAt: string;
}

const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
const DOWNLOAD_TIMEOUT_MS = 60_000;

function cachePath(dataDir: string): string {
  return path.join(dataDir, 'link-cache.json');
}

async function readCache(dataDir: string): Promise<Map<string, LinkCacheEntry>> {
  try {
    const entries = JSON.parse(await readFile(cachePath(dataDir), 'utf8')) as LinkCacheEntry[];
    return new Map(entries.map((e) => [e.sourceId, e]));
  } catch {
    return new Map();
  }
}

async function writeCache(dataDir: string, cache: Map<string, LinkCacheEntry>): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(cachePath(dataDir), JSON.stringify([...cache.values()], null, 2) + '\n');
}

/** Download a direct audio URL with timeout, size cap and content-type validation. */
export async function downloadDirectAudio(
  url: string,
  destDir: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ filePath: string; contentType: string }> {
  const res = await fetchFn(url, { redirect: 'follow', signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!res.ok) throw new AppError('DOWNLOAD_FAILED', `Direct audio download failed with HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') ?? '';
  let finalPathname = url;
  try {
    finalPathname = new URL(res.url).pathname;
  } catch {
    // mocked/redirect-less responses may have no usable final URL
  }
  const webPage = /^(text\/|application\/(json|xml))/.test(contentType);
  const looksAudio =
    !webPage && (/^(audio\/|application\/octet-stream|video\/)/.test(contentType) || /\.(mp3|wav|flac|m4a)$/i.test(finalPathname));
  if (!looksAudio) {
    throw new AppError('UNSUPPORTED_EXTENSION', `URL does not serve audio (content-type "${contentType}")`);
  }
  await mkdir(destDir, { recursive: true });
  const ext = path.extname(finalPathname) || path.extname(url) || '.mp3';
  const filePath = path.join(destDir, `download${ext}`);
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new AppError('DOWNLOAD_FAILED', `Audio too large (limit ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB)`);
  }
  await writeFile(filePath, Buffer.from(body));
  return { filePath, contentType };
}

export async function loadSongFromLink(
  url: string,
  options: { analyze?: boolean } & LoadSongFromLinkDeps = {},
): Promise<LoadSongFromLinkResult> {
  const source = await resolveSongLink(url);
  if (source.capability === 'UNSUPPORTED') {
    throw new AppError('DOMAIN_VALIDATION', `Unsupported song source. ${source.reason ?? ''}`);
  }
  if (source.capability !== 'ANALYZABLE') {
    const researchable = source.researchAvailable === true;
    return {
      source,
      status: researchable ? 'RESEARCHABLE' : 'LOADED_PLAYBACK_ONLY',
      ...(researchable && { researchAvailable: true, nextSuggestedTools: ['begin_song_research'] }),
      ...(source.title !== undefined && { title: source.title }),
      ...(source.artist !== undefined && { artist: source.artist }),
      ...(source.artworkUrl !== undefined && { artworkUrl: source.artworkUrl }),
    };
  }

  const dataDir = options.dataDir ?? config.dataDir;
  const songsDir = options.songsDir ?? config.songsDir;

  // external-media ingestion requires the HUMAN's explicit rights attestation,
  // and is disabled entirely when the deployment sets ALLOW_EXTERNAL_MEDIA_INGEST=false
  const externalMedia = source.provider === 'YOUTUBE' || source.provider === 'DIRECT_AUDIO';
  const ingestAllowed = process.env.ALLOW_EXTERNAL_MEDIA_INGEST !== 'false';
  if (externalMedia && !ingestAllowed) {
    return {
      source,
      status: 'RESEARCHABLE',
      researchAvailable: true,
      nextSuggestedTools: ['begin_song_research'],
      ...(source.title !== undefined && { title: source.title }),
      ...(source.artist !== undefined && { artist: source.artist }),
      ...(source.artworkUrl !== undefined && { artworkUrl: source.artworkUrl }),
    };
  }
  if (externalMedia && options.rightsConfirmed !== true) {
    throw new AppError(
      'RIGHTS_ATTESTATION_REQUIRED',
      'External media can only be processed after the human confirms: "I have permission or other lawful authorization to process this media" (pass rightsConfirmed: true).',
    );
  }

  const sourceId = source.sourceId ?? `url:${createHash('sha256').update(source.originalUrl).digest('hex').slice(0, 16)}`;

  // cache: canonical source identity → song (skip re-download/re-analysis)
  const cache = await readCache(dataDir);
  const cachedSongId = sourceId !== undefined ? cache.get(sourceId)?.songId : undefined;
  if (cachedSongId !== undefined && options.analyze !== false) {
    try {
      const graph = await new LocalSongGraphRepository(songsDir).load(cachedSongId);
      return {
        songId: cachedSongId,
        source,
        status: 'READY',
        cached: true,
        analysis: summarizeAnalysis(graph),
        ...(source.title !== undefined && { title: source.title }),
      };
    } catch {
      // graph missing — fall through and reprocess
    }
  }

  // ingest through the existing stack
  const input = source.provider === 'YOUTUBE' ? source.originalUrl : await downloadToTemp(source, options.fetchFn);
  let result: Awaited<ReturnType<typeof ingestSong>>;
  try {
    result = await ingestSong(
      input,
      {
        ...(source.title !== undefined && { title: source.title }),
        ...(source.artist !== undefined && { artist: source.artist }),
      },
      {
        downloader: options.downloader ?? new YtDlpDownloader(),
        normalizer: options.normalizer ?? new FfmpegNormalizer(),
        artifacts: new LocalArtifactStore(dataDir),
        songs: new LocalSongRepository(songsDir),
        songsDir,
      },
    );
  } finally {
    if (source.provider !== 'YOUTUBE') await rm(input, { force: true });
  }

  const analysisResult =
    options.analyzeFn !== undefined
      ? await options.analyzeFn(result.song.id)
      : await analyzeSong(result.song.id, {
          songs: new LocalSongRepository(songsDir),
          graphs: new LocalSongGraphRepository(songsDir),
        });

  cache.set(sourceId, { songId: result.song.id, sourceId, cachedAt: new Date().toISOString() });
  await writeCache(dataDir, cache);

  return {
    songId: result.song.id,
    source,
    status: 'READY',
    analysis: summarizeAnalysis(analysisResult.graph),
    ...(source.title !== undefined && { title: source.title }),
  };
}

/** Direct-audio sources are fetched over HTTP; YT uses the yt-dlp provider. */
async function downloadToTemp(source: ResolvedSongLink, fetchFn?: typeof fetch): Promise<string> {
  if (source.provider === 'DIRECT_AUDIO') {
    const { filePath } = await downloadDirectAudio(source.originalUrl, path.join(config.dataDir, 'tmp', randomUUID().slice(0, 8)), fetchFn);
    return filePath;
  }
  return source.originalUrl;
}
