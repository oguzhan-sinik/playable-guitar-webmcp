import { readFile } from 'node:fs/promises';
import { AppError } from '../../../errors/app-error.js';

/**
 * Minimal PCM16 WAV reader — exactly enough for our normalized analysis.wav
 * (44.1 kHz s16le). Not a general audio codec; anything else is rejected and
 * left to ffmpeg (the ingestion normalizer's job).
 */
export interface DecodedAudio {
  sampleRate: number;
  channels: number;
  /** Interleaved-ish: mono mixdown, one sample per frame, range [-1, 1]. */
  samples: Float32Array;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

export async function decodeWav(filePath: string): Promise<DecodedAudio> {
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    throw new AppError('ANALYSIS_AUDIO_MISSING', `Audio file not found: ${filePath}`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
      throw new Error('Not a RIFF/WAVE file');
    }
    let format: { audioFormat: number; channels: number; sampleRate: number; bits: number } | null = null;
    let dataOffset = -1;
    let dataLength = 0;
    let offset = 12;
    while (offset + 8 <= view.byteLength) {
      const id = readAscii(view, offset, 4);
      const size = view.getUint32(offset + 4, true);
      if (id === 'fmt ') {
        format = {
          audioFormat: view.getUint16(offset + 8, true),
          channels: view.getUint16(offset + 10, true),
          sampleRate: view.getUint32(offset + 12, true),
          bits: view.getUint16(offset + 22, true),
        };
      } else if (id === 'data') {
        dataOffset = offset + 8;
        dataLength = Math.min(size, view.byteLength - dataOffset);
      }
      offset += 8 + size + (size % 2);
    }
    if (format === null || dataOffset < 0) throw new Error('Missing fmt/data chunk');
    if (format.audioFormat !== 1 || format.bits !== 16) {
      throw new Error(`Expected PCM s16le, got format=${format.audioFormat} bits=${format.bits}`);
    }
    if (format.channels < 1) throw new Error('No channels');

    const frameCount = Math.floor(dataLength / 2 / format.channels);
    if (frameCount === 0) throw new Error('Empty audio data');
    const samples = new Float32Array(frameCount);
    for (let i = 0; i < frameCount; i++) {
      let sum = 0;
      for (let c = 0; c < format.channels; c++) {
        sum += view.getInt16(dataOffset + (i * format.channels + c) * 2, true);
      }
      samples[i] = sum / format.channels / 32768;
    }
    return { sampleRate: format.sampleRate, channels: format.channels, samples };
  } catch (err) {
    throw new AppError('ANALYSIS_DECODE_FAILED', `Cannot decode WAV ${filePath}: ${(err as Error).message}`, {
      cause: err,
    });
  }
}
