import { AppError } from '../../../errors/app-error.js';
import type { Essentia } from './essentia-loader.js';

export interface RhythmResult {
  bpm: number;
  /** Tick positions in seconds (detected beat times). */
  ticksSeconds: number[];
  confidence: number;
  /** Alternative tempo estimates from the multifeature method. */
  estimates: number[];
  bpmIntervals: number[];
}

/** RhythmExtractor2013 (multifeature). Keeps ALL tempo alternatives — half/double
 * time ambiguity is preserved for later resolution, never silently collapsed. */
export function analyzeRhythm(essentia: Essentia, samples: Float32Array): RhythmResult {
  const signal = essentia.arrayToVector(samples);
  try {
    const r = essentia.algorithms.RhythmExtractor2013(signal, 208, 'multifeature', 40);
    const result: RhythmResult = {
      bpm: r.bpm,
      ticksSeconds: Array.from(essentia.vectorToArray(r.ticks)),
      confidence: r.confidence,
      estimates: Array.from(essentia.vectorToArray(r.estimates)),
      bpmIntervals: Array.from(essentia.vectorToArray(r.bpmIntervals)),
    };
    r.ticks.delete();
    r.estimates.delete();
    r.bpmIntervals.delete();
    return result;
  } catch (err) {
    throw new AppError('RHYTHM_ANALYSIS_FAILED', `Rhythm analysis failed: ${(err as Error).message}`, {
      cause: err,
    });
  } finally {
    signal.delete();
  }
}
