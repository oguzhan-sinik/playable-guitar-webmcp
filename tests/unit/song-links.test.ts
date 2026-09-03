import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveSongLink } from '../../src/providers/song-links/song-link-resolver.js';
import { setYoutubeOEmbedFetch } from '../../src/providers/song-links/youtube-link-provider.js';
import { loadSongFromLink, downloadDirectAudio } from '../../src/application/load-song-from-link.js';
import { externalMediaIngestAllowed } from '../../src/providers/song-links/song-link-provider.js';
import type { AudioDownloader, DownloadedAudio } from '../../src/providers/audio/audio-downloader.js';
import type { AudioNormalizer, NormalizedAudio } from '../../src/providers/audio/audio-normalizer.js';
import type { SongGraph } from '../../src/domain/music/song-graph.js';

/** Default: no oEmbed metadata available (offline) — overrides per test. */
beforeEach(() => {
  setYoutubeOEmbedFetch((async () => new Response('{}', { status: 404 })) as unknown as typeof fetch);
});
afterEach(() => {
  // restore real fetch for anything else in the file
  setYoutubeOEmbedFetch(fetch);
});

const FAKE_GRAPH = {
  id: 'placeholder',
  metadata: { title: 'Test Song', durationMs: 1000 },
  global: { bpm: 100, timeSignature: { numerator: 4, denominator: 4, confidence: 1 }, tuningReferenceHz: 440 },
  beats: [],
  sections: [],
  harmony: { chords: [] },
  motifs: [],
  confidence: { overall: 1 },
} as unknown as SongGraph;

describe('url classification', () => {
  it('classifies YouTube urls', async () => {
    const link = await resolveSongLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(link.provider).toBe('YOUTUBE');
    expect(link.sourceId).toBe('youtube:dQw4w9WgXcQ');
    expect(link.canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    const short = await resolveSongLink('https://youtu.be/dQw4w9WgXcQ');
    expect(short.provider).toBe('YOUTUBE');
    expect(short.sourceId).toBe('youtube:dQw4w9WgXcQ'); // canonical identity, different url shape

    const shorts = await resolveSongLink('https://www.youtube.com/shorts/abc123');
    expect(shorts.provider).toBe('YOUTUBE');
    expect(shorts.sourceId).toBe('youtube:abc123');
  });

  it('classifies Spotify urls', async () => {
    const link = await resolveSongLink('https://open.spotify.com/track/4PTG3Z6ehGkBF3zI7YiWsC');
    expect(link.provider).toBe('SPOTIFY');
    expect(link.capability).toBe('RESEARCHABLE');
    expect(link.researchAvailable).toBe(true);
    expect(link.analysisAvailable).toBe(false);
  });

  it('classifies direct audio urls', async () => {
    const link = await resolveSongLink('https://example.com/music/song.mp3');
    expect(link.provider).toBe('DIRECT_AUDIO');
    expect(link.capability).toBe('ANALYZABLE');
  });

  it('rejects random web pages as UNSUPPORTED', async () => {
    const link = await resolveSongLink('https://example.com/blog/post');
    expect(link.provider).toBe('UNKNOWN');
    expect(link.capability).toBe('UNSUPPORTED');
  });

  it('never throws on garbage input', async () => {
    const link = await resolveSongLink('not a url');
    expect(link.capability).toBe('UNSUPPORTED');
  });
});

describe('ingest gating', () => {
  beforeEach(() => {
    delete process.env.ALLOW_EXTERNAL_MEDIA_INGEST;
  });
  afterEach(() => {
    delete process.env.ALLOW_EXTERNAL_MEDIA_INGEST;
  });

  it('is off by default', () => {
    expect(externalMediaIngestAllowed()).toBe(false);
  });

  it('youtube links resolve playback-only when ingestion is disabled (no downloader invoked)', async () => {
    const downloader = { download: vi.fn() };
    const result = await loadSongFromLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {
      downloader: downloader as unknown as AudioDownloader,
    });
    expect(result.status).toBe('RESEARCHABLE');
    expect(result.researchAvailable).toBe(true);
    expect(downloader.download).not.toHaveBeenCalled();
    expect(result.source.reason).toMatch(/disabled/i);
  });

  it('youtube links resolve title/artist via oEmbed when ingestion is disabled', async () => {
    setYoutubeOEmbedFetch(
      (async () =>
        new Response(JSON.stringify({ title: 'Never Gonna Give You Up', author_name: 'Rick Astley' }), {
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    );
    const result = await loadSongFromLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {});
    expect(result.status).toBe('RESEARCHABLE');
    expect(result.title).toBe('Never Gonna Give You Up');
    expect(result.artist).toBe('Rick Astley');
  });

  it('spotify links never reach any downloader', async () => {
    const downloader = { download: vi.fn() };
    const result = await loadSongFromLink('https://open.spotify.com/track/4PTG3Z6ehGkBF3zI7YiWsC', {
      downloader: downloader as unknown as AudioDownloader,
    });
    expect(result.status).toBe('RESEARCHABLE');
    expect(result.researchAvailable).toBe(true);
    expect(downloader.download).not.toHaveBeenCalled();
  });
});

describe('direct-audio download limits', () => {
  it('accepts audio content types', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(new ArrayBuffer(4), { headers: { 'content-type': 'audio/mpeg' } }));
    const result = await downloadDirectAudio('https://example.com/a.mp3', '/tmp', fetchFn as unknown as typeof fetch);
    expect(result.filePath).toMatch(/download\.mp3$/);
  });

  it('rejects non-audio content types', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
    await expect(downloadDirectAudio('https://example.com/page.mp3', '/tmp', fetchFn as unknown as typeof fetch)).rejects.toThrow(
      /does not serve audio/,
    );
  });
});

describe('loadSongFromLink end-to-end (injected stack) + cache', () => {
  let dir = '';

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'link-test-'));
  });
  afterEach(async () => {
    delete process.env.ALLOW_EXTERNAL_MEDIA_INGEST;
  });

  it('direct audio: downloads once, analyzes once, reuses cache on second load', async () => {
    process.env.ALLOW_EXTERNAL_MEDIA_INGEST = 'true';
    const songsDir = path.join(dir, 'songs');
    const fetchFn = vi.fn().mockResolvedValue(new Response(new ArrayBuffer(16), { headers: { 'content-type': 'audio/mpeg' } }));
    const normalizer: AudioNormalizer = {
      normalize: vi.fn(async (input: string): Promise<NormalizedAudio> => {
        const out = path.join(path.dirname(input), 'analysis.wav');
        await writeFile(out, Buffer.from('wav'));
        return { filePath: out, durationMs: 1000 };
      }),
    };
    const analyzeFn = vi.fn(async (songId: string) => {
      await mkdirGraph(songsDir, songId);
      return { graph: FAKE_GRAPH };
    });

    const common = {
      dataDir: dir,
      songsDir,
      fetchFn: fetchFn as unknown as typeof fetch,
      normalizer,
      analyzeFn,
    };

    const first = await loadSongFromLink('https://example.com/music/song.mp3', { ...common, rightsConfirmed: true });
    expect(first.status).toBe('READY');
    expect(first.songId).toBeDefined();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(analyzeFn).toHaveBeenCalledTimes(1);
    expect(first.analysis?.tempoBpm).toBe(100);

    const second = await loadSongFromLink('https://example.com/music/song.mp3', { ...common, rightsConfirmed: true });
    expect(second.status).toBe('READY');
    expect(second.cached).toBe(true);
    expect(second.songId).toBe(first.songId);
    expect(fetchFn).toHaveBeenCalledTimes(1); // no re-download
    expect(analyzeFn).toHaveBeenCalledTimes(1); // no re-analysis
  });

  it('unsupported sources produce a typed error, not a crash', async () => {
    await expect(loadSongFromLink('https://example.com/blog/post', { dataDir: dir })).rejects.toThrow(/Unsupported song source/);
  });
});

async function mkdirGraph(songsDir: string, songId: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  const dir = path.join(songsDir, songId);
  await mkdir(dir, { recursive: true });
  const graph = { ...FAKE_GRAPH, id: songId };
  await writeFile(path.join(dir, 'graph.json'), JSON.stringify(graph));
  void readFile;
}
