/**
 * Song link domain: URL classification and source capabilities.
 * Providers are pure classification/metadata — downloading belongs to the
 * existing AudioDownloader / ingestion stack.
 */

export type SongLinkProvider = 'YOUTUBE' | 'SPOTIFY' | 'DIRECT_AUDIO' | 'UNKNOWN';

export type SongSourceCapability = 'ANALYZABLE' | 'RESEARCHABLE' | 'IDENTITY_ONLY' | 'PLAYBACK_ONLY' | 'UNSUPPORTED';

export interface ResolvedSongLink {
  provider: SongLinkProvider;
  originalUrl: string;
  canonicalUrl?: string;
  title?: string;
  artist?: string;
  artworkUrl?: string;
  capability: SongSourceCapability;
  analysisAvailable: boolean;
  /** Evidence-based multi-source research can resolve this song's structure. */
  researchAvailable?: boolean;
  reason?: string;
  /** Stable source identity for caching (e.g. "youtube:<videoId>"). */
  sourceId?: string;
}

/** A song may bind different sources for identity, analysis and playback. */
export interface SongSources {
  identitySource?: ResolvedSongLink;
  analysisSource?: ResolvedSongLink;
  playbackSource?: ResolvedSongLink;
}

export interface SongLinkProviderImpl {
  /** Return a resolved link if this provider handles the URL, else null. */
  inspect(url: URL, original: string): Promise<ResolvedSongLink | null> | ResolvedSongLink | null;
}

/**
 * External media ingestion is a deployment decision: when disabled, sources
 * still resolve for metadata/playback but are not analyzed. Never bypasses
 * DRM or login; downloads only via the existing yt-dlp/HTTP stack for
 * content the operator is permitted to process.
 */
export function externalMediaIngestAllowed(): boolean {
  return process.env.ALLOW_EXTERNAL_MEDIA_INGEST === 'true';
}
