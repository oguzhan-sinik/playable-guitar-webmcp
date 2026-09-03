import type { MusicalEvidence } from '../../domain/song-research/musical-evidence.js';
import { domainFamilyOf } from '../../domain/song-research/evidence-source.js';
import { evidenceWeight } from './research-quality.js';
import { sequenceSimilarity } from './evidence-normalizer.js';
import type { CanonicalChord } from '../../domain/song-research/evidence-claim.js';

/**
 * Clustering + source independence. Three pages from one domain are ONE
 * source family — agreement inside a family is near-worthless compared to
 * agreement across families.
 */

export interface EvidenceGroup<T> {
  canonical: T;
  evidenceIds: string[];
  /** Distinct registrable domains behind this reading. */
  families: string[];
  /** Summed evidence weight. */
  support: number;
  weightByFamily: Map<string, number>;
}

/** Group canonical values that are `same` into EvidenceGroups. */
export function clusterEvidence<T>(
  items: Array<{ evidence: MusicalEvidence; canonical: T }>,
  same: (a: T, b: T) => boolean,
): Array<EvidenceGroup<T>> {
  const groups: Array<EvidenceGroup<T>> = [];
  for (const item of items) {
    const family = domainFamilyOf(item.evidence.source.url);
    const weight = evidenceWeight(item.evidence);
    const existing = groups.find((g) => same(g.canonical, item.canonical));
    if (existing !== undefined) {
      existing.evidenceIds.push(item.evidence.id);
      existing.support += weight;
      if (!existing.families.includes(family)) existing.families.push(family);
      // within a family the strongest single claim counts — repeats never stack
      existing.weightByFamily.set(family, Math.max(existing.weightByFamily.get(family) ?? 0, weight));
    } else {
      groups.push({
        canonical: item.canonical,
        evidenceIds: [item.evidence.id],
        families: [family],
        support: weight,
        weightByFamily: new Map([[family, weight]]),
      });
    }
  }
  return groups.sort((a, b) => b.support - a.support);
}

/** Independent source families present in a set of evidence items. */
export function independentFamilies(evidence: MusicalEvidence[]): string[] {
  return [...new Set(evidence.map((ev) => domainFamilyOf(ev.source.url)))];
}

/**
 * Per-family weight: the strongest single claim in the family (repeats on the
 * same site never stack — one site must not outvote many sites).
 */
export function familyWeights(evidence: MusicalEvidence[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const ev of evidence) {
    const family = domainFamilyOf(ev.source.url);
    const w = evidenceWeight(ev);
    map.set(family, Math.max(map.get(family) ?? 0, w));
  }
  return map;
}

/** Two canonical chord sequences agree strongly (allowing extension drift). */
export function progressionsAgree(a: CanonicalChord[], b: CanonicalChord[]): boolean {
  return sequenceSimilarity(a, b) >= 0.8;
}
