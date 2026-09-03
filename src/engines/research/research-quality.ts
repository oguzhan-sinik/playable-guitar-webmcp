import type { MusicalEvidence } from '../../domain/song-research/musical-evidence.js';
import type { EvidenceClaimType } from '../../domain/song-research/musical-evidence.js';
import type { EvidenceSourceKind } from '../../domain/song-research/evidence-source.js';

/**
 * Modest, claim-specific source priors. Agreement across independent sources
 * matters far more than branding — no source scores above 0.95 on its own.
 */
const PRIORS: Record<EvidenceClaimType, Partial<Record<EvidenceSourceKind, number>>> = {
  IDENTITY: {
    OFFICIAL_METADATA: 0.95,
    MUSIC_DATABASE: 0.9,
    MUSIC_ANALYSIS_RESOURCE: 0.6,
    ARTICLE: 0.4,
    CHORD_RESOURCE: 0.4,
    OTHER: 0.3,
  },
  KEY: {
    MUSIC_ANALYSIS_RESOURCE: 0.7,
    MUSIC_DATABASE: 0.6,
    ARTICLE: 0.35,
    CHORD_RESOURCE: 0.45,
    OFFICIAL_METADATA: 0.5,
    OTHER: 0.25,
  },
  TEMPO: {
    MUSIC_ANALYSIS_RESOURCE: 0.7,
    MUSIC_DATABASE: 0.6,
    ARTICLE: 0.35,
    CHORD_RESOURCE: 0.35,
    OFFICIAL_METADATA: 0.5,
    OTHER: 0.25,
  },
  METER: {
    MUSIC_ANALYSIS_RESOURCE: 0.7,
    MUSIC_DATABASE: 0.55,
    ARTICLE: 0.35,
    CHORD_RESOURCE: 0.45,
    OFFICIAL_METADATA: 0.4,
    OTHER: 0.25,
  },
  CHORD_SET: {
    CHORD_RESOURCE: 0.7,
    MUSIC_ANALYSIS_RESOURCE: 0.65,
    ARTICLE: 0.4,
    MUSIC_DATABASE: 0.3,
    OFFICIAL_METADATA: 0.3,
    OTHER: 0.25,
  },
  CHORD_PROGRESSION: {
    CHORD_RESOURCE: 0.7,
    MUSIC_ANALYSIS_RESOURCE: 0.65,
    ARTICLE: 0.4,
    MUSIC_DATABASE: 0.3,
    OFFICIAL_METADATA: 0.3,
    OTHER: 0.25,
  },
  SECTION: {
    MUSIC_ANALYSIS_RESOURCE: 0.7,
    CHORD_RESOURCE: 0.5,
    ARTICLE: 0.4,
    MUSIC_DATABASE: 0.4,
    OFFICIAL_METADATA: 0.4,
    OTHER: 0.25,
  },
  DURATION: {
    OFFICIAL_METADATA: 0.95,
    MUSIC_DATABASE: 0.9,
    MUSIC_ANALYSIS_RESOURCE: 0.6,
    ARTICLE: 0.3,
    CHORD_RESOURCE: 0.3,
    OTHER: 0.25,
  },
  CAPO: {
    CHORD_RESOURCE: 0.7,
    ARTICLE: 0.4,
    MUSIC_ANALYSIS_RESOURCE: 0.4,
    MUSIC_DATABASE: 0.3,
    OFFICIAL_METADATA: 0.3,
    OTHER: 0.25,
  },
  SECTION_STRUCTURE: {
    MUSIC_ANALYSIS_RESOURCE: 0.7,
    CHORD_RESOURCE: 0.5,
    ARTICLE: 0.4,
    MUSIC_DATABASE: 0.4,
    OFFICIAL_METADATA: 0.4,
    OTHER: 0.25,
  },
  FORM: {
    MUSIC_ANALYSIS_RESOURCE: 0.7,
    CHORD_RESOURCE: 0.5,
    ARTICLE: 0.4,
    MUSIC_DATABASE: 0.4,
    OFFICIAL_METADATA: 0.4,
    OTHER: 0.25,
  },
  SHORT_MOTIF: {
    MUSIC_ANALYSIS_RESOURCE: 0.65,
    ARTICLE: 0.4,
    CHORD_RESOURCE: 0.4,
    MUSIC_DATABASE: 0.3,
    OFFICIAL_METADATA: 0.3,
    OTHER: 0.25,
  },
};

/**
 * Total weight of one evidence item: source prior × submission confidence.
 * The user's own confirmation is trusted but not absolute (0.9).
 */
export function evidenceWeight(ev: MusicalEvidence): number {
  const prior = ev.submittedBy === 'USER' ? 0.9 : (PRIORS[ev.claimType][ev.source.kind] ?? 0.3);
  return prior * (ev.confidence ?? 0.9);
}
