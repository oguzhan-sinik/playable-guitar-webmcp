import type { ChordAnalysisResult } from '../../../domain/analysis/raw-music-analysis.js';
import type { MusicAnalysisProvider, MusicAnalysisRequest, PartialRawMusicAnalysis } from '../music-analysis-provider.js';
import { decodeWav } from './audio-decoder.js';
import { EssentiaRuntime } from './essentia-loader.js';
import { analyzeRhythm } from './rhythm-analyzer.js';
import { analyzeKey } from './tonal-analyzer.js';
import { analyzeChords } from './chord-analyzer.js';
import { normalizeEssentiaOutput } from './normalize-output.js';

export interface EssentiaProviderOptions {
  frameSize?: number;
  hopSize?: number;
  sampleRate?: number;
  minimumChordConfidence?: number;
}

/** Essentia WASM baseline/fallback provider. The only file that knows Essentia
 * exists on the provider side. */
export class EssentiaMusicAnalysisProvider implements MusicAnalysisProvider {
  readonly id = 'essentia';
  readonly version = EssentiaRuntime.version();

  private readonly frameSize: number;
  private readonly hopSize: number;
  private readonly minimumChordConfidence: number;

  constructor(options: EssentiaProviderOptions = {}) {
    this.frameSize = options.frameSize ?? 4096;
    this.hopSize = options.hopSize ?? 2048;
    this.minimumChordConfidence = options.minimumChordConfidence ?? 0.3;
  }

  capabilities() {
    return ['TEMPO', 'BEATS', 'KEY', 'CHORDS'] as const;
  }

  async analyze(audioPath: string, _request?: MusicAnalysisRequest): Promise<PartialRawMusicAnalysis> {
    void _request; // Essentia analyzes the full mix only
    const essentia = EssentiaRuntime.getInstance();
    const audio = await decodeWav(audioPath);
    const durationSeconds = audio.samples.length / audio.sampleRate;

    const rhythm = analyzeRhythm(essentia, audio.samples);
    const tonal = analyzeKey(essentia, audio.samples);
    const chordResult = analyzeChords(essentia, audio.samples, {
      frameSize: this.frameSize,
      hopSize: this.hopSize,
      sampleRate: audio.sampleRate,
      ticksSeconds: rhythm.ticksSeconds,
    });
    const normalized = normalizeEssentiaOutput(
      { rhythm, tonal, chords: chordResult },
      durationSeconds,
      { minimumChordConfidence: this.minimumChordConfidence },
    );

    const chords: ChordAnalysisResult = {
      provider: this.id,
      vocabulary: 'majmin',
      audioVariant: 'FULL_MIX',
      segments: normalized.tonal.chords,
    };

    return {
      rhythm: normalized.rhythm,
      ...(normalized.tonal.key !== undefined && { key: normalized.tonal.key }),
      chords: [chords],
      warnings: normalized.warnings,
    };
  }
}
