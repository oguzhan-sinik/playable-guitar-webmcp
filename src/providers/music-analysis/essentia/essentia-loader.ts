import { createRequire } from 'node:module';
import { AppError } from '../../../errors/app-error.js';

/**
 * Minimal structural typing over the Essentia.js WASM API we use. The real
 * embind classes are untyped at runtime; this keeps strict TS happy while the
 * library stays behind the provider boundary.
 */
export interface VectorFloat {
  size(): number;
  get(i: number): number;
  delete(): void;
}
export interface VectorString {
  size(): number;
  get(i: number): string;
  delete(): void;
}
export interface VectorVectorFloat {
  size(): number;
  push_back(v: VectorFloat): void;
  delete(): void;
}

export interface EssentiaAlgorithms {
  RhythmExtractor2013(
    signal: unknown,
    maxTempo?: number,
    method?: string,
    minTempo?: number,
  ): {
    bpm: number;
    ticks: VectorFloat;
    confidence: number;
    estimates: VectorFloat;
    bpmIntervals: VectorFloat;
  };
  KeyExtractor(
    audio: unknown,
    averageDetuningCorrection: boolean,
    frameSize: number,
    hopSize: number,
    hpcpSize: number,
    maxFrequency: number,
    maximumSpectralPeaks: number,
    minFrequency: number,
    pcpThreshold: number,
    profileType: string,
    sampleRate: number,
    spectralPeaksThreshold: number,
    tuningFrequency: number,
    weightType: string,
    windowType: string,
  ): {
    key: string;
    scale: string;
    strength: number;
  };
  Windowing(
    frame: unknown,
    normalized: boolean,
    size: number,
    type: string,
    zeroPadding: number,
    zeroPhase: boolean,
  ): { frame: VectorFloat };
  Spectrum(frame: unknown, size: number): { spectrum: VectorFloat };
  SpectralPeaks(
    spectrum: unknown,
    magnitudeThreshold?: number,
    maxFrequency?: number,
    maxPeaks?: number,
    minFrequency?: number,
    orderBy?: string,
    sampleRate?: number,
  ): { frequencies: VectorFloat; magnitudes: VectorFloat };
  HPCP(
    frequencies: unknown,
    magnitudes: unknown,
    bandPreset?: boolean,
    bandSplitFrequency?: number,
    harmonics?: number,
    maxFrequency?: number,
    maxShifted?: boolean,
    minFrequency?: number,
    nonLinear?: boolean,
    normalized?: string,
    referenceFrequency?: number,
    sampleRate?: number,
    size?: number,
    weightType?: string,
    windowSize?: number,
  ): { hpcp: VectorFloat };
  ChordsDetectionBeats(
    pcp: unknown,
    ticks: unknown,
    chromaPick?: string,
    hopSize?: number,
    sampleRate?: number,
  ): { chords: VectorString; strength: VectorFloat };
}

export interface EssentiaModule {
  VectorFloat: new () => VectorFloat;
  VectorVectorFloat: new () => VectorVectorFloat;
}

export interface Essentia {
  algorithms: EssentiaAlgorithms;
  module: EssentiaModule;
  arrayToVector(input: ArrayLike<number>): VectorFloat;
  vectorToArray(input: VectorFloat): Float32Array;
}

/**
 * Loads the Essentia.js WASM runtime. The UMD builds are pre-instantiated at
 * require() time (Node path of the emscripten module), so one require = one
 * runtime; we cache it process-wide and reuse for every analysis.
 */
export class EssentiaRuntime {
  private static instance: Essentia | null = null;

  static getInstance(): Essentia {
    if (EssentiaRuntime.instance !== null) return EssentiaRuntime.instance;
    try {
      const require = createRequire(import.meta.url);
      const wasmModule = require('essentia.js/dist/essentia-wasm.umd.js') as object;
      const EssentiaClass = require('essentia.js/dist/essentia.js-core.umd.js') as new (
        module: object,
        debug?: boolean,
      ) => Essentia;
      EssentiaRuntime.instance = new EssentiaClass(wasmModule, false);
      return EssentiaRuntime.instance;
    } catch (err) {
      throw new AppError('BINARY_UNAVAILABLE', 'Failed to initialize Essentia WASM runtime', {
        cause: err,
      });
    }
  }

  static version(): string {
    return '0.1.3';
  }
}
