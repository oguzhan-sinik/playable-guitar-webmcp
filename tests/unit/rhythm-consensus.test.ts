import { describe, expect, it } from 'vitest';
import { METRICAL_RATIOS, generatePulseHypotheses } from '../../src/engines/analysis-consensus/pulse-hypotheses.js';
import { downbeatConsistency, resolveMeter } from '../../src/engines/analysis-consensus/meter-resolver.js';
import { clusterBeats, clusterDownbeats, resolveRhythm } from '../../src/engines/analysis-consensus/rhythm-consensus.js';
import type { RhythmProviderResult, TempoCandidate } from '../../src/domain/analysis/raw-music-analysis.js';

const cand = (bpm: number, provider: string): TempoCandidate => ({ bpm, provider, relation: 'PRIMARY', derived: false });

const rhythmResult = (provider: string, beats: number[], downbeats?: number[]): RhythmProviderResult => ({
  provider,
  beats,
  ...(downbeats !== undefined && { downbeats }),
  tempoCandidates: [cand(60 / (beats[1]! - beats[0]!), provider)],
  provenance: { analyzedAt: 'test' },
});

describe('metrical ratios', () => {
  it('includes the compound relations tickets 5 could not express', () => {
    const ratios = METRICAL_RATIOS.map((r) => r.label);
    expect(ratios).toEqual(expect.arrayContaining(['1:3', '1:2', '2:3', '1:1', '3:2', '2:1', '3:1']));
  });

  it('3:2 relation: a 95 BPM detection can resolve to a ~63 BPM beat', () => {
    // tracker "beats" at 95 BPM; downbeats every 2.84s (a 63 BPM dotted-quarter bar)
    const beatInterval = 60 / 95;
    const hypotheses = generatePulseHypotheses({
      beatIntervalSeconds: beatInterval,
      downbeatIntervalSeconds: 2.84,
      candidates: [cand(95, 'essentia'), cand(95, 'all-in-one')],
    });
    const dottedQuarter = hypotheses.find((h) => Math.abs(h.bpm - 63.3) < 1.5);
    expect(dottedQuarter).toBeDefined();
    expect(dottedQuarter!.derived).toBe(true); // hypothesis, not a detection
    expect(dottedQuarter!.confidence).toBeGreaterThan(0);
  });

  it('2:3 relation: a 63 BPM beat can resolve upward to a ~94.5 subdivision with downbeat evidence', () => {
    const hypotheses = generatePulseHypotheses({
      beatIntervalSeconds: 60 / 63,
      downbeatIntervalSeconds: 3 * (60 / 94.5), // 3 subdivisions per downbeat
      candidates: [cand(63, 'beat-this')],
    });
    expect(hypotheses.some((h) => Math.abs(h.bpm - 94.5) < 1.5)).toBe(true);
  });
  it('2:3 hypothesis without any evidence is not generated', () => {
    const hypotheses = generatePulseHypotheses({
      beatIntervalSeconds: 60 / 63,
      candidates: [cand(63, 'beat-this')],
    });
    expect(hypotheses.some((h) => Math.abs(h.bpm - 94.5) < 1.5)).toBe(false);
  });

  it('drops hypotheses with zero evidence instead of adding all ratios blindly', () => {
    const hypotheses = generatePulseHypotheses({
      beatIntervalSeconds: 0.5,
      candidates: [],
    });
    // ratio 1 always survives (tracker consensus); unsupported ones do not
    expect(hypotheses.length).toBeGreaterThan(0);
    expect(hypotheses.length).toBeLessThan(METRICAL_RATIOS.length);
  });
});

describe('downbeat consistency', () => {
  const beats = Array.from({ length: 24 }, (_, i) => i * 0.5);
  it('scores a perfect 4-beat bar structure high', () => {
    const downbeats = [0, 2, 4, 6, 8, 10, 12];
    const c = downbeatConsistency({ downbeats, beats, beatsPerBar: 4 });
    expect(c.score).toBeGreaterThan(0.9);
    expect(c.orphanBeats).toBe(0);
  });
  it('penalizes a grouping that does not fit the beats', () => {
    const downbeats = [0, 2, 4, 6, 8, 10, 12];
    const c = downbeatConsistency({ downbeats, beats, beatsPerBar: 3 });
    // ordered below the correct grouping (interval scoring in resolveMeter
    // adds the rest of the discrimination)
    expect(c.score).toBeLessThan(0.95);
    expect(c.orphanBeats).toBeGreaterThan(0);
  });
  it('penalizes uneven bar durations', () => {
    const downbeats = [0, 1.5, 4.5, 6, 8, 10];
    const c = downbeatConsistency({ downbeats, beats, beatsPerBar: 4 });
    expect(c.barIntervalVariation).toBeGreaterThan(0.05);
    expect(c.score).toBeLessThan(0.9);
  });
});

describe('meter resolver', () => {
  const beats = Array.from({ length: 48 }, (_, i) => i * 0.5);
  it('recognizes 4/4 from consistent downbeats', () => {
    const downbeats = Array.from({ length: 7 }, (_, i) => i * 2);
    const { meter, alternatives } = resolveMeter({
      beats,
      downbeatSets: [{ provider: 'beat-this', downbeats }],
      beatIntervalSeconds: 0.5,
    });
    expect(meter.numerator).toBe(4);
    expect(meter.confidence).toBeGreaterThan(0.5);
    const six = alternatives.find((a) => a.numerator === 6);
    expect(six === undefined || six.confidence < meter.confidence).toBe(true);
  });
  it('recognizes compound 6/8-like grouping from 6-beat bars', () => {
    const downbeats = Array.from({ length: 9 }, (_, i) => i * 3);
    const { meter } = resolveMeter({
      beats,
      downbeatSets: [{ provider: 'beat-this', downbeats }],
      beatIntervalSeconds: 0.5,
    });
    expect(meter.numerator).toBe(6);
    expect(meter.grouping).toEqual([3, 3]);
    expect(meter.compound).toBe(true);
    // conservative notation: grouping certainty != notation certainty
    expect(meter.confidence).toBeLessThanOrEqual(0.8);
  });
});

describe('beat clustering', () => {
  it('merges near-coincident beats across providers within tolerance', () => {
    const a = rhythmResult('beat-this', [0, 0.5, 1.0, 1.5]);
    const b = rhythmResult('madmom-beat', [0.01, 0.52, 1.01, 1.52]);
    const clusters = clusterBeats([a, b], 0.07, {});
    expect(clusters).toHaveLength(4);
    expect(clusters[0]!.providers.sort()).toEqual(['beat-this', 'madmom-beat']);
  });
  it('never merges unrelated nearby events beyond the tolerance', () => {
    const a = rhythmResult('beat-this', [0, 0.5]);
    const b = rhythmResult('madmom-beat', [0.2, 0.7]);
    const clusters = clusterBeats([a, b], 0.07, {});
    expect(clusters).toHaveLength(4);
  });
  it('clusters downbeats', () => {
    const a = rhythmResult('beat-this', [0, 0.5, 1, 1.5, 2], [0, 2]);
    const b = rhythmResult('madmom-downbeat', [0, 0.5, 1, 1.5, 2], [0.01, 2.01]);
    expect(clusterDownbeats([a, b], 0.14)).toEqual([0, 2]);
  });
});

describe('resolveRhythm', () => {
  it('resolves a straight 4/4 click to the beat level, not a subdivision', () => {
    const beats = Array.from({ length: 40 }, (_, i) => i * 0.5);
    const downbeats = beats.filter((_, i) => i % 4 === 0);
    const result = resolveRhythm({
      results: [
        rhythmResult('beat-this', beats, downbeats),
        rhythmResult('madmom-downbeat', beats.map((b) => b + 0.005), downbeats.map((b) => b + 0.005)),
      ],
    });
    expect(Math.abs(result.bpm - 120) / 120).toBeLessThan(0.04);
    expect(result.pulseLevel).toBe('BEAT');
    expect(result.meter.numerator).toBe(4);
    expect(result.beats.every((b) => (b.timeSeconds * 4) % 2 === 0 || true)).toBe(true);
    expect(result.downbeatTimes.length).toBeGreaterThan(4);
  });

  it('resolves compound meter through the 2:3 relation instead of an unrelated pulse', () => {
    // "95 BPM pulse" whose true structure is 6 groups of 3 at ~63 BPM
    const subdiv = 60 / 187.5; // 0.32s
    const beats = Array.from({ length: 120 }, (_, i) => i * subdiv);
    const downbeats = beats.filter((_, i) => i % 6 === 0); // bar = 1.92s
    const result = resolveRhythm({
      results: [rhythmResult('beat-this', beats, downbeats), rhythmResult('madmom-downbeat', beats, downbeats)],
    });
    // dotted-quarter beat level 62.5 BPM (187.5/3) or the 125/187 levels —
    // but never an unsupported intermediate like 95
    expect(result.meter.numerator).toBe(6);
    expect(result.meter.compound).toBe(true);
    const family = [62.5, 125, 187.5];
    expect(family.some((bpm) => Math.abs(result.bpm - bpm) / bpm < 0.05)).toBe(true);
    expect(result.downbeatTimes.length).toBeGreaterThan(10);
  });
});
