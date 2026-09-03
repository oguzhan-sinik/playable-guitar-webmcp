import { AppError } from '../../../errors/app-error.js';
import type { Essentia, VectorFloat, VectorVectorFloat } from './essentia-loader.js';

export interface ChordResult {
  /** One label per detected beat interval, e.g. "C", "G#m". */
  chords: string[];
  /** Essentia chord strengths aligned with `chords`; relative, not calibrated. */
  strengths: number[];
}

/**
 * Frame-wise HPCP (windowing -> spectrum -> spectral peaks -> HPCP) followed by
 * beat-synchronous chord estimation (ChordsDetectionBeats). HPCP frames are
 * accumulated in a single WASM VectorVectorFloat; all per-frame temporaries
 * are deleted each iteration so we never hold more than one frame's worth of
 * spectral data at a time.
 */
export function analyzeChords(
  essentia: Essentia,
  samples: Float32Array,
  options: {
    frameSize: number;
    hopSize: number;
    sampleRate: number;
    /** Detected beat times in seconds (from the rhythm stage). */
    ticksSeconds: number[];
  },
): ChordResult {
  const { frameSize, hopSize, sampleRate, ticksSeconds } = options;
  const algs = essentia.algorithms;
  const pcpFrames: VectorVectorFloat = new essentia.module.VectorVectorFloat();
  const ticks = essentia.arrayToVector(ticksSeconds);
  const frame = new Float32Array(frameSize);
  const keptPcpVectors: VectorFloat[] = [];
  try {
    for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
      frame.set(samples.subarray(start, start + frameSize));
      const frameVec = essentia.arrayToVector(frame);
      let windowed: VectorFloat | null = null;
      let spectrum: VectorFloat | null = null;
      try {
        windowed = algs.Windowing(frameVec, true, frameSize, 'hann', 0, true).frame;
        spectrum = algs.Spectrum(windowed, frameSize).spectrum;
        const peaks = algs.SpectralPeaks(spectrum, 0.0001, 5000, 100, 55, 'frequency', sampleRate);
        const hpcp = algs.HPCP(
          peaks.frequencies,
          peaks.magnitudes,
          true,
          500,
          0,
          5000,
          false,
          55,
          false,
          'unitMax',
          440,
          sampleRate,
          12,
          'squaredCosine',
          1,
        ).hpcp;
        pcpFrames.push_back(hpcp);
        keptPcpVectors.push(hpcp);
        peaks.frequencies.delete();
        peaks.magnitudes.delete();
      } finally {
        frameVec.delete();
        if (windowed !== null) windowed.delete();
        if (spectrum !== null) spectrum.delete();
      }
    }
    if (pcpFrames.size() === 0) {
      throw new AppError('CHORD_ANALYSIS_FAILED', 'Audio too short for frame analysis');
    }
    const detected = algs.ChordsDetectionBeats(pcpFrames, ticks, 'interbeat_median', hopSize, sampleRate);
    try {
      const chords: string[] = [];
      for (let i = 0; i < detected.chords.size(); i++) chords.push(detected.chords.get(i));
      const strengths = Array.from(essentia.vectorToArray(detected.strength));
      return { chords, strengths };
    } finally {
      detected.chords.delete();
      detected.strength.delete();
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('CHORD_ANALYSIS_FAILED', `Chord analysis failed: ${(err as Error).message}`, {
      cause: err,
    });
  } finally {
    for (const v of keptPcpVectors) v.delete();
    pcpFrames.delete();
    ticks.delete();
  }
}
