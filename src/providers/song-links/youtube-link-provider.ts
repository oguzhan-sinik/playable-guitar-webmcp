import {
  externalMediaIngestAllowed,
  type ResolvedSongLink,
  type SongLinkProviderImpl,
} from './song-link-provider.js';

/** Injectable fetch for the oEmbed metadata lookup (tests). */
let oembedFetch: typeof fetch = fetch;
export function setYoutubeOEmbedFetch(fn: typeof fetch): void {
  oembedFetch = fn;
}

interface YoutubeOEmbed {
  title?: string;
  author_name?: string;
}

/** Reuses the existing yt-dlp download stack for ingest; this provider only classifies + resolves metadata. */
export class YouTubeLinkProvider implements SongLinkProviderImpl {
  async inspect(url: URL, original: string): Promise<ResolvedSongLink | null> {
    const isYoutube =
      (url.hostname === 'youtu.be' && url.pathname.length > 1) ||
      ((url.hostname === 'www.youtube.com' || url.hostname === 'youtube.com' || url.hostname === 'm.youtube.com') &&
        (url.pathname === '/watch' || url.pathname.startsWith('/shorts/')));
    if (!isYoutube) return null;

    const videoId =
      url.hostname === 'youtu.be'
        ? url.pathname.slice(1)
        : url.pathname.startsWith('/shorts/')
          ? url.pathname.split('/')[2]
          : url.searchParams.get('v');
    if (!videoId) return null;

    const allowed = externalMediaIngestAllowed();
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

    if (allowed) {
      return {
        provider: 'YOUTUBE',
        originalUrl: original,
        canonicalUrl,
        capability: 'ANALYZABLE',
        analysisAvailable: true,
        sourceId: `youtube:${videoId}`,
      };
    }

    // ingestion disabled: the song is still RESEARCHABLE — resolve identity via
    // the official oEmbed endpoint so agent research can start immediately.
    let meta: YoutubeOEmbed = {};
    try {
      const res = await oembedFetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) meta = (await res.json()) as YoutubeOEmbed;
    } catch {
      // metadata optional; research can still begin with the video id
    }

    return {
      provider: 'YOUTUBE',
      originalUrl: original,
      canonicalUrl,
      ...(meta.title !== undefined && { title: meta.title }),
      ...(meta.author_name !== undefined && { artist: meta.author_name }),
      capability: 'RESEARCHABLE',
      analysisAvailable: false,
      researchAvailable: true,
      reason:
        'External media ingestion is disabled on this deployment, so the audio cannot be analyzed here. Your agent can research this song from independent public sources instead.',
      sourceId: `youtube:${videoId}`,
    };
  }
}
