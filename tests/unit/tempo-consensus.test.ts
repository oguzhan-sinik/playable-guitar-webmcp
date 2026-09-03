import { describe, expect, it } from 'vitest';
import { resolveTempo } from '../../src/engines/analysis-consensus/tempo-consensus.js';
import type { TempoCandidate } from '../../src/domain/analysis/raw-music-analysis.js';

const cand = (bpm: number, provider: string, confidence = 1): TempoCandidate => ({
  bpm,
  confidence,
  provider,
  relation: 'PRIMARY',
  derived: false,
});

// beat grid at 126 BPM
const beatTimes126 = Array.from({ length: 100 }, (_, i) => (i * 60) / 126);
// downbeats every 4 beats
const downbeats126 = beatTimes126.filter((_, i) => i % 4 === 0);

describe('resolveTempo', () => {
  it('prefers the candidate supported by measured beat intervals', () => {
    // Essentia says 95, All-In-One says 126, beats strongly support 126
    const resolved = resolveTempo({
      candidates: [cand(95.2, 'essentia', 1), cand(126.1, 'all-in-one', 0.8)],
      beatTimes: beatTimes126,
      downbeatTimes: downbeats126,
    });
    expect(resolved.bpm).toBeGreaterThan(120);
    expect(resolved.bpm).toBeLessThan(132);
    // 95 survives as alternative evidence
    expect(resolved.alternatives.some((a) => Math.abs(a.bpm - 95.2) < 1)).toBe(true);
  });

  it('treats half/double related candidates as agreeing, not conflicting', () => {
    const resolved = resolveTempo({
      candidates: [cand(63, 'provider-a'), cand(126, 'provider-b')],
      beatTimes: beatTimes126,
    });
    expect([63, 126].some((bpm) => Math.abs(resolved.bpm - bpm) < 2)).toBe(true);
  });

  it('derives half/double hypotheses but marks them derived', () => {
    const resolved = resolveTempo({ candidates: [cand(120, 'solo-provider')] });
    expect(resolved.alternatives.some((a) => Math.abs(a.bpm - 240) < 1)).toBe(true);
    expect(resolved.alternatives.some((a) => Math.abs(a.bpm - 60) < 1)).toBe(true);
    // the detected primary still wins over derived hypotheses
    expect(Math.abs(resolved.bpm - 120) < 1).toBe(true);
  });

  it('picks the stronger-confidence provider when beats are unavailable', () => {
    const resolved = resolveTempo({
      candidates: [cand(95, 'a', 0.2), cand(96, 'b', 1)],
    });
    expect(Math.abs(resolved.bpm - 96) < 2).toBe(true);
  });

  it('reports evidence for debugging', () => {
    const resolved = resolveTempo({
      candidates: [cand(95.2, 'essentia'), cand(126.1, 'all-in-one')],
      beatTimes: beatTimes126,
      downbeatTimes: downbeats126,
    });
    expect(resolved.evidence.some((e) => e.kind === 'BEAT_INTERVALS')).toBe(true);
    expect(resolved.evidence.some((e) => e.kind === 'DOWNBEAT_PERIODICITY')).toBe(true);
  });
});
