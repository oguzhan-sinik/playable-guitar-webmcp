import type { TempoCandidate } from '../../domain/analysis/raw-music-analysis.js';

export interface TempoEvidence {
  kind: string;
  detail: string;
  score: number;
}

export interface ResolvedTempo {
  bpm: number;
  confidence: number;
  alternatives: TempoCandidate[];
  evidence: TempoEvidence[];
}

export interface TempoConsensusInput {
  candidates: TempoCandidate[];
  /** Median interval support: beat times in seconds (optional). */
  beatTimes?: number[];
  /** Downbeat times in seconds (optional). */
  downbeatTimes?: number[];
}

const RELATIVE_TOLERANCE = 0.04; // 4% — typical inter-provider BPM jitter

const within = (a: number, b: number, tol = RELATIVE_TOLERANCE): boolean =>
  Math.abs(a - b) / Math.max(a, b) <= tol;

/** 1 when equal, ~0.8 for a x2 metrical relation, 0 otherwise. */
function metricalAgreement(a: number, b: number): number {
  if (within(a, b)) return 1;
  const ratio = a / b;
  for (const factor of [2, 0.5, 3, 1 / 3]) {
    if (within(ratio, factor, RELATIVE_TOLERANCE)) return 0.8;
  }
  return 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function intervals(times: number[]): number[] {
  const diffs: number[] = [];
  for (let i = 1; i < times.length; i++) diffs.push(times[i]! - times[i - 1]!);
  return diffs.filter((d) => Number.isFinite(d) && d > 0);
}

/**
 * Deterministic tempo consensus from measurable evidence. Not majority vote:
 * every candidate is scored by (a) agreement with other providers' candidates
 * including metrical (half/double) relations, (b) support from the median
 * beat interval, (c) support from downbeat periodicity. Derived half/double
 * hypotheses score lower than independently detected candidates.
 */
export function resolveTempo(input: TempoConsensusInput): ResolvedTempo {
  const evidence: TempoEvidence[] = [];
  const candidates = input.candidates.filter((c) => Number.isFinite(c.bpm) && c.bpm > 0);
  if (candidates.length === 0) {
    throw new Error('No tempo candidates to resolve');
  }

  // Expand: primaries plus their metrical hypotheses (marked derived).
  const expanded: TempoCandidate[] = [];
  for (const c of candidates) {
    expanded.push(c);
    if (c.relation === 'PRIMARY' && !c.derived) {
      expanded.push({ ...c, bpm: c.bpm * 2, relation: 'DOUBLE', derived: true });
      expanded.push({ ...c, bpm: c.bpm / 2, relation: 'HALF', derived: true });
    }
  }

  const beatIntervalBpm = (() => {
    const intervals_ = intervals(input.beatTimes ?? []);
    const med = median(intervals_);
    return med > 0 ? 60 / med : null;
  })();
  const downbeatIntervalSeconds = (() => {
    const intervals_ = intervals(input.downbeatTimes ?? []);
    return intervals_.length > 0 ? median(intervals_) : null;
  })();

  const scored = expanded.map((candidate) => {
    // a detected primary is itself evidence; derived hypotheses start from zero
    let score = candidate.derived ? 0 : 1;
    // (a) agreement with all other *detected* candidates
    let agreement = 0;
    for (const other of candidates) {
      if (other.provider === candidate.provider && Math.abs(other.bpm - candidate.bpm) < 1e-6) continue;
      const a = metricalAgreement(candidate.bpm, other.bpm);
      agreement += a * (other.confidence ?? 1);
    }
    score += agreement;
    // derived hypotheses are not independent evidence; damp them
    if (candidate.derived) score *= 0.45;

    // (b) beat interval support
    if (beatIntervalBpm !== null) {
      const a = metricalAgreement(candidate.bpm, beatIntervalBpm);
      if (a > 0) {
        score += a * 1.5; // measured beat spacing is strong evidence
      }
    }

    // (c) downbeat periodicity: candidate bar period should match downbeat spacing
    if (downbeatIntervalSeconds !== null && beatIntervalBpm !== null) {
      const beatsPerBar = Math.round(downbeatIntervalSeconds / (60 / beatIntervalBpm));
      if (beatsPerBar >= 2 && beatsPerBar <= 6) {
        const barBpm = (60 * beatsPerBar) / downbeatIntervalSeconds;
        const a = metricalAgreement(candidate.bpm, barBpm);
        if (a > 0) score += a;
      }
    }

    return { candidate, score };
  });

  const best = scored.reduce((m, s) => (s.score > m.score ? s : m), scored[0]!);
  const total = scored.reduce((sum, s) => sum + s.score, 0) || 1;

  for (const { candidate, score } of scored.slice(0, 6)) {
    evidence.push({
      kind: candidate.derived ? 'DERIVED_HYPOTHESIS' : 'PROVIDER_AGREEMENT',
      detail: `${candidate.provider} ${candidate.bpm.toFixed(1)} BPM (${candidate.relation}${candidate.derived ? ', derived' : ''}) score ${score.toFixed(2)}`,
      score,
    });
  }
  if (beatIntervalBpm !== null) {
    evidence.push({
      kind: 'BEAT_INTERVALS',
      detail: `median beat interval implies ${beatIntervalBpm.toFixed(1)} BPM`,
      score: best.candidate.bpm,
    });
  }
  if (downbeatIntervalSeconds !== null) {
    evidence.push({
      kind: 'DOWNBEAT_PERIODICITY',
      detail: `median downbeat spacing ${downbeatIntervalSeconds.toFixed(2)}s`,
      score: downbeatIntervalSeconds,
    });
  }

  const alternatives = scored
    .filter((s) => s !== best)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.candidate);

  return {
    bpm: Math.round(best.candidate.bpm * 10) / 10,
    confidence: Math.min(1, best.score / total + 0.25),
    alternatives,
    evidence,
  };
}
