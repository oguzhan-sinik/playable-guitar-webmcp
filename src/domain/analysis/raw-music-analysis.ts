import { z } from 'zod';
import { PitchClassSchema } from '../music/pitch.js';

/**
 * Provider-neutral raw musical observations. This is the boundary contract:
 * providers (Essentia, fakes, future ensembles) emit this; the SongGraph
 * builder consumes it. No provider types leak past this file.
 */

export const ANALYSIS_AUDIO_VARIANTS = ['FULL_MIX', 'NO_VOCALS', 'HARMONIC_MIX', 'OTHER_STEM'] as const;
export type AnalysisAudioVariant = (typeof ANALYSIS_AUDIO_VARIANTS)[number];

/** Tempo hypothesis. Derived half/double values are explicitly marked — they
 * are hypotheses, never independent detections. */
export const TempoCandidateSchema = z.object({
  bpm: z.number().positive(),
  confidence: z.number().min(0).max(1).optional(),
  provider: z.string(),
  relation: z.enum(['PRIMARY', 'HALF', 'DOUBLE', 'OTHER']).default('PRIMARY'),
  derived: z.boolean().default(false),
});
export type TempoCandidate = z.infer<typeof TempoCandidateSchema>;

export const RawBeatSchema = z.object({
  timeSeconds: z.number().nonnegative(),
  confidence: z.number().min(0).max(1).optional(),
});
export type RawBeat = z.infer<typeof RawBeatSchema>;

export const RawChordObservationSchema = z.object({
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  /** Provider label, e.g. "C", "G#m", "Bb", or the NO_CHORD sentinel. */
  label: z.string(),
  confidence: z.number().min(0).max(1),
});
export type RawChordObservation = z.infer<typeof RawChordObservationSchema>;

export const RhythmAnalysisSchema = z.object({
  bpm: z.number().positive(),
  beats: z.array(RawBeatSchema),
  confidence: z.number().min(0).max(1).optional(),
  /** Alternative tempo estimates (half-time/double-time ambiguity). */
  bpmCandidates: z.array(TempoCandidateSchema).optional(),
});
export type RhythmAnalysis = z.infer<typeof RhythmAnalysisSchema>;

export const KeyAnalysisSchema = z.object({
  root: PitchClassSchema,
  scale: z.enum(['major', 'minor']),
  confidence: z.number().min(0).max(1),
});
export type KeyAnalysis = z.infer<typeof KeyAnalysisSchema>;

export const TonalAnalysisSchema = z.object({
  key: KeyAnalysisSchema.optional(),
  chords: z.array(RawChordObservationSchema),
});
export type TonalAnalysis = z.infer<typeof TonalAnalysisSchema>;

export const AnalysisWarningSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type AnalysisWarning = z.infer<typeof AnalysisWarningSchema>;

export const RawMusicAnalysisSchema = z.object({
  provider: z.string(),
  providerVersion: z.string().optional(),
  analyzedAt: z.string().optional(),
  rhythm: RhythmAnalysisSchema,
  tonal: TonalAnalysisSchema,
  warnings: z.array(AnalysisWarningSchema),
});
export type RawMusicAnalysis = z.infer<typeof RawMusicAnalysisSchema>;

// ---------------------------------------------------------------------------
// V2: capability-based multi-provider analysis
// ---------------------------------------------------------------------------

export const RawSegmentSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  label: z.string(),
});
export type RawSegment = z.infer<typeof RawSegmentSchema>;

/** Learned rhythm/structure output (e.g. All-In-One): raw seconds-based
 * observations. Normalization into beats/meter/sections happens in TS. */
export const RhythmStructureAnalysisSchema = z.object({
  provider: z.string(),
  model: z.string().optional(),
  bpm: z.number().positive().nullable().optional(),
  bpmCandidates: z.array(TempoCandidateSchema).optional(),
  /** Beat times in seconds. */
  beats: z.array(z.number()).optional(),
  /** Downbeat times in seconds. */
  downbeats: z.array(z.number()).optional(),
  /** Position of each beat in its bar, 1-based (e.g. 1 2 3 4 1 2 3 4). */
  beatPositions: z.array(z.number().int().positive()).optional(),
  segments: z.array(RawSegmentSchema).optional(),
  confidence: z.number().min(0).max(1).optional(),
  runtimeMs: z.number().optional(),
});
export type RhythmStructureAnalysis = z.infer<typeof RhythmStructureAnalysisSchema>;

/** One provider's chord timeline on one audio variant. */
export const ChordAnalysisResultSchema = z.object({
  provider: z.string(),
  model: z.string().optional(),
  pipeline: z.string().optional(),
  vocabulary: z.string().default('majmin'),
  audioVariant: z.enum(ANALYSIS_AUDIO_VARIANTS).default('FULL_MIX'),
  segments: z.array(RawChordObservationSchema),
  /** Only set when the provider exposes a trustworthy global score. */
  confidence: z.number().min(0).max(1).optional(),
  runtimeMs: z.number().optional(),
});
export type ChordAnalysisResult = z.infer<typeof ChordAnalysisResultSchema>;

/** What a provider can produce. Providers are only asked for what they declare. */
export const MUSIC_ANALYSIS_CAPABILITIES = [
  'TEMPO', 'BEATS', 'DOWNBEATS', 'METER', 'KEY', 'CHORDS', 'SECTIONS', 'STEMS',
] as const;
export type MusicAnalysisCapability = (typeof MUSIC_ANALYSIS_CAPABILITIES)[number];


// ---------------------------------------------------------------------------
// V3: rhythm providers, pulse levels, metrical hypotheses
// ---------------------------------------------------------------------------

// TempoEvidence lives in engines/analysis-consensus/tempo-consensus.ts; the
// structural shape is mirrored here to avoid a domain -> engine import.
export interface MeterEvidence {
  kind: string;
  detail: string;
  score: number;
}

export interface TempoEvidence {
  kind: string;
  detail: string;
  score: number;
}

export const PULSE_LEVELS = ['SUBDIVISION', 'BEAT', 'BAR'] as const;
export type PulseLevel = (typeof PULSE_LEVELS)[number];

export interface MeterCandidate {
  /** Beats per bar / grouping numerator (e.g. 6 for 6/8). */
  numerator: number;
  denominator?: number;
  /** True for compound groupings like 6/8 = [3,3]. */
  compound?: boolean;
  /** Grouping of beats within the bar, e.g. [3, 3]. */
  grouping?: number[];
  confidence: number;
  source: string;
  evidence: MeterEvidence[];
}

/** One rhythm tracker's raw output. Times are seconds. */
export interface RhythmProviderResult {
  provider: string;
  model?: string;
  beats: number[];
  downbeats?: number[];
  beatPositions?: number[];
  tempoCandidates: TempoCandidate[];
  meterCandidates?: MeterCandidate[];
  /** Per-hypothesis decodings (e.g. madmom DBN beats_per_bar variants). */
  meterHypotheses?: Array<{ beatsPerBar: number; beats: number[]; downbeats: number[]; beatPositions?: number[] }>;
  runtimeMs?: number;
  provenance: { device?: string; packageVersion?: string; analyzedAt: string };
}

/** A tempo hypothesis at a specific metrical level. Derived ratios (2/3, 3/2,
 * 3) are hypotheses with their own evidence — never independent detections. */
export interface MetricalTempoHypothesis {
  bpm: number;
  pulseLevel: PulseLevel;
  meter?: MeterCandidate;
  confidence: number;
  derived: boolean;
  sources: string[];
  evidence: TempoEvidence[];
}

export interface BeatEvidence {
  providers: string[];
  confidence: number;
}

export interface ResolvedRhythm {
  /** Canonical grid (seconds), built from clustered provider beats. */
  beats: Array<{ timeSeconds: number; isDownbeat: boolean; positionInBar?: number; evidence?: BeatEvidence }>;
  downbeatTimes: number[];
  bpm: number;
  /** Which metrical level `bpm` refers to. */
  pulseLevel: PulseLevel;
  /** Learner-friendly click pulse (dotted quarter for compound meters). */
  practicePulseBpm: number;
  practicePulseLevel: PulseLevel;
  meter: MeterCandidate;
  meterAlternatives: MeterCandidate[];
  tempoAlternatives: MetricalTempoHypothesis[];
  confidence: number;
  evidence: TempoEvidence[];
}

/** Learning-tempo vs analysis-tempo distinction (V3). For now they usually
 * match, but the analysis BPM is not automatically the best practice pulse. */
export interface TempoInterpretation {
  analyticalBpm: number;
  practicePulseBpm: number;
  pulseLevel: PulseLevel;
}
