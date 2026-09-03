import { AppError } from '../../errors/app-error.js';

/**
 * A song the player wants to learn, established by NAME — no link required.
 * A SongRequest is identity INTENT only: it claims nothing about the song's
 * musical structure. Research (SongResearchSession) starts from it, and the
 * RecordingFingerprint fields live on the session's songIdentity.
 */
export interface SongRequest {
  id: string;
  /** Free-text request, e.g. "Perfect by Ed Sheeran". */
  query?: string;
  identity: {
    title: string;
    artist: string;
    album?: string;
    version?: string;
    year?: number;
  };
  createdAt: string;
}

export function createSongRequest(input: {
  query?: unknown;
  title?: unknown;
  artist?: unknown;
  album?: unknown;
  version?: unknown;
  year?: unknown;
}): SongRequest {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const artist = typeof input.artist === 'string' ? input.artist.trim() : '';
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (title.length === 0 && artist.length === 0 && query.length === 0) {
    throw new AppError('DOMAIN_VALIDATION', 'request_song needs at least a song title — "title", "artist" or a free-text "query".');
  }
  // free-text only: parse the conventional "Song by Artist" shape
  let parsedTitle = title;
  let parsedArtist = artist;
  if (parsedTitle.length === 0 && query.length > 0) {
    const byMatch = /^(.+?)\s+by\s+(.+)$/i.exec(query);
    if (byMatch !== null) {
      parsedTitle = byMatch[1]!.trim();
      parsedArtist = byMatch[2]!.trim();
    } else {
      parsedTitle = query;
    }
  }
  return {
    id: `req_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    ...(query.length > 0 && { query }),
    identity: {
      title: parsedTitle.slice(0, 200),
      artist: parsedArtist.slice(0, 200),
      ...(typeof input.album === 'string' && input.album.trim().length > 0 && { album: input.album.trim().slice(0, 200) }),
      ...(typeof input.version === 'string' && input.version.trim().length > 0 && { version: input.version.trim().slice(0, 60) }),
      ...(typeof input.year === 'number' && Number.isInteger(input.year) && input.year > 1900 && input.year < 2100 && { year: input.year }),
    },
    createdAt: new Date().toISOString(),
  };
}
