import { describe, expect, it } from 'vitest';
import { buildAgentCacheKey, hashSongGraphStable } from '../../src/agents/cache.js';
import type { SongGraph } from '../../src/domain/music/song-graph.js';

const miniGraph = (): SongGraph => ({
  id: 'song_test00000001',
  metadata: { title: 'T', durationMs: 1000 },
  global: { bpm: 120, timeSignature: { numerator: 4, denominator: 4, confidence: 1, source: 'ANALYZED' }, tuningReferenceHz: 440 },
  beats: [],
  sections: [],
  harmony: { chords: [{ startBeat: 0, durationBeats: 4, root: 'C', quality: 'major', confidence: 1 }] },
  motifs: [],
  confidence: { overall: 1 },
});

describe('agent cache keys', () => {
  it('changes when model or prompt version changes', () => {
    const h = hashSongGraphStable(miniGraph());
    const a = buildAgentCacheKey({ agent: 'analysis', graphHash: h, model: 'gemini-3.7-flash', promptVersion: 'v2' });
    const b = buildAgentCacheKey({ agent: 'analysis', graphHash: h, model: 'gemini-3.7-flash', promptVersion: 'v1' });
    const c = buildAgentCacheKey({ agent: 'analysis', graphHash: h, model: 'gemini-2.0', promptVersion: 'v2' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
