import { DirectAudioLinkProvider } from './direct-audio-link-provider.js';
import { SpotifyLinkProvider } from './spotify-link-provider.js';
import { YouTubeLinkProvider } from './youtube-link-provider.js';
import type { ResolvedSongLink, SongLinkProviderImpl } from './song-link-provider.js';

const PROVIDERS: SongLinkProviderImpl[] = [
  new YouTubeLinkProvider(),
  new SpotifyLinkProvider(),
  new DirectAudioLinkProvider(),
];

/**
 * Central entry point: application code calls resolveSongLink(url) and never
 * parses provider-specific URL shapes itself (WebMCP callbacks included).
 */
export async function resolveSongLink(url: string): Promise<ResolvedSongLink> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      provider: 'UNKNOWN',
      originalUrl: url,
      capability: 'UNSUPPORTED',
      analysisAvailable: false,
      reason: 'That does not look like a song URL.',
    };
  }

  for (const provider of PROVIDERS) {
    const resolved = await provider.inspect(parsed, url);
    if (resolved !== null) return resolved;
  }

  return {
    provider: 'UNKNOWN',
    originalUrl: url,
    canonicalUrl: url,
    capability: 'UNSUPPORTED',
    analysisAvailable: false,
    reason: 'Unsupported source. Use a YouTube, Spotify, or direct audio (.mp3/.wav/.flac/.m4a) link.',
  };
}
