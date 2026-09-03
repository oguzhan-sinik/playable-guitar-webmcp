import { describe, expect, it } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  hashFile,
  cacheFingerprint,
  isCacheValid,
  toArtifact,
  parseArtifact,
  assertArtifact,
} from '../../src/engines/songgraph/analysis-cache.js';
import { AppError } from '../../src/errors/app-error.js';
import type { RawMusicAnalysis } from '../../src/domain/analysis/raw-music-analysis.js';

const analysis: RawMusicAnalysis = {
  provider: 'fake',
  rhythm: { bpm: 120, beats: [{ timeSeconds: 0 }], confidence: 0.9 },
  tonal: { key: { root: 'C', scale: 'major', confidence: 0.8 }, chords: [] },
  warnings: [],
};

describe('cache fingerprint', () => {
  it('changes when any of version/provider/audio changes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'guitar-cache-'));
    const wav = path.join(dir, 'a.wav');
    await writeFile(wav, Buffer.from('one'));
    const sha = await hashFile(wav);
    const base = cacheFingerprint({ sourceAudioSha256: sha, provider: 'essentia' });
    expect(base).toBe(cacheFingerprint({ sourceAudioSha256: sha, provider: 'essentia' }));
    expect(base).not.toBe(cacheFingerprint({ sourceAudioSha256: sha, provider: 'fake' }));
    expect(base).not.toBe(cacheFingerprint({ sourceAudioSha256: sha, provider: 'essentia', pipelineVersion: '2' }));
    await writeFile(wav, Buffer.from('two'));
    expect(await hashFile(wav)).not.toBe(sha);
  });
});

describe('artifact validation', () => {
  it('round-trips through JSON and checks cache validity', () => {
    const artifact = toArtifact(analysis, { sourceAudioSha256: 'abc', analyzedAt: '2026-01-01T00:00:00.000Z' });
    const parsed = parseArtifact(JSON.parse(JSON.stringify(artifact)));
    expect(parsed).not.toBeNull();
    expect(isCacheValid(parsed!, { sourceAudioSha256: 'abc', provider: 'fake' })).toBe(true);
    // different audio -> invalid
    expect(isCacheValid(parsed!, { sourceAudioSha256: 'other', provider: 'fake' })).toBe(false);
    // different provider -> invalid
    expect(isCacheValid(parsed!, { sourceAudioSha256: 'abc', provider: 'essentia' })).toBe(false);
    // null artifact -> invalid
    expect(isCacheValid(null, { sourceAudioSha256: 'abc', provider: 'fake' })).toBe(false);
  });
  it('rejects corrupt artifacts', () => {
    expect(parseArtifact({ meta: {} })).toBeNull();
    expect(() => assertArtifact({ junk: true })).toThrow(AppError);
  });
});

describe('hashFile', () => {
  it('hashes file contents', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'guitar-hash-'));
    const f = path.join(dir, 'x.bin');
    await writeFile(f, Buffer.from('hello'));
    expect(await hashFile(f)).toMatch(/^[0-9a-f]{64}$/);
  });
});
