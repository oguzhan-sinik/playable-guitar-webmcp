import type {
  MetricalTempoHypothesis,
  MeterCandidate,
  PulseLevel,
  RhythmProviderResult,
  ResolvedRhythm,
} from '../../domain/analysis/raw-music-analysis.js';
import { generatePulseHypotheses, bestPulseHypothesis } from './pulse-hypotheses.js';
import { resolveMeter } from './meter-resolver.js';

export interface RhythmConsensusInput {
  results: RhythmProviderResult[];
  /** Provider reliability priors (configurable, deterministic; learned later). */
  providerWeights?: Record<string, number>;
  /** Beat matching tolerance in seconds. */
  beatToleranceSeconds?: number;
}

export const DEFAULT_RHYTHM_WEIGHTS: Record<string, number> = {
  'beat-this': 1.3,
  'madmom-downbeat': 1.3,
  'madmom-beat': 1.2,
  'all-in-one': 1.0,
  essentia: 0.8,
};

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
};

export interface ClusteredBeat {
  timeSeconds: number;
  providers: string[];
  confidence: number;
}

/**
 * Cluster near-coincident beats across providers. A cluster keeps the
 * earliest time (not an average) so unrelated nearby events are never merged
 * into a fabricated middle value; the cluster spans at most one tolerance.
 */
export function clusterBeats(
  results: RhythmProviderResult[],
  toleranceSeconds: number,
  weights: Record<string, number>,
): ClusteredBeat[] {
  const events: Array<{ time: number; provider: string }> = [];
  for (const r of results) {
    for (const b of r.beats) events.push({ time: b, provider: r.provider });
  }
  events.sort((a, b) => a.time - b.time);
  const clusters: ClusteredBeat[] = [];
  for (const event of events) {
    const last = clusters[clusters.length - 1];
    if (last !== undefined && event.time - last.timeSeconds <= toleranceSeconds) {
      if (!last.providers.includes(event.provider)) last.providers.push(event.provider);
      last.confidence = Math.min(
        1,
        last.providers.reduce((sum, p) => sum + (weights[p] ?? 1), 0) / 2.5,
      );
      continue;
    }
    clusters.push({
      timeSeconds: event.time,
      providers: [event.provider],
      confidence: (weights[event.provider] ?? 1) / 2.5,
    });
  }
  return clusters;
}

/** Cluster downbeat predictions across providers (same rule as beats). */
export function clusterDownbeats(
  results: RhythmProviderResult[],
  toleranceSeconds: number,
): number[] {
  const events = results
    .flatMap((r) => (r.downbeats ?? []).map((d) => ({ time: d, provider: r.provider })))
    .sort((a, b) => a.time - b.time);
  const clusters: Array<{ time: number; providers: string[] }> = [];
  for (const e of events) {
    const last = clusters[clusters.length - 1];
    if (last !== undefined && e.time - last.time <= toleranceSeconds) {
      if (!last.providers.includes(e.provider)) last.providers.push(e.provider);
      continue;
    }
    clusters.push({ time: e.time, providers: [e.provider] });
  }
  // keep downbeats that at least one strong tracker claims; order preserved
  return clusters.map((c) => c.time);
}

/**
 * Rhythm consensus V3:
 *   1. cluster beats/downbeats across providers (tolerance-based);
 *   2. generate metrical tempo hypotheses from the median beat interval,
 *      including 1/3, 2/3, 3/2, 3 relations that resolve compound meters
 *      (e.g. a 95 BPM detection re-read as a 63 BPM dotted-quarter beat);
 *   3. resolve meter by downbeat consistency across provider downbeat sets;
 *   4. pick the hypothesis whose beat interval divides the canonical
 *      downbeat spacing into a whole bar — that is the product's BEAT level.
 */
export function resolveRhythm(input: RhythmConsensusInput): ResolvedRhythm {
  const tolerance = input.beatToleranceSeconds ?? 0.07;
  const weights = { ...DEFAULT_RHYTHM_WEIGHTS, ...input.providerWeights };
  const results = input.results.filter((r) => r.beats.length >= 8);
  if (results.length === 0) {
    throw new Error('No rhythm provider produced a usable beat track');
  }

  const clusters = clusterBeats(results, tolerance, weights);
  const beatTimes = clusters.map((c) => c.timeSeconds);
  const intervals: number[] = [];
  for (let i = 1; i < beatTimes.length; i++) intervals.push(beatTimes[i]! - beatTimes[i - 1]!);
  const beatInterval = median(intervals.filter((i) => i > 0.1));

  const downbeatSets = results
    .filter((r) => (r.downbeats?.length ?? 0) >= 3)
    .map((r) => ({ provider: r.provider, downbeats: r.downbeats! }));

  // per-provider median downbeat intervals feed hypothesis scoring
  const downbeatIntervals = downbeatSets.flatMap((s) => {
    const d: number[] = [];
    for (let i = 1; i < s.downbeats.length; i++) d.push(s.downbeats[i]! - s.downbeats[i - 1]!);
    return d;
  });
  const downbeatInterval = downbeatIntervals.length > 0 ? median(downbeatIntervals.filter((i) => i > 0.3)) : undefined;

  const perProviderBeatBpm = results.map((r) => {
    const iv: number[] = [];
    for (let i = 1; i < r.beats.length; i++) iv.push(r.beats[i]! - r.beats[i - 1]!);
    const med = median(iv.filter((x) => x > 0.1));
    return { provider: r.provider, bpm: 60 / med };
  });
  const hypotheses = generatePulseHypotheses({
    beatIntervalSeconds: beatInterval,
    ...(downbeatInterval !== undefined && { downbeatIntervalSeconds: downbeatInterval }),
    candidates: results.flatMap((r) => r.tempoCandidates),
    perProviderBeatBpm,
  });
  if (hypotheses.length === 0) {
    throw new Error('No metrical tempo hypotheses survived evidence filtering');
  }

  const meterResolution = resolveMeter({
    beats: beatTimes,
    downbeatSets: downbeatSets.length > 0 ? downbeatSets : [],
    beatIntervalSeconds: beatInterval,
    weights,
  });

  // score each hypothesis by how well its beat level explains the canonical
  // downbeat spacing (a bar = hypothesis interval × meter numerator / level)
  const evidence = [];
  // bar-fit: for compound meters BOTH readings count — a 6/8 bar is 6
  // subdivisions or 2 dotted-quarter beats; whichever the hypothesis
  // represents must reproduce the downbeat spacing
  const barFit = (h: MetricalTempoHypothesis): number => {
    if (downbeatInterval === undefined) return 0;
    const meter = meterResolution.meter;
    const bpbs: number[] =
      meter.compound === true
        ? h.pulseLevel === 'SUBDIVISION'
          ? [meter.numerator]
          : h.pulseLevel === 'BEAT'
            ? [meter.numerator / 3]
            : []
        : h.pulseLevel === 'BEAT'
          ? [meter.numerator]
          : [];
    let best = 0;
    for (const bpb of bpbs) {
      const barSeconds = (60 / h.bpm) * bpb;
      const ratio = barSeconds / downbeatInterval;
      if (Math.abs(ratio - 1) < 0.1) best = Math.max(best, 1);
      else if (Math.abs(ratio - Math.round(ratio)) < 0.1 && Math.round(ratio) >= 1 && Math.round(ratio) <= 2) {
        best = Math.max(best, 0.5);
      }
    }
    return best;
  };

  let scored = hypotheses.map((h) => ({ h, total: h.confidence + barFit(h) }));
  scored = scored.sort((a, b) => b.total - a.total);
  // tie-break toward the slower practice-usable pulse among near-equals
  const top = scored[0]!.total;
  const winner = scored
    .filter((s) => top - s.total < 0.2)
    .reduce((slowest, s) => (s.h.bpm < slowest.h.bpm ? s : slowest), scored[0]!).h;

  // canonical downbeats: cluster across providers
  const downbeatTimes = downbeatSets.length > 0 ? clusterDownbeats(results, tolerance * 2) : [];

  // mark canonical beats as downbeats where they coincide with a downbeat
  const downbeatSet = new Set<number>();
  for (const d of downbeatTimes) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < beatTimes.length; i++) {
      const dist = Math.abs(beatTimes[i]! - d);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestDist <= tolerance * 2) downbeatSet.add(bestIdx);
  }

  let positionInBar = 0;
  const beats = clusters.map((c, i) => {
    const isDownbeat = downbeatSet.has(i) || (downbeatTimes.length === 0 && i === 0);
    positionInBar = isDownbeat ? 1 : positionInBar + 1;
    return {
      timeSeconds: c.timeSeconds,
      isDownbeat,
      ...(isDownbeat || positionInBar > 0 ? { positionInBar } : {}),
      evidence: { providers: c.providers, confidence: c.confidence },
    };
  });

  evidence.push(
    { kind: 'CLUSTERED_BEATS', detail: `${clusters.length} canonical beats from ${results.length} providers`, score: clusters.length },
    { kind: 'SELECTED_PULSE', detail: `${winner.bpm.toFixed(1)} BPM (${winner.pulseLevel}) from [${winner.sources.join(', ')}]`, score: winner.confidence },
  );

  const tempoAlternatives = scored.slice(1, 6).map((s) => s.h);

  // practice pulse: for compound meters the subdivision level is not a usable
  // click — the dotted-quarter (subdivision / 3) is the natural beat
  const practicePulse = ((): { bpm: number; pulseLevel: PulseLevel } => {
    if (meterResolution.meter.compound === true && winner.pulseLevel === 'SUBDIVISION') {
      return { bpm: winner.bpm / 3, pulseLevel: 'BEAT' };
    }
    if (winner.bpm > 180) return { bpm: winner.bpm / 2, pulseLevel: 'BEAT' };
    if (winner.bpm < 40) return { bpm: winner.bpm * 2, pulseLevel: 'BEAT' };
    return { bpm: winner.bpm, pulseLevel: winner.pulseLevel };
  })();

  return {
    beats,
    downbeatTimes,
    bpm: winner.bpm,
    pulseLevel: winner.pulseLevel,
    practicePulseBpm: Math.round(practicePulse.bpm * 10) / 10,
    practicePulseLevel: practicePulse.pulseLevel,
    meter: withAlternatives(meterResolution.meter, hypotheses),
    meterAlternatives: meterResolution.alternatives,
    tempoAlternatives,
    confidence: Math.min(1, winner.confidence * 0.7 + meterResolution.meter.confidence * 0.3),
    evidence,
  };
}

/** Compound groupings keep notation confidence modest — grouping certainty
 * does not equal notation certainty. */
function withAlternatives(meter: MeterCandidate, hypotheses: MetricalTempoHypothesis[]): MeterCandidate {
  void hypotheses;
  if (meter.compound === true) {
    return { ...meter, confidence: Math.min(meter.confidence, 0.8) };
  }
  return meter;
}

export { bestPulseHypothesis };
