import { describe, expect, it } from 'vitest';
import { detectSourceType, validateLocalSource, validateUrl, SUPPORTED_EXTENSIONS } from '../../src/domain/song/audio-source.js';
import { newSongId } from '../../src/utils/ids.js';
import { AppError } from '../../src/errors/app-error.js';
import { LocalArtifactStore } from '../../src/storage/local-artifact-store.js';
import { SongSchema } from '../../src/domain/song/song.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('source type detection', () => {
  it('detects urls', () => {
    expect(detectSourceType('https://example.com/a.mp3')).toBe('url');
    expect(detectSourceType('http://example.com/watch?v=1')).toBe('url');
  });
  it('detects local paths', () => {
    expect(detectSourceType('./song.mp3')).toBe('local');
    expect(detectSourceType('/abs/path/SONG.WAV')).toBe('local');
  });
});

describe('extension validation', () => {
  it('accepts supported extensions', () => {
    for (const ext of SUPPORTED_EXTENSIONS) {
      expect(validateLocalSource(`x${ext}`)).toBe(ext);
    }
  });
  it('rejects unsupported extension', () => {
    expect(() => validateLocalSource('x.m4a')).toThrowError(AppError);
    expect(() => validateLocalSource('x.m4a')).toThrowError(/Unsupported extension/);
  });
  it('rejects missing extension', () => {
    expect(() => validateLocalSource('noext')).toThrowError(AppError);
  });
  it('is case-insensitive', () => {
    expect(validateLocalSource('x.MP3')).toBe('.mp3');
  });
});

describe('song id generation', () => {
  it('matches song_ + 12 hex chars', () => {
    expect(newSongId()).toMatch(/^song_[0-9a-f]{12}$/);
  });
  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 50 }, newSongId));
    expect(ids.size).toBe(50);
  });
});

describe('artifact store paths', () => {
  it('stores and reports relative paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'guitar-test-'));
    try {
      const store = new LocalArtifactStore(root);
      const ref = await store.put('song_abc123def456', 'audio/analysis.wav', 'data');
      expect(ref.relativePath).toBe(path.join('songs', 'song_abc123def456', 'audio', 'analysis.wav'));
      await expect(store.exists('song_abc123def456', 'audio/analysis.wav')).resolves.toBe(true);
      await expect(store.exists('song_abc123def456', 'nope.bin')).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('rejects path traversal', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'guitar-test-'));
    try {
      const store = new LocalArtifactStore(root);
      await expect(store.put('song_x', '../../escape.bin', 'data')).rejects.toThrowError(AppError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('metadata validation', () => {
  const validSong = {
    id: 'song_abc123def456',
    title: 'Test Song',
    source: { type: 'local', original: './x.mp3' },
    durationMs: 213000,
    createdAt: new Date().toISOString(),
  };
  it('accepts a valid song', () => {
    expect(() => SongSchema.parse(validSong)).not.toThrow();
  });
  it('accepts url source', () => {
    expect(() =>
      SongSchema.parse({ ...validSong, source: { type: 'url', url: 'https://example.com/x' } }),
    ).not.toThrow();
  });
  it('rejects bad id', () => {
    expect(() => SongSchema.parse({ ...validSong, id: 'nope' })).toThrow();
  });
  it('rejects bad url source', () => {
    expect(() =>
      SongSchema.parse({ ...validSong, source: { type: 'url', url: 'not-a-url' } }),
    ).toThrow();
  });
  it('rejects negative duration', () => {
    expect(() => SongSchema.parse({ ...validSong, durationMs: -1 })).toThrow();
  });
});
