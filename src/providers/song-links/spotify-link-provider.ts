import {
  type ResolvedSongLink,
  type SongLinkProviderImpl,
} from './song-link-provider.js';

interface SpotifyOEmbed {
  title?: string;
  thumbnail_url?: string;
  /** Official embed HTML, e.g. <iframe src="https://open.spotify.com/embed/track/<id>"> */
  iframe?: string;
}

/**
 * Spotify is identity + playback only: we use the official oEmbed API for
 * metadata and embed playback. No audio is ever downloaded or fed to MIR.
 * Capability is RESEARCHABLE: the browser agent can triangulate the song's
 * musical structure from independent public sources via WebMCP tools.
 */
export class SpotifyLinkProvider implements SongLinkProviderImpl {
  async inspect(url: URL, original: string): Promise<ResolvedSongLink | null> {
    const isSpotify = url.hostname === 'open.spotify.com' || url.hostname === 'spotify.link';
    if (!isSpotify) return null;

    const pathId = url.hostname === 'open.spotify.com' ? (url.pathname.split('/')[2] ?? null) : null;

    let meta: SpotifyOEmbed = {};
    try {
      const res = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(original)}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) meta = (await res.json()) as SpotifyOEmbed;
    } catch {
      // metadata is optional; classification stands without it
    }

    const trackId = pathId ?? /embed\/track\/([0-9A-Za-z]+)/.exec(meta.iframe ?? '')?.[1] ?? null;

    return {
      provider: 'SPOTIFY',
      originalUrl: original,
      ...(trackId !== null ? { canonicalUrl: `https://open.spotify.com/track/${trackId}` } : {}),
      ...(meta.title !== undefined ? { title: meta.title } : {}),
      ...(meta.thumbnail_url !== undefined ? { artworkUrl: meta.thumbnail_url } : {}),
      capability: 'RESEARCHABLE',
      analysisAvailable: false,
      researchAvailable: true,
      reason:
        'We found the song. Spotify does not expose analyzable audio here, so your agent can research its musical structure from independent public sources.',
      sourceId: trackId !== null ? `spotify:${trackId}` : `spotify:url:${original}`,
    };
  }
}
