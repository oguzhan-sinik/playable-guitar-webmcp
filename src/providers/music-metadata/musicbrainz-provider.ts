/**
 * MusicBrainz identity provider. MusicBrainz knows WHO recorded WHAT — never
 * musical analysis. Used to pin the exact recording (title/artist/duration/
 * ISRC) before any harmony research happens.
 *
 * API etiquette: identifying User-Agent, small limit, in-memory response
 * cache. ponytail: memory cache only; add a disk cache if research sessions
 * get re-begun across restarts often enough to matter.
 */
const MB_BASE = 'https://musicbrainz.org/ws/2';
const USER_AGENT = 'Playable-Guitar-Studio/1.0 (https://github.com/playable-demo; hackathon demo)';
const VARIANT_RE = /\b(live|acoustic|remix|remaster(ed)?|demo|instrumental|karaoke|cover|radio edit|single version|extended)\b/i;

export interface MusicBrainzRecording {
  recordingId: string;
  title: string;
  artist: string;
  durationMs?: number;
  isrc?: string;
  release?: string;
  /** Studio/live/acoustic/remix hint from the title. */
  variantTag?: string;
}

export interface MusicBrainzLookupResult {
  best?: MusicBrainzRecording;
  candidates: MusicBrainzRecording[];
  /** True when multiple plausibly-different versions exist (live vs studio etc). */
  ambiguous: boolean;
}

interface MbRecording {
  id: string;
  title: string;
  length?: number;
  'artist-credit'?: Array<{ name: string; joinphrase?: string }>;
  releases?: Array<{ title: string }>;
  isrcs?: string[];
}

const cache = new Map<string, MusicBrainzLookupResult | null>();

export function clearMusicBrainzCache(): void {
  cache.clear();
}

/** MusicBrainz etiquette: ≥1 request per second, one retry on transient failures. */
let lastRequestAt = 0;
const MIN_REQUEST_INTERVAL_MS = 1100;

async function mbFetch(url: string, fetchFn: typeof fetch): Promise<{ recordings?: MbRecording[] } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    try {
      const res = await fetchFn(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return (await res.json()) as { recordings?: MbRecording[] };
    } catch {
      // transient (throttle/timeout) — fall through to retry
    }
  }
  return null;
}

export async function lookupMusicBrainzRecording(
  query: { title: string; artist?: string },
  fetchFn: typeof fetch = fetch,
): Promise<MusicBrainzLookupResult | null> {
  const key = `${query.artist ?? ''}::${query.title}`.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  const esc = (s: string): string => s.replace(/"/g, '');
  const parts = [`recording:"${esc(query.title)}"`];
  if (query.artist !== undefined && query.artist.length > 0) parts.push(`artist:"${esc(query.artist)}"`);
  const url = `${MB_BASE}/recording?query=${encodeURIComponent(parts.join(' AND '))}&fmt=json&limit=10`;

  // failures are NOT cached: the next research attempt may succeed
  const body = await mbFetch(url, fetchFn);
  if (body === null) return null;

  const recordings = body.recordings ?? [];
  const candidates = recordings.map((r) => {
    const tag = VARIANT_RE.exec(r.title)?.[1]?.toLowerCase();
    return {
      recordingId: r.id,
      title: r.title,
      artist: (r['artist-credit'] ?? []).map((a) => a.name + (a.joinphrase ?? '')).join('').trim(),
      ...(r.length !== undefined && { durationMs: r.length }),
      ...(r.isrcs !== undefined && r.isrcs.length > 0 && { isrc: r.isrcs[0] }),
      ...(r.releases !== undefined && r.releases[0] !== undefined && { release: r.releases[0].title }),
      ...(tag !== undefined && { variantTag: tag }),
    };
  });

  if (candidates.length === 0) return null;

  const best = candidates.reduce((b, c) => {
    const score = (x: MusicBrainzRecording): number =>
      titleSimilarity(x.title, query.title) + (query.artist !== undefined ? titleSimilarity(x.artist, query.artist) : 0);
    return score(c) > score(b) ? c : b;
  }, candidates[0]!);

  const variantTags = new Set(candidates.slice(0, 5).map((c) => c.variantTag ?? 'studio'));
  const ambiguous = variantTags.size > 1;

  const result: MusicBrainzLookupResult = { best, candidates: candidates.slice(0, 5), ambiguous };
  cache.set(key, result);
  return result;
}

/** Dice bigram similarity, case/space-insensitive. 0-1. */
export function titleSimilarity(a: string, b: string): number {
  const norm = (s: string): string => s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const x = norm(a);
  const y = norm(b);
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bigrams = (s: string): Set<string> => new Set([...Array(s.length - 1)].map((_, i) => s.slice(i, i + 2)));
  const bx = bigrams(x);
  const by = bigrams(y);
  let hits = 0;
  for (const g of bx) if (by.has(g)) hits += 1;
  return (2 * hits) / (bx.size + by.size);
}

export interface IdentityConfidence {
  confidence: number;
  exactIsrc: boolean;
  durationClose: boolean;
}

/**
 * Identity confidence from title/artist/duration/ISRC agreement between two
 * identity readings (e.g. Spotify metadata vs MusicBrainz).
 */
export function identityConfidence(
  a: { title: string; artist: string; durationSeconds?: number },
  b: { title: string; artist: string; durationMs?: number; isrc?: string },
): IdentityConfidence {
  const title = titleSimilarity(a.title, b.title);
  const artist = titleSimilarity(a.artist, b.artist);
  const durationClose =
    a.durationSeconds !== undefined && b.durationMs !== undefined
      ? Math.abs(a.durationSeconds * 1000 - b.durationMs) < 4000
      : false;
  const confidence = 0.4 * title + 0.35 * artist + (durationClose ? 0.2 : 0);
  return { confidence, exactIsrc: false, durationClose };
}
