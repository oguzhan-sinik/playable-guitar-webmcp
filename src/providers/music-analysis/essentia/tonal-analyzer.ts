import { AppError } from '../../../errors/app-error.js';
import { normalizePitchClass } from '../../../domain/music/normalize.js';
import type { Essentia } from './essentia-loader.js';

export interface TonalResult {
  root: ReturnType<typeof normalizePitchClass>;
  scale: string;
  /** Essentia's KeyExtractor "strength". NOT a calibrated probability — we
   * clamp it into [0, 1] and treat it as a relative score only. */
  confidence: number;
}

/** KeyExtractor over the whole track. */
export function analyzeKey(essentia: Essentia, samples: Float32Array): TonalResult {
  const audio = essentia.arrayToVector(samples);
  try {
    const k = essentia.algorithms.KeyExtractor(
      audio,
      true,
      4096,
      4096,
      12,
      3500,
      60,
      25,
      0.2,
      'bgate',
      44100,
      0.0001,
      440,
      'cosine',
      'hann',
    );
    return {
      root: normalizePitchClass(k.key),
      scale: k.scale,
      confidence: Math.max(0, Math.min(1, k.strength)),
    };
  } catch (err) {
    throw new AppError('TONAL_ANALYSIS_FAILED', `Key analysis failed: ${(err as Error).message}`, {
      cause: err,
    });
  } finally {
    audio.delete();
  }
}
