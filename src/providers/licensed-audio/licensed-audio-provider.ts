import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { LocalSongRepository } from '../../repositories/song-repository.js';
import { LocalSongGraphRepository } from '../../repositories/song-graph-repository.js';
import { LocalArtifactStore } from '../../storage/local-artifact-store.js';
import { ingestSong } from '../../application/ingest-song.js';
import { analyzeSong } from '../../application/analyze-song.js';
import { downloadDirectAudio } from '../../application/load-song-from-link.js';
import { summarizeAnalysis, type AnalysisSummary } from '../../application/prepare-arrangement.js';
import { FfmpegNormalizer } from '../audio/ffmpeg-provider.js';

/**
 * Licensed / artist-authorized audio catalog (Jamendo). Gives a legally clean
 * path: real artist-made track → authorized download → existing MIR → real
 * guitar compilation. Only audiodownload_allowed tracks are ever ingested,
 * and WHY we were allowed is persisted next to the song.
 */
const JAMENDO_BASE = 'https://api.jamendo.com/v3.0';

export interface LicensedTrack {
  trackId: string;
  title: string;
  artist: string;
  durationSeconds: number;
  audiodownloadAllowed: boolean;
  audiodownloadUrl?: string;
  licenseUrl?: string;
  sourceUrl: string;
}

export interface LicensedIngestResult {
  songId: string;
  status: 'READY';
  analysis: AnalysisSummary;
  license: {
    provider: 'JAMENDO';
    trackId: string;
    sourceUrl: string;
    artist: string;
    audiodownloadAllowed: boolean;
    licenseUrl?: string;
  };
}

export function jamendoClientId(): string | undefined {
  return process.env.JAMENDO_CLIENT_ID;
}

export async function searchLicensedTracks(
  query: { title?: string; artist?: string; query?: string },
  opts: { clientID?: string; fetchFn?: typeof fetch } = {},
): Promise<LicensedTrack[]> {
  const clientId = opts.clientID ?? jamendoClientId();
  if (clientId === undefined || clientId.length === 0) {
    throw new AppError('DOMAIN_VALIDATION', 'JAMENDO_CLIENT_ID is not configured — licensed catalog search is unavailable.');
  }
  const text = query.query ?? [query.artist, query.title].filter(Boolean).join(' ');
  if (text.trim().length === 0) {
    throw new AppError('DOMAIN_VALIDATION', 'Provide a search query (query, title, or artist).');
  }
  const url = `${JAMENDO_BASE}/tracks/?client_id=${encodeURIComponent(clientId)}&format=json&limit=10&search=${encodeURIComponent(text)}&include=musicinfo+licenses`;
  let body: { results?: Array<Record<string, unknown>> };
  try {
    const res = await (opts.fetchFn ?? fetch)(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new AppError('DOWNLOAD_FAILED', `Jamendo search failed with HTTP ${res.status}`);
    body = (await res.json()) as { results?: Array<Record<string, unknown>> };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('DOWNLOAD_FAILED', `Jamendo search failed: ${(err as Error).message}`);
  }
  return (body.results ?? []).map((r) => {
    const license = r.license as { ccurl?: string } | undefined;
    return {
      trackId: String(r.id),
      title: String(r.name ?? ''),
      artist: String((r.artist as { name?: string } | undefined)?.name ?? ''),
      durationSeconds: typeof r.duration === 'string' ? Number(r.duration) : (r.duration as number | undefined) ?? 0,
      audiodownloadAllowed: r.audiodownload_allowed === true,
      ...(typeof r.audiodownload === 'string' && { audiodownloadUrl: r.audiodownload }),
      ...(license?.ccurl !== undefined && { licenseUrl: license.ccurl }),
      sourceUrl: String(r.shareurl ?? r.audio ?? ''),
    };
  });
}

/** Ingest a download-authorized Jamendo track through the EXISTING stack. */
export async function loadLicensedTrack(
  trackId: string,
  opts: { clientID?: string; fetchFn?: typeof fetch; songsDir?: string; dataDir?: string; analyze?: boolean } = {},
): Promise<LicensedIngestResult> {
  const clientId = opts.clientID ?? jamendoClientId();
  if (clientId === undefined || clientId.length === 0) {
    throw new AppError('DOMAIN_VALIDATION', 'JAMENDO_CLIENT_ID is not configured — licensed catalog ingestion is unavailable.');
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const metaUrl = `${JAMENDO_BASE}/tracks/?client_id=${encodeURIComponent(clientId)}&format=json&id=${encodeURIComponent(trackId)}&include=musicinfo+licenses`;
  const res = await fetchFn(metaUrl, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new AppError('DOWNLOAD_FAILED', `Jamendo track lookup failed with HTTP ${res.status}`);
  const body = (await res.json()) as { results?: Array<Record<string, unknown>> };
  const track = body.results?.[0];
  if (track === undefined) throw new AppError('FILE_NOT_FOUND', `Jamendo track ${trackId} not found.`);

  // ONLY explicit download authorization permits ingestion
  if (track.audiodownload_allowed !== true || typeof track.audiodownload !== 'string') {
    throw new AppError('DOMAIN_VALIDATION', 'This track does not permit audio download — it will not be ingested.');
  }

  const dataDir = opts.dataDir ?? config.dataDir;
  const songsDir = opts.songsDir ?? config.songsDir;
  const artist = String((track.artist as { name?: string } | undefined)?.name ?? '');
  const title = String(track.name ?? trackId);
  const license = {
    provider: 'JAMENDO' as const,
    trackId: String(track.id),
    sourceUrl: String(track.shareurl ?? `https://www.jamendo.com/track/${track.id}`),
    artist,
    audiodownloadAllowed: true,
    ...(typeof (track.license as { ccurl?: string } | undefined)?.ccurl === 'string' && {
      licenseUrl: (track.license as { ccurl: string }).ccurl,
    }),
  };

  const { filePath } = await downloadDirectAudio(
    track.audiodownload,
    path.join(dataDir, 'tmp', `jamendo-${track.id}`),
    fetchFn,
  );
  let songId: string;
  try {
    const ingested = await ingestSong(
      filePath,
      { title, ...(artist.length > 0 && { artist }) },
      {
        // audio is already downloaded above; ingestSong treats the local path
        // as a 'local' source and imports it directly
        downloader: { download: async () => ({ filePath }) },
        normalizer: new FfmpegNormalizer(),
        artifacts: new LocalArtifactStore(dataDir),
        songs: new LocalSongRepository(songsDir),
        songsDir,
      },
    );
    songId = ingested.song.id;
  } finally {
    const { rm } = await import('node:fs/promises');
    await rm(filePath, { force: true });
  }

  if (opts.analyze !== false) {
    await analyzeSong(songId, { songs: new LocalSongRepository(songsDir), graphs: new LocalSongGraphRepository(songsDir) });
  }

  // persist WHY we were allowed to process this audio
  const provenanceDir = path.join(dataDir, 'licensed-ingest');
  await mkdir(provenanceDir, { recursive: true });
  await writeFile(path.join(provenanceDir, `${songId}.json`), JSON.stringify({ songId, ...license, ingestedAt: new Date().toISOString() }, null, 2) + '\n');

  const graph = await new LocalSongGraphRepository(songsDir).load(songId);
  return { songId, status: 'READY', analysis: summarizeAnalysis(graph), license };
}
