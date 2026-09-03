/** Pipeline-wide analysis settings and versioning. Bump ANALYSIS_PIPELINE_VERSION whenever
 * any stage's behavior changes in a way that should invalidate cached analysis artifacts. */
export const ANALYSIS_PIPELINE_VERSION = '1';

export interface AnalysisConfig {
  /** Observations below this confidence are treated as NO_CHORD. */
  minimumChordConfidence: number;
  /** Drop observations from segments shorter than this many seconds. */
  minimumChordDurationSeconds: number;
  /** Below this overall confidence, `song analyze` warns (non-fatally). */
  lowConfidenceThreshold: number;
  /** Grid used for chord frame analysis. */
  frameSize: number;
  hopSize: number;
  sampleRate: number;
  /** Weights for the heuristic overall confidence score (not calibrated). */
  confidenceWeights: { rhythm: number; key: number; chord: number };
}

export const DEFAULT_ANALYSIS_CONFIG: AnalysisConfig = {
  minimumChordConfidence: 0.3,
  minimumChordDurationSeconds: 0.2,
  lowConfidenceThreshold: 0.35,
  frameSize: 4096,
  hopSize: 2048,
  sampleRate: 44100,
  confidenceWeights: { rhythm: 0.3, key: 0.3, chord: 0.4 },
};
