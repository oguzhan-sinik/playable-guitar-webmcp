import { createHash } from 'node:crypto';
import {
  type ResolvedSongLink,
  type SongLinkProviderImpl,
} from './song-link-provider.js';

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.m4a'];

/** Direct links to audio files are analyzed via normal HTTP download + the existing ingestion flow. */
export class DirectAudioLinkProvider implements SongLinkProviderImpl {
  inspect(url: URL, original: string): ResolvedSongLink | null {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const ext = url.pathname.slice(url.pathname.lastIndexOf('.')).toLowerCase();
    if (!AUDIO_EXTENSIONS.includes(ext)) return null;

    return {
      provider: 'DIRECT_AUDIO',
      originalUrl: original,
      canonicalUrl: original,
      title: decodeURIComponent(url.pathname.split('/').pop() ?? 'Direct audio').replace(new RegExp(`${ext}$`, 'i'), ''),
      capability: 'ANALYZABLE',
      analysisAvailable: true,
      sourceId: `direct:${createHash('sha256').update(url.href).digest('hex').slice(0, 16)}`,
    };
  }
}
