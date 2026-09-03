import { mulberry32 } from '../utils/random.js';

/**
 * Karplus–Strong plucked-string voice. Pure math, no samples, no music
 * generation model: the renderer is an instrument played by the compiler's
 * exact note choices.
 */

/** One plucked string note as a mono buffer. */
export function pluckString(
  frequencyHz: number,
  durationSec: number,
  sampleRate: number,
  seed: number,
  velocity = 1,
): Float32Array {
  const n = Math.max(1, Math.round(durationSec * sampleRate));
  const out = new Float32Array(n);
  if (!(frequencyHz > 0)) return out;

  const period = Math.max(2, Math.round(sampleRate / frequencyHz));
  const rng = mulberry32(seed);
  const buffer = new Float32Array(period);
  for (let i = 0; i < period; i++) buffer[i] = rng() * 2 - 1;

  // gentle low-pass damping; 0.996 gives a usable acoustic-ish decay
  const damp = 0.996;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const j = i % period;
    const next = buffer[j] !== undefined ? buffer[j]! : 0;
    const value = damp * 0.5 * (next + prev);
    prev = value;
    buffer[j] = value;
    out[i] = value * velocity;
  }
  return out;
}

/** Short metronome click (sine burst with fast decay). */
export function metronomeClick(
  sampleRate: number,
  accent: boolean,
): Float32Array {
  const durationSec = accent ? 0.045 : 0.03;
  const n = Math.max(1, Math.round(durationSec * sampleRate));
  const out = new Float32Array(n);
  const freq = accent ? 1600 : 1100;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const envelope = Math.exp(-t * 90);
    out[i] = Math.sin(2 * Math.PI * freq * t) * envelope * (accent ? 0.5 : 0.3);
  }
  return out;
}

/** Mix `source` into `target` starting at `offsetSamples` (clipped bounds). */
export function mixInto(target: Float32Array, source: Float32Array, offsetSamples: number): void {
  for (let i = 0; i < source.length; i++) {
    const idx = offsetSamples + i;
    if (idx < 0 || idx >= target.length) continue;
    target[idx] = Math.max(-1, Math.min(1, target[idx]! + source[i]!));
  }
}
