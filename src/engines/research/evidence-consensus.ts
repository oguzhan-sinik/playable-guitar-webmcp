import type { MusicalEvidence } from '../../domain/song-research/musical-evidence.js';
import type { CanonicalChord, CanonicalKey } from '../../domain/song-research/evidence-claim.js';
import type { ResearchConflict, ResearchHypothesis } from '../../domain/song-research/research-hypothesis.js';
import type { ResolvedSectionHarmony } from '../../domain/song-research/research-resolution.js';
import { combineWeights, clamp01 } from '../../domain/song-research/research-confidence.js';
import { domainFamilyOf } from '../../domain/song-research/evidence-source.js';
import { familyWeights, clusterEvidence, progressionsAgree } from './evidence-cluster.js';
import {
  parseKey,
  parseChordSymbol,
  keyLabel,
  chordLabelForPc,
  normalizeSectionLabel,
  tempoEquivalent,
  ratioName,
  rotationSimilarity,
  preferFlatSpelling,
} from './evidence-normalizer.js';
import { transpositionHypotheses, conflictFromGroups } from './hypothesis-generator.js';

/**
 * Per-field deterministic consensus over canonical claims. No LLM: clusters,
 * per-family weights, noisy-or confidence, explicit conflicts.
 */

// --- identity ---

export interface IdentityResult {
  title?: string;
  artist?: string;
  musicBrainzRecordingId?: string;
  isrc?: string;
  ambiguous: boolean;
  candidateSummaries: string[];
  confidence: number;
}

export function resolveIdentity(
  songIdentity: { title?: string; artist?: string; spotifyId?: string; musicBrainzRecordingId?: string; isrc?: string },
  evidence: MusicalEvidence[],
): IdentityResult {
  const items = evidence.filter((ev) => ev.claimType === 'IDENTITY');
  // the canonical link metadata itself counts as one strong virtual source
  const virtual: Array<{ weight: number; family: string }> = [];
  if (songIdentity.spotifyId !== undefined) virtual.push({ weight: 0.85, family: 'open.spotify.com' });
  if (songIdentity.musicBrainzRecordingId !== undefined) virtual.push({ weight: 0.9, family: 'musicbrainz.org' });

  let title = songIdentity.title ?? '';
  let artist = songIdentity.artist ?? '';
  let mbid: string | undefined = songIdentity.musicBrainzRecordingId;
  let isrc: string | undefined = songIdentity.isrc;
  const artistReadings = new Map<string, Set<string>>();

  for (const ev of items) {
    const v = ev.value as { title?: string; artist?: string; musicBrainzRecordingId?: string; isrc?: string };
    const family = domainFamilyOf(ev.source.url);
    if (artist !== '' && typeof v.artist === 'string' && v.artist.length > 0) {
      const set = artistReadings.get(v.artist.toLowerCase()) ?? new Set<string>();
      set.add(family);
      artistReadings.set(v.artist.toLowerCase(), set);
    }
    if (title === '' && typeof v.title === 'string') title = v.title;
    if (artist === '' && typeof v.artist === 'string') artist = v.artist;
    if (mbid === undefined && typeof v.musicBrainzRecordingId === 'string') mbid = v.musicBrainzRecordingId;
    if (isrc === undefined && typeof v.isrc === 'string') isrc = v.isrc;
  }

  const weights = [...virtual, ...items.map((ev) => ({ weight: ev.confidence ?? 0.8, family: domainFamilyOf(ev.source.url) }))];
  const byFamily = new Map<string, number>();
  for (const w of weights) byFamily.set(w.family, Math.max(byFamily.get(w.family) ?? 0, w.weight));
  // the canonical identity itself (link metadata / user statement) is a real signal
  const baseIdentity = title !== '' ? (artist !== '' ? 0.6 : 0.4) : 0;

  // identity-level ambiguity: two different artists supported by different families
  const strongArtists = [...artistReadings.entries()].filter(([, fams]) => fams.size > 0).map(([a]) => a);
  const ambiguous =
    strongArtists.length > 1 &&
    !strongArtists.some((a) => strongArtists.every((b) => a.includes(b) || b.includes(a)));

  const confidence = clamp01(Math.max(combineWeights([...byFamily.values()]), baseIdentity));

  return {
    ...(title !== '' && { title }),
    ...(artist !== '' && { artist }),
    ...(mbid !== undefined && { musicBrainzRecordingId: mbid }),
    ...(isrc !== undefined && { isrc }),
    ambiguous,
    candidateSummaries: ambiguous ? [...artistReadings.keys()].slice(0, 4) : [],
    confidence,
  };
}

// --- key ---

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

function isDiatonic(rootPc: number, key: CanonicalKey): boolean {
  const scale = key.mode === 'MINOR' ? MINOR_SCALE : MAJOR_SCALE;
  return scale.some((i) => (i + key.tonicPitchClass) % 12 === ((rootPc % 12) + 12) % 12);
}

/** Best-effort key from the resolved chords alone (fallback, never high confidence). */
export function inferKeyFromChords(chords: CanonicalChord[]): (CanonicalKey & { score: number }) | null {
  if (chords.length === 0) return null;
  let best: CanonicalKey | null = null;
  let bestScore = 0;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['MAJOR', 'MINOR'] as const) {
      const key: CanonicalKey = { tonicPitchClass: tonic, mode };
      const hit = chords.filter((c) => isDiatonic(c.rootPc, key)).length / chords.length;
      if (hit > bestScore) {
        bestScore = hit;
        best = key;
      }
    }
  }
  return best === null ? null : { ...best, score: bestScore };
}

export interface KeyResult {
  key?: CanonicalKey;
  display?: string;
  confidence: number;
  inferredFromChords: boolean;
  conflict?: ResearchConflict | undefined;
}

export function resolveKey(evidence: MusicalEvidence[], harmonyChords: CanonicalChord[]): KeyResult {
  const items = evidence.filter((ev) => ev.claimType === 'KEY');
  const parsed = items
    .map((ev) => ({ evidence: ev, canonical: parseKey((ev.value as { key: string }).key) }))
    .filter((p): p is { evidence: MusicalEvidence; canonical: CanonicalKey } => p.canonical !== null);
  const groups = clusterEvidence(parsed, (a, b) => a.tonicPitchClass === b.tonicPitchClass && a.mode === b.mode);

  const flats = preferFlatSpelling(harmonyChords.map((c) => c.label));
  if (groups.length === 0) {
    const inferred = inferKeyFromChords(harmonyChords);
    if (inferred === null || inferred.score < 0.75) {
      return { confidence: inferred === null ? 0 : 0.45, inferredFromChords: inferred !== null };
    }
    return {
      key: { tonicPitchClass: inferred.tonicPitchClass, mode: inferred.mode },
      display: keyLabel(inferred, flats),
      confidence: 0.45 + 0.1 * inferred.score,
      inferredFromChords: true,
    };
  }

  const winner = groups[0]!;
  const conf = combineWeights([...winner.weightByFamily.values()]);
  const key = winner.canonical;
  // theory consistency is support, not truth: adjust modestly, never reject
  const diatonic = harmonyChords.length > 0 ? harmonyChords.filter((c) => isDiatonic(c.rootPc, key)).length / harmonyChords.length : 0.5;
  const adjusted = clamp01(conf + (diatonic >= 0.8 ? 0.05 : diatonic < 0.5 ? -0.12 : 0));

  return {
    key,
    display: keyLabel(key, flats),
    confidence: adjusted,
    inferredFromChords: false,
    ...(groups.length > 1
      ? {
          conflict: conflictFromGroups(
            'key',
            groups,
            (k) => keyLabel(k, flats),
            ['key', 'what key'],
          ),
        }
      : {}),
  };
}

// --- tempo ---

export interface TempoClusterResult {
  bpm: number;
  relatedReportedBpms: Array<{ bpm: number; ratio: number }>;
  explanation: string;
  confidence: number;
  conflict?: ResearchConflict | undefined;
  alternatives: Array<{ bpm: number; support: number }>;
}

export function resolveTempo(evidence: MusicalEvidence[]): TempoClusterResult | { confidence: number } {
  const items = evidence.filter((ev) => ev.claimType === 'TEMPO');
  if (items.length === 0) return { confidence: 0 };
  const bpms = items.map((ev) => ({ ev, bpm: (ev.value as { bpm: number }).bpm }));

  // metrical clustering: 63/126/189 are the same pulse at different levels
  const clusters: Array<{ bpms: number[]; evidence: MusicalEvidence[] }> = [];
  for (const item of bpms) {
    const cluster = clusters.find((c) => c.bpms.some((b) => tempoEquivalent(b, item.bpm).equal));
    if (cluster !== undefined) {
      cluster.bpms.push(item.bpm);
      cluster.evidence.push(item.ev);
    } else {
      clusters.push({ bpms: [item.bpm], evidence: [item.ev] });
    }
  }
  const scored = clusters.map((c) => ({
    cluster: c,
    weight: Math.max(...familyWeights(c.evidence).values()),
  }));
  scored.sort((a, b) => b.weight - a.weight);
  const winner = scored[0]!;

  const members = [...new Set(winner.cluster.bpms)].sort((a, b) => a - b);
  let practice = members[0]!;
  if (practice < 40) practice = practice * 2; // implausibly slow → next level up
  const related = members
    .filter((b) => Math.abs(b - practice) > 0.5)
    .map((b) => ({ bpm: b, ratio: b / practice }));

  const explanation =
    related.length > 0
      ? `Practice pulse ${Math.round(practice)} BPM; sources also report ${related.map((r) => `${Math.round(r.bpm)} BPM (${ratioName(r.ratio)})`).join(', ')}.`
      : `${Math.round(practice)} BPM.`;

  return {
    bpm: Math.round(practice * 10) / 10,
    relatedReportedBpms: related,
    explanation,
    confidence: combineWeights([...familyWeights(winner.cluster.evidence).values()]),
    alternatives: scored.slice(1).map((s) => ({ bpm: Math.min(...s.cluster.bpms), support: s.weight })),
    conflict:
      scored.length > 1 && scored[1]!.weight >= 0.35 * winner.weight
        ? conflictFromGroups(
            'tempo',
            scored.map((s) => ({ canonical: Math.min(...s.cluster.bpms), evidenceIds: [], families: [...familyWeights(s.cluster.evidence).keys()], support: s.weight, weightByFamily: familyWeights(s.cluster.evidence) })),
            (bpm) => `${Math.round(bpm)} BPM`,
            ['BPM', 'tempo'],
          )
        : undefined,
  };
}

// --- meter ---

export interface MeterResult {
  numerator: number;
  denominator: number;
  confidence: number;
  alternatives: Array<{ numerator: number; denominator: number }>;
  conflict?: ResearchConflict | undefined;
}

export function resolveMeter(evidence: MusicalEvidence[]): MeterResult | { confidence: number } {
  const items = evidence.filter((ev) => ev.claimType === 'METER');
  if (items.length === 0) return { confidence: 0 };
  const parsed = items.map((ev) => ({
    evidence: ev,
    canonical: ev.value as { numerator: number; denominator: number },
  }));
  const groups = clusterEvidence(parsed, (a, b) => a.numerator === b.numerator && a.denominator === b.denominator);
  const winner = groups[0]!;
  // 3/4 and 6/8 are NOT merged: meter is resolved independently
  return {
    numerator: winner.canonical.numerator,
    denominator: winner.canonical.denominator,
    confidence: combineWeights([...winner.weightByFamily.values()]),
    alternatives: groups.slice(1).map((g) => g.canonical),
    ...(groups.length > 1
      ? {
          conflict: conflictFromGroups(
            'meter',
            groups,
            (m) => `${m.numerator}/${m.denominator}`,
            ['time signature'],
          ),
        }
      : {}),
  };
}

// --- harmony ---

export interface HarmonyResult {
  sections: ResolvedSectionHarmony[];
  mainChords: string[];
  confidence: number;
  conflicts: ResearchConflict[];
  hypotheses: ResearchHypothesis[];
  preferFlats: boolean;
}

const MIN_PROGRESSION_SIMILARITY = 0.8;

export function resolveHarmony(evidence: MusicalEvidence[]): HarmonyResult {
  const items = evidence.filter((ev) => ev.claimType === 'CHORD_SET' || ev.claimType === 'CHORD_PROGRESSION');
  const bySection = new Map<string, Array<{ evidence: MusicalEvidence; canonical: CanonicalChord[] }>>();
  const hypotheses: ResearchHypothesis[] = [];

  for (const ev of items) {
    const v = ev.value as { chords: string[]; section?: string };
    const section = normalizeSectionLabel(ev.context?.section ?? v.section ?? 'SONG');
    const capo = ev.context?.capo ?? 0;
    // played shapes at a capo become sounding harmony BEFORE any comparison
    const chords = v.chords.map((c) => parseChordSymbol(c, capo)).filter((c): c is CanonicalChord => c !== null);
    if (chords.length === 0) continue;
    const list = bySection.get(section) ?? [];
    list.push({ evidence: ev, canonical: chords });
    bySection.set(section, list);
  }

  const sections: ResolvedSectionHarmony[] = [];
  const conflicts: ResearchConflict[] = [];
  const allWinnerWeights: number[] = [];

  for (const [section, list] of bySection) {
    const groups = clusterEvidence(list, (a, b) => progressionsAgree(a, b) || rotationSimilarity(a, b) >= 0.85);
    if (groups.length === 0) continue;
    const ranked = [...groups].sort((a, b) => b.support - a.support);
    const winner = ranked[0]!;
    hypotheses.push(...transpositionHypotheses(section, ranked.slice(0, 3)));
    if (ranked.length > 1 && ranked[1]!.support >= 0.35 * winner.support) {
      const conflict = conflictFromGroups(
        `harmony:${section}`,
        ranked,
        (chords) => chords.map((c) => c.label).join(' '),
        ['chords', 'capo chords'],
      );
      if (conflict !== undefined) conflicts.push(conflict);
    }
    const weights = [...winner.weightByFamily.values()];
    allWinnerWeights.push(...weights);
    sections.push({
      section,
      chords: winner.canonical,
      families: winner.families,
      confidence: combineWeights(weights),
    });
  }

  const preferFlats = preferFlatSpelling(sections.flatMap((s) => s.chords.map((c) => c.label)));
  const counts = new Map<string, number>();
  for (const s of sections) {
    for (const c of s.chords) {
      const label = chordLabelForPc(c.rootPc, c.family, preferFlats);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  const mainChords = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([label]) => label);

  return {
    sections,
    mainChords,
    confidence: combineWeights(allWinnerWeights),
    conflicts,
    hypotheses,
    preferFlats,
  };
}

// --- structure ---

export interface StructureResult {
  sectionOrder: string[];
  confidence: number;
}

export function resolveStructure(evidence: MusicalEvidence[], harmony: HarmonyResult): StructureResult {
  const sectionEvidence = evidence.filter((ev) => ev.claimType === 'SECTION');
  const order: string[] = [];
  for (const ev of sectionEvidence) {
    const label = normalizeSectionLabel((ev.value as { name: string }).name);
    if (!order.includes(label)) order.push(label);
  }
  // sections implied by progression evidence count as weaker structural support
  for (const s of harmony.sections) {
    if (s.section !== 'SONG' && !order.includes(s.section)) order.push(s.section);
  }
  const sectionWeights = familyWeights(sectionEvidence);
  const explicit = combineWeights([...sectionWeights.values()]);
  const hasHarmonySections = harmony.sections.some((s) => s.section !== 'SONG');
  const confidence = sectionEvidence.length > 0 ? explicit : hasHarmonySections ? 0.4 + 0.3 * harmony.confidence : 0;
  return { sectionOrder: order, confidence };
}
