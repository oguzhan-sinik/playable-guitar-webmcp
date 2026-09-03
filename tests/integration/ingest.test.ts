import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ingestSong } from '../../src/application/ingest-song.js';
import { FfmpegNormalizer } from '../../src/providers/audio/ffmpeg-provider.js';
import { LocalArtifactStore } from '../../src/storage/local-artifact-store.js';
import { LocalSongRepository } from '../../src/repositories/song-repository.js';
import type { AudioDownloader, DownloadedAudio } from '../../src/providers/audio/audio-downloader.js';
import { fileURLToPath } from 'node:url';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/simple-song.mp3');

// URL downloading is mocked — CI never touches the network.
class FakeDownloader implements AudioDownloader {
  async download(_url: string, destDir: string): Promise<DownloadedAudio> {
    const { mkdir, copyFile } = await import('node:fs/promises');
    await mkdir(destDir, { recursive: true });
    const dest = path.join(destDir, 'original.mp3');
    await copyFile(fixture, dest);
    return { filePath: dest, title: 'Fake Downloaded Song', durationMs: 2000 };
  }
}

let dataDir: string;
let deps: Parameters<typeof ingestSong>[2];

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'guitar-int-'));
  deps = {
    downloader: new FakeDownloader(),
    normalizer: new FfmpegNormalizer(),
    artifacts: new LocalArtifactStore(dataDir),
    songs: new LocalSongRepository(path.join(dataDir, 'songs')),
    songsDir: path.join(dataDir, 'songs'),
  };
});

afterAll(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe('local ingestion', () => {
  it('ingests a local mp3 end to end', async () => {
    const result = await ingestSong(fixture, {}, deps);

    expect(result.song.id).toMatch(/^song_[0-9a-f]{12}$/);
    expect(result.song.source).toEqual({ type: 'local', original: path.resolve(fixture) });
    expect(result.song.durationMs).toBeGreaterThan(1500);

    const src = await stat(path.join(dataDir, result.sourcePath));
    expect(src.size).toBeGreaterThan(0);

    const wav = await stat(path.join(dataDir, result.analysisPath));
    expect(wav.size).toBeGreaterThan(44);
  });

  it('creates normalized WAV with 44.1kHz PCM header', async () => {
    const result = await ingestSong(fixture, { title: 'T', artist: 'A' }, deps);
    const buf = await import('node:fs/promises').then((fs) =>
      fs.readFile(path.join(dataDir, result.analysisPath)),
    );
    expect(buf.subarray(0, 4).toString()).toBe('RIFF');
    expect(buf.subarray(8, 12).toString()).toBe('WAVE');
    // pcm_s16le => 16-bit
    const fmtChunk = buf.indexOf('fmt ');
    expect(buf.readUInt16LE(fmtChunk + 8)).toBe(1); // PCM
    expect(buf.readUInt32LE(fmtChunk + 12)).toBe(44100); // sample rate
    expect(result.song.title).toBe('T');
    expect(result.song.artist).toBe('A');
  });

  it('writes metadata.json readable via repository', async () => {
    const result = await ingestSong(fixture, {}, deps);
    const song = await new LocalSongRepository(path.join(dataDir, 'songs')).get(result.song.id);
    expect(song.id).toBe(result.song.id);
    expect(song.createdAt).toBeTruthy();
  });
});

describe('url ingestion (mocked downloader)', () => {
  it('records url source and uses downloader metadata', async () => {
    const result = await ingestSong('https://example.com/watch?v=1', {}, deps);
    expect(result.song.source).toEqual({ type: 'url', url: 'https://example.com/watch?v=1' });
    expect(result.song.title).toBe('Fake Downloaded Song');
  });
});
