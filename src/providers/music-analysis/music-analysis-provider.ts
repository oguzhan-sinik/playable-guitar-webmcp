import type {
  AnalysisAudioVariant,
  ChordAnalysisResult,
  KeyAnalysis,
  MusicAnalysisCapability,
  RhythmAnalysis,
  RhythmProviderResult,
  RhythmStructureAnalysis,
  AnalysisWarning,
  TonalAnalysis,
} from '../../domain/analysis/raw-music-analysis.js';

/** What a single analysis run should produce; providers answer only what they
 * declare via capabilities(). */
export interface MusicAnalysisRequest {
  audioVariant?: AnalysisAudioVariant;
  /** Hints; providers may ignore. */
  model?: string;
  device?: string;
}

/** Partial observations from one provider — the union of what any provider can
 * emit. The orchestrator assembles full analyses from several of these. */
export interface PartialRawMusicAnalysis {
  /** Essentia-style aggregate rhythm output. */
  rhythm?: RhythmAnalysis;
  /** Learned rhythm/structure output (beats, downbeats, positions, sections). */
  rhythmStructure?: RhythmStructureAnalysis;
  /** V3 rhythm-provider output (beats/downbeats/meter hypotheses). */
  rhythmResult?: RhythmProviderResult;
  key?: KeyAnalysis;
  /** V1-style aggregate tonal block (key + chord observations). */
  tonal?: TonalAnalysis;
  /** Chord timelines produced by this provider (possibly several variants). */
  chords?: ChordAnalysisResult[];
  warnings?: AnalysisWarning[];
}

/**
 * Music analysis boundary. Implementations (Essentia WASM, Python MIR worker,
 * fakes) own all DSP; everything upstream stays provider neutral and consumes
 * only PartialRawMusicAnalysis. Providers are replaceable by design — see
 * docs/architecture.md.
 */
export interface MusicAnalysisProvider {
  /** Stable identifier used in strategy configs, caches, and provenance. */
  readonly id: string;
  readonly version: string;
  capabilities(): readonly MusicAnalysisCapability[];
  analyze(audioPath: string, request?: MusicAnalysisRequest): Promise<PartialRawMusicAnalysis>;
}
