import type { CanonicalChord } from '../../domain/song-research/evidence-claim.js';
import type { EvidenceGroup } from './evidence-cluster.js';
import { transpositionShift } from './evidence-normalizer.js';
import type { ResearchConflict, ResearchGap, ResearchHypothesis } from '../../domain/song-research/research-hypothesis.js';

/**
 * Hypothesis generation: cross-source structure that plain clustering misses
 * (transposed duplicates) plus the "what should the agent research next"
 * gap list that drives the iterate loop.
 */

/** Transposed-duplicate hypotheses between same-section progression clusters. */
export function transpositionHypotheses(
  section: string,
  groups: Array<EvidenceGroup<CanonicalChord[]>>,
): ResearchHypothesis[] {
  const out: ResearchHypothesis[] = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const shift = transpositionShift(groups[i]!.canonical, groups[j]!.canonical);
      if (shift === null || shift === 0) continue;
      out.push({
        field: `harmony:${section}`,
        kind: 'LIKELY_TRANSPOSED_EQUIVALENT',
        value: { shiftSemitones: shift, a: groups[i]!.canonical.map((c) => c.label), b: groups[j]!.canonical.map((c) => c.label) },
        support: Math.min(groups[i]!.support, groups[j]!.support),
        evidenceIds: [...groups[i]!.evidenceIds, ...groups[j]!.evidenceIds],
        families: [...new Set([...groups[i]!.families, ...groups[j]!.families])],
        explanation: `Two sources describe ${section} as transposition-equivalent (+${shift} semitones). Checking whether one uses a capo or a simplified key…`,
      });
    }
  }
  return out;
}

export function conflictFromGroups<T>(
  field: string,
  groups: Array<EvidenceGroup<T>>,
  describe: (value: T) => string,
  queries: string[],
): ResearchConflict | undefined {
  if (groups.length < 2) return undefined;
  return {
    field,
    hypotheses: groups.map((g) => ({
      value: describe(g.canonical),
      support: g.support,
      evidenceIds: g.evidenceIds,
      families: g.families,
    })),
    suggestedResolutionQueries: queries,
  };
}

export function researchGaps(input: {
  identity: { title?: string; artist?: string };
  confidence: { key: number; tempo: number; meter: number; harmony: number; structure: number };
  conflicts: ResearchConflict[];
}): ResearchGap[] {
  const q = (suffix: string): string => {
    const t = input.identity.title ?? '';
    const a = input.identity.artist ?? '';
    const song = [a, t].filter((s) => s.length > 0).join(' ');
    return song.length > 0 ? `"${song}" ${suffix}` : suffix;
  };
  const gaps: ResearchGap[] = [];
  if (input.confidence.harmony < 0.75) {
    gaps.push({
      field: 'harmony',
      reason:
        input.confidence.harmony < 0.3
          ? 'No chord progression has been confirmed by an independent source yet.'
          : 'Chord evidence exists but independent sources do not yet agree strongly enough to compile honestly.',
      priority: 'HIGH',
      suggestedQueries: [q('chords chorus'), q('chords capo'), q('ukulele chords')],
    });
  }
  if (input.confidence.key < 0.7) {
    gaps.push({
      field: 'key',
      reason: 'Key is unresolved; chord evidence may still settle it.',
      priority: 'MEDIUM',
      suggestedQueries: [q('key'), q('"what key"')],
    });
  }
  if (input.confidence.tempo < 0.7) {
    gaps.push({
      field: 'tempo',
      reason: input.confidence.tempo < 0.2 ? 'No tempo source found yet.' : 'Tempo sources disagree; a metrical relation is likely but unconfirmed.',
      priority: 'MEDIUM',
      suggestedQueries: [q('BPM'), q('tempo time signature')],
    });
  }
  if (input.confidence.meter < 0.6) {
    gaps.push({
      field: 'meter',
      reason: 'Meter evidence is weak; 4/4 will be assumed for practice unless confirmed.',
      priority: 'LOW',
      suggestedQueries: [q('time signature'), q('BPM 6/8')],
    });
  }
  if (input.confidence.structure < 0.7) {
    gaps.push({
      field: 'structure',
      reason: 'Section order (verse/chorus/…) is not well supported yet.',
      priority: 'MEDIUM',
      suggestedQueries: [q('song structure sections'), q('lyrics structure verse chorus')],
    });
  }
  for (const conflict of input.conflicts) {
    gaps.push({
      field: conflict.field,
      reason: `Independent sources disagree on ${conflict.field}: ${conflict.hypotheses.map((h) => h.value).join(' vs ')}.`,
      priority: conflict.field.startsWith('harmony') ? 'HIGH' : 'MEDIUM',
      suggestedQueries: conflict.suggestedResolutionQueries,
    });
  }
  return gaps;
}
