import type { MeterCandidate, MeterEvidence } from '../../domain/analysis/raw-music-analysis.js';

export interface DownbeatConsistencyInput {
  /** Downbeat times (seconds). */
  downbeats: number[];
  /** Beat times (seconds) between/around the downbeats. */
  beats: number[];
  /** Hypothesized beats per bar. */
  beatsPerBar: number;
}

export interface DownbeatConsistency {
  /** [0, 1] — 1 when every bar contains exactly `beatsPerBar` beats with low
   * interval variance. */
  score: number;
  bars: number;
  /** Relative std-dev of bar durations. */
  barIntervalVariation: number;
  /** Beats that fall outside any bar (insertions/deletions signal). */
  orphanBeats: number;
  evidence: MeterEvidence[];
}

const within = (a: number, b: number, tol = 0.04): boolean =>
  a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) <= tol;

/**
 * Downbeat consistency: how well the predicted downbeats partition the beats
 * into equal `beatsPerBar` groups. High when bar durations are uniform and
 * every beat belongs to a bar.
 */
export function downbeatConsistency(input: DownbeatConsistencyInput): DownbeatConsistency {
  const { downbeats, beats, beatsPerBar } = input;
  if (downbeats.length < 2 || beats.length < beatsPerBar) {
    return { score: 0, bars: 0, barIntervalVariation: 1, orphanBeats: beats.length, evidence: [] };
  }

  const barDurations: number[] = [];
  let orphanBeats = 0;
  for (let i = 0; i < downbeats.length - 1; i++) {
    const barStart = downbeats[i]!;
    const barEnd = downbeats[i + 1]!;
    barDurations.push(barEnd - barStart);
    const beatsInBar = beats.filter((b) => b >= barStart && b < barEnd).length;
    if (beatsInBar !== beatsPerBar) {
      orphanBeats += Math.abs(beatsInBar - beatsPerBar);
    }
  }
  // trailing beats after the last downbeat
  orphanBeats += beats.filter((b) => b >= downbeats[downbeats.length - 1]!).length;

  const mean = barDurations.reduce((a, b) => a + b, 0) / barDurations.length;
  const variance = barDurations.reduce((a, b) => a + (b - mean) ** 2, 0) / barDurations.length;
  const relStd = mean > 0 ? Math.sqrt(variance) / mean : 1;
  const uniformity = Math.max(0, 1 - relStd * 2); // 30% relative std -> 0.4
  const grouping = beats.length > 0 ? Math.max(0, 1 - orphanBeats / beats.length) : 0;
  // correct grouping matters more than uniform bar durations (uniform wrong
  // groupings must lose to correct ones)
  const score = Math.min(1, grouping * 0.6 + uniformity * 0.4);

  return {
    score,
    bars: barDurations.length,
    barIntervalVariation: relStd,
    orphanBeats,
    evidence: [
      {
        kind: 'BAR_UNIFORMITY',
        detail: `${barDurations.length} bars, mean ${mean.toFixed(2)}s, relative variation ${(relStd * 100).toFixed(0)}%`,
        score: uniformity,
      },
      {
        kind: 'BEAT_GROUPING',
        detail: `${orphanBeats} beat(s) outside a ${beatsPerBar}-beat bar structure`,
        score: grouping,
      },
    ],
  };
}

export interface MeterResolution {
  meter: MeterCandidate;
  alternatives: MeterCandidate[];
}

/**
 * Meter resolution: score grouping hypotheses (2,3,4,6,12 beats per bar,
 * with compound subdivisions [3,3] for 6, [3,3,3,3] for 12) by downbeat
 * consistency against every provider's downbeat predictions plus the
 * detected beat interval. Grouping clarity is reported honestly: compound
 * groupings keep lower notation confidence than the grouping itself.
 */
export function resolveMeter(input: {
  beats: number[];
  downbeatSets: Array<{ provider: string; downbeats: number[] }>;
  beatIntervalSeconds: number;
  weights?: Record<string, number>;
}): MeterResolution {
  const groupings: Array<{ beatsPerBar: number; grouping: number[]; notation: [number, number] }> = [
    { beatsPerBar: 2, grouping: [2], notation: [2, 4] },
    { beatsPerBar: 3, grouping: [3], notation: [3, 4] },
    { beatsPerBar: 4, grouping: [4], notation: [4, 4] },
    { beatsPerBar: 6, grouping: [3, 3], notation: [6, 8] },
    { beatsPerBar: 12, grouping: [3, 3, 3, 3], notation: [12, 8] },
  ];

  const weights = input.weights ?? {};
  const candidates: MeterCandidate[] = groupings.map((g) => {
    const evidence: MeterEvidence[] = [];
    let weighted = 0;
    let weightSum = 0;
    for (const set of input.downbeatSets) {
      const consistency = downbeatConsistency({
        downbeats: set.downbeats,
        beats: input.beats,
        beatsPerBar: g.beatsPerBar,
      });
      if (consistency.bars === 0) continue;
      const weight = weights[set.provider] ?? 1;
      weighted += consistency.score * weight;
      weightSum += weight;
      evidence.push(...consistency.evidence.map((e) => ({ ...e, detail: `[${set.provider}] ${e.detail}` })));
    }
    const providerScore = weightSum > 0 ? weighted / weightSum : 0;

    // interval-based grouping: does the beat interval divide the median
    // downbeat spacing into exactly beatsPerBar parts?
    let intervalScore = 0;
    const allDownbeats = input.downbeatSets.flatMap((s) => s.downbeats);
    if (allDownbeats.length >= 4) {
      const sorted = [...allDownbeats].sort((a, b) => a - b);
      const diffs: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const d = sorted[i]! - sorted[i - 1]!;
        if (d > 0.2) diffs.push(d); // ignore intra-provider near-duplicates
      }
      if (diffs.length > 0) {
        const median = diffs.sort((a, b) => a - b)[Math.floor(diffs.length / 2)]!;
        const impliedBpb = median / input.beatIntervalSeconds;
        if (within(impliedBpb, g.beatsPerBar)) intervalScore = 1;
      }
    }

    // conservative notation: compound grouping certainty != notation certainty
    const raw = providerScore * 0.6 + intervalScore * 0.4;
    const confidence = g.grouping.length > 1 ? Math.min(raw, 0.8) : raw;
    return {
      numerator: g.beatsPerBar,
      denominator: g.notation[1],
      grouping: g.grouping,
      compound: g.grouping.length > 1,
      confidence,
      source: 'ANALYZED',
      evidence: [
        ...evidence,
        {
          kind: 'INTERVAL_GROUPING',
          detail: `median downbeat spacing / beat interval ${intervalScore > 0 ? '=' : '≠'} ${g.beatsPerBar}`,
          score: intervalScore,
        },
      ],
    };
  });

  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const [best, ...alternatives] = sorted;
  return {
    meter: best ?? {
      numerator: 4,
      denominator: 4,
      confidence: 0.2,
      source: 'ANALYZED',
      evidence: [],
    },
    alternatives: alternatives.filter((m) => m.confidence > 0.05).slice(0, 3),
  };
}
