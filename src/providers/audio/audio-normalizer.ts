export interface NormalizedAudio {
  filePath: string;
  durationMs: number;
}

export interface AudioNormalizer {
  /** Convert input to WAV 44.1kHz PCM for analysis. */
  normalize(inputPath: string): Promise<NormalizedAudio>;
}

export interface AudioProber {
  probe(inputPath: string): Promise<{ durationMs: number }>;
}
