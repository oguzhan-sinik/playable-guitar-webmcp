import type { MetricalTempoHypothesis, MeterCandidate, PulseLevel, TempoCandidate } from '../../domain/analysis/raw-music-analysis.js';

export interface PulseHypothesisInput {
  /** Median inter-beat interval in seconds (the trackers' "beat" level). */
  beatIntervalSeconds: number;
  /** Median inter-downbeat interval in seconds (optional). */
  downbeatIntervalSeconds?: number;
  /** Candidates as emitted by providers (already includes some derived). */
  candidates: TempoCandidate[];
  /** Each provider's own median beat BPM — bases for metrical hypotheses. */
  perProviderBeatBpm?: Array<{ provider: string; bpm: number }>;
}

const within = (a: number, b: number, tol = 0.04): boolean =>
  a > 0 && b > 0 && Math.abs(a - b) / Math.max(a, b) <= tol;

/**
 * Metrical ratio families. A detected pulse P is re-expressed at every
 * musically meaningful relation; each derived value is a HYPOTHESIS scored by
 * downbeat/grouping evidence, never an independent detection.
 *
 * Ratios: 1/3, 1/2, 2/3, 1, 3/2, 2, 3 — this is what lets a 95 BPM detection
 * resolve to a 63 BPM dotted-quarter beat (95 × 2/3) without any
 * song-specific rules.
 */
export const METRICAL_RATIOS: Array<{ ratio: number; label: string; relation: 'PRIMARY' | 'HALF' | 'DOUBLE' | 'OTHER' }> = [
  { ratio: 1 / 3, label: '1:3', relation: 'OTHER' },
  { ratio: 1 / 2, label: '1:2', relation: 'HALF' },
  { ratio: 2 / 3, label: '2:3', relation: 'OTHER' },
  { ratio: 1, label: '1:1', relation: 'PRIMARY' },
  { ratio: 3 / 2, label: '3:2', relation: 'OTHER' },
  { ratio: 2, label: '2:1', relation: 'DOUBLE' },
  { ratio: 3, label: '3:1', relation: 'OTHER' },
];

/** Pulse-level assignment per relation relative to a tracker's beat: the
 * tracker's own level is BEAT; faster relations are subdivisions; slower
 * relations are beat- or bar-level re-readings (2/3 is the compound
 * dotted-quarter beat, 1/3 and 1/2 are bar-level groupings). */
function pulseLevelFor(ratio: number): PulseLevel {
  if (ratio === 1) return 'BEAT';
  if (ratio === 3 || ratio === 2 || ratio === 1.5) return 'SUBDIVISION';
  if (ratio === 2 / 3) return 'BEAT';
  if (ratio === 1 / 2 || ratio === 1 / 3) return 'BAR';
  return 'BEAT';
}

/** Generate metrical tempo hypotheses from the trackers' detected beat
 * intervals. Only values supported by at least one provider observation or
 * the downbeat interval survive as plausible; the rest are dropped entirely. */
export function generatePulseHypotheses(input: PulseHypothesisInput): MetricalTempoHypothesis[] {
  // bases: the clustered grid plus every provider's own beat level — a single
  // clustered median is unstable when providers track different levels
  const bases: Array<{ bpm: number; source: string }> = [
    { bpm: 60 / input.beatIntervalSeconds, source: 'clustered-beats' },
    ...(input.perProviderBeatBpm ?? []).map((p) => ({ bpm: p.bpm, source: p.provider })),
  ];

  const byBpm = new Map<number, MetricalTempoHypothesis>();
  for (const base of bases) {
    for (const { ratio, label, relation } of METRICAL_RATIOS) {
      const bpm = base.bpm * ratio;
      if (bpm < 20 || bpm > 400) continue;
      const rounded = Math.round(bpm * 2) / 2; // 0.5 BPM resolution for merging

      const sources: string[] = [];
      let evidenceScore = 0;
      for (const candidate of input.candidates) {
        if (within(candidate.bpm, bpm)) {
          sources.push(candidate.provider);
          evidenceScore += 1 * (candidate.confidence ?? 1);
        }
      }
      if (ratio === 1) evidenceScore += 1; // a tracker's own beat level is evidence

      let barEvidence = 0;
      let matchedBarBeats = 0;
      if (input.downbeatIntervalSeconds !== undefined) {
        for (const bpb of [2, 3, 4, 6]) {
          const impliedBeatBpm = (60 * bpb) / input.downbeatIntervalSeconds;
          if (within(bpm, impliedBeatBpm)) {
            barEvidence = Math.max(barEvidence, 1);
            matchedBarBeats = bpb;
            break;
          }
        }
      }
      if (barEvidence > 0) evidenceScore += barEvidence * 2;
      if (evidenceScore <= 0) continue;

      const hypothesis: MetricalTempoHypothesis = {
        bpm: rounded,
        pulseLevel: pulseLevelFor(ratio),
        confidence: Math.min(1, evidenceScore / 4),
        derived: ratio !== 1,
        sources: [...new Set(sources)],
        evidence: [
          {
            kind: 'METRICAL_RATIO',
            detail: `base ${base.source} ${base.bpm.toFixed(1)} BPM × ${label} -> ${bpm.toFixed(1)} BPM`,
            score: evidenceScore,
          },
          ...(barEvidence > 0
            ? [
                {
                  kind: 'DOWNBEAT_PERIODICITY',
                  detail: `${bpm.toFixed(1)} BPM implies ${matchedBarBeats} beats per downbeat interval`,
                  score: barEvidence * 2,
                },
              ]
            : []),
        ],
      };

      const existing = byBpm.get(rounded);
      if (existing === undefined) {
        byBpm.set(rounded, hypothesis);
      } else {
        // merge: strongest confidence wins, evidence and sources accumulate
        byBpm.set(rounded, {
          ...existing,
          confidence: Math.max(existing.confidence, hypothesis.confidence),
          pulseLevel: existing.confidence >= hypothesis.confidence ? existing.pulseLevel : hypothesis.pulseLevel,
          sources: [...new Set([...existing.sources, ...hypothesis.sources])],
          evidence: [...existing.evidence, ...hypothesis.evidence],
        });
      }
    }
  }

  return [...byBpm.values()];
}

/** Attach a meter candidate to the winning hypothesis later (meter-resolver);
 * here we only build hypotheses. */
export function bestPulseHypothesis(hypotheses: MetricalTempoHypothesis[]): MetricalTempoHypothesis {
  return hypotheses.reduce((m, h) => (h.confidence > m.confidence ? h : m), hypotheses[0]!);
}

export function meterFromGrouping(grouping: number[], source: string, confidence: number): MeterCandidate {
  return {
    numerator: grouping.reduce((a, b) => a + b, 0),
    grouping,
    compound: grouping.length > 1,
    confidence,
    source,
    evidence: [],
  };
}
