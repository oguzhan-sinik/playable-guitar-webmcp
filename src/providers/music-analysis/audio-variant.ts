import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { AppError } from '../../errors/app-error.js';
import type { AnalysisAudioVariant } from '../../domain/analysis/raw-music-analysis.js';
import { decodeWav } from './essentia/audio-decoder.js';
import { writeWav } from '../../utils/wav.js';

export interface VariantBuildResult {
  /** variant -> wav path (FULL_MIX maps to the original file). */
  paths: Partial<Record<AnalysisAudioVariant, string>>;
}

const VARIANT_MIXES: Partial<Record<Exclude<AnalysisAudioVariant, 'FULL_MIX'>, string[]>> = {
  NO_VOCALS: ['drums', 'bass', 'other'],
  HARMONIC_MIX: ['bass', 'other'],
  OTHER_STEM: ['other'],
};

/** Mix mono stem WAVs into derived analysis variants. Lengths are aligned to
 * the shortest input (stems come from the same separation, so they match). */
export async function buildAudioVariants(
  fullMixPath: string,
  stemPaths: Record<string, string>,
  outDir: string,
  variants: Array<Exclude<AnalysisAudioVariant, 'FULL_MIX'>>,
): Promise<VariantBuildResult> {
  const paths: Partial<Record<AnalysisAudioVariant, string>> = { FULL_MIX: fullMixPath };
  await mkdir(outDir, { recursive: true });
  for (const variant of variants) {
    const mixStems = VARIANT_MIXES[variant]!;
    const inputs: Float32Array[] = [];
    let sampleRate = 44100;
    for (const stem of mixStems) {
      const stemPath = stemPaths[stem];
      if (stemPath === undefined) {
        throw new AppError('ANALYSIS_AUDIO_MISSING', `Missing ${stem} stem for ${variant}`);
      }
      const decoded = await decodeWav(stemPath);
      sampleRate = decoded.sampleRate;
      inputs.push(decoded.samples);
    }
    const length = Math.min(...inputs.map((s) => s.length));
    const mixed = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      let sum = 0;
      for (const input of inputs) sum += input[i]!;
      mixed[i] = sum / inputs.length;
    }
    const outPath = path.join(outDir, `${variant.toLowerCase()}.wav`);
    await writeWav(outPath, mixed, sampleRate);
    paths[variant] = outPath;
  }
  return { paths };
}
