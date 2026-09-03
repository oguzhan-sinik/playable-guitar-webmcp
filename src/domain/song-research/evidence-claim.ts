/**
 * Canonical (normalized) forms claims resolve to. Raw evidence strings are
 * never compared directly — consensus operates on these canonical claims.
 */

/** Enharmonic-free key: tonic as pitch-class number (C=0). */
export interface CanonicalKey {
  tonicPitchClass: number;
  mode: 'MAJOR' | 'MINOR' | 'UNKNOWN';
}

/** Broad quality family for consensus; the original spelling is retained. */
export type ChordQualityFamily = 'MAJOR' | 'MINOR' | 'SEVENTH' | 'OTHER';

export interface CanonicalChord {
  /** Sounding root pitch class number (capo already applied). C=0. */
  rootPc: number;
  family: ChordQualityFamily;
  /** Original spelling as observed, e.g. "Dbmaj7". */
  label: string;
  /** Original extension text (e.g. "maj7"), kept for display. */
  extension?: string;
}

export interface CanonicalProgression {
  section?: string;
  chords: CanonicalChord[];
}

export interface CanonicalTempo {
  /** Practice/metric pulse in BPM. */
  bpm: number;
  /** Related reported values interpreted as metrical levels of this pulse. */
  relatedReportedBpms: Array<{ bpm: number; ratio: number }>;
  explanation: string;
}

export interface CanonicalMeter {
  numerator: number;
  denominator: number;
}

/** A raw evidence item joined with the canonical claim it normalized to. */
export interface NormalizedClaim<T = unknown> {
  evidenceId: string;
  claimType: string;
  canonical: T;
  weight: number;
  /** Independent source family (registrable domain) of the evidence. */
  family: string;
}
