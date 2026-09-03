import type { AnalysisAudioVariant } from '../domain/analysis/raw-music-analysis.js';

/**
 * Which providers run and how their outputs combine. No hardcoded provider
 * assumptions in application services — the default strategy lives here and
 * CLI flags can override pieces of it.
 */
export interface AnalysisStrategyConfig {
  rhythmProviders: string[];
  chordProviders: string[];
  useSourceSeparation: boolean;
  chordAudioVariants: AnalysisAudioVariant[];
  consensus: { enabled: boolean };
  /** V3 multi-provider rhythm consensus (beat clustering + meter resolver). */
  rhythmConsensus: { enabled: boolean };
  rhythmWeights: Record<string, number>;
  /** Torch device for the Python worker (cpu | mps | cuda). */
  device: string;
}

export const DEFAULT_ANALYSIS_STRATEGY: AnalysisStrategyConfig = {
  rhythmProviders: ['beat-this', 'madmom-downbeat', 'madmom-beat', 'all-in-one', 'essentia'],
  chordProviders: ['essentia', 'deepchroma', 'cnn-crf'],
  // Ticket 5 showed demixing costs ~5 min and no chord accuracy; keep the
  // provider available via --separation for future experiments.
  useSourceSeparation: false,
  chordAudioVariants: ['FULL_MIX', 'NO_VOCALS', 'HARMONIC_MIX'],
  consensus: { enabled: true },
  rhythmConsensus: { enabled: true },
  rhythmWeights: { 'beat-this': 1.3, 'madmom-downbeat': 1.3, 'madmom-beat': 1.2, 'all-in-one': 1.0, essentia: 0.8 },
  device: process.env.MIR_DEVICE ?? 'cpu',
};

/** Providers whose timelines feed the consensus (as opposed to evaluation-only runs). */
export function chordTimelinesForConsensus(
  strategy: AnalysisStrategyConfig,
  available: Array<{ provider: string; audioVariant: string }>,
): Array<{ provider: string; audioVariant: string }> {
  if (!strategy.consensus.enabled) {
    const primary = strategy.chordProviders[0];
    return available.filter((t) => t.provider === primary && t.audioVariant === 'FULL_MIX').slice(0, 1);
  }
  return available.filter(
    (t) => strategy.chordProviders.includes(t.provider) && strategy.chordAudioVariants.includes(t.audioVariant as never),
  );
}
