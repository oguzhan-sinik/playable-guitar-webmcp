import { stat } from 'node:fs/promises';
import { AppError } from '../../errors/app-error.js';
import type { AudioNormalizer, AudioProber, NormalizedAudio } from './audio-normalizer.js';
import { checkBinary, runBinary } from './run-binary.js';

export async function checkFfmpeg(): Promise<string> {
  return checkBinary('ffmpeg', ['-version']);
}

export async function checkFfprobe(): Promise<string> {
  return checkBinary('ffprobe', ['-version']);
}

export class FfmpegNormalizer implements AudioNormalizer, AudioProber {
  async normalize(inputPath: string): Promise<NormalizedAudio> {
    const outputPath = inputPath.replace(/\.[^.]+$/, '') + '.analysis.wav';
    await runBinary(
      'ffmpeg',
      ['-y', '-i', inputPath, '-ar', '44100', '-acodec', 'pcm_s16le', outputPath],
      'CONVERSION_FAILED',
    );
    const st = await stat(outputPath);
    if (st.size === 0) {
      throw new AppError('EMPTY_AUDIO', `Normalized output is empty: ${outputPath}`);
    }
    const { durationMs } = await this.probe(outputPath);
    return { filePath: outputPath, durationMs };
  }

  async probe(inputPath: string): Promise<{ durationMs: number }> {
    const stdout = await runBinary(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', inputPath],
      'CONVERSION_FAILED',
    );
    const seconds = parseFloat(stdout.trim());
    if (!Number.isFinite(seconds)) {
      throw new AppError('METADATA_FAILED', `Could not read duration of ${inputPath}`);
    }
    return { durationMs: Math.round(seconds * 1000) };
  }
}
