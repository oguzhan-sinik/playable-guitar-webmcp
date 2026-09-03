import type { CanonicalChord, CanonicalKey, CanonicalMeter } from './evidence-claim.js';
import type { ResearchConfidence } from './research-confidence.js';
import type { ResearchConflict, ResearchGap } from './research-hypothesis.js';
import type { SongResearchStatus } from './research-session.js';

/** Chord progression resolved for one section (sounding harmony, capo applied). */
export interface ResolvedSectionHarmony {
  section: string;
  chords: CanonicalChord[];
  families: string[];
  confidence: number;
}

export interface ResearchResolution {
  status: SongResearchStatus;
  confidence: ResearchConfidence;
  identity: {
    title?: string;
    artist?: string;
    musicBrainzRecordingId?: string;
    isrc?: string;
    /** True when multiple plausibly-matching recordings exist (live/acoustic/remix). */
    ambiguous?: boolean;
    candidateSummaries?: string[];
  };
  key?: CanonicalKey & { /** Preferred display spelling, e.g. "Ab major". */ display: string };
  tempo?: {
    /** Practice/metric pulse in BPM (metrical level resolved). */
    practiceOrMetricBpm: number;
    relatedReportedBpms: Array<{ bpm: number; ratio: number }>;
    support: number;
    explanation: string;
  };
  meter?: CanonicalMeter & { alternatives: CanonicalMeter[] };
  harmony: {
    sections: ResolvedSectionHarmony[];
    mainChords: string[];
    /** Display spelling preference derived from the evidence. */
    preferFlats: boolean;
  };
  structure: { sectionOrder: string[] };
  conflicts: ResearchConflict[];
  gaps: ResearchGap[];
  warnings: string[];
  resolvedAt: string;
  resolverVersion: string;
  researchVersion: number;
}
