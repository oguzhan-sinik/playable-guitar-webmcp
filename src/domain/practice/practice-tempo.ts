/** Practice tempo helpers. Pitch is never altered — only playback rate. */

export const TEMPO_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0] as const;

export const MIN_TEMPO_FACTOR = 0.5;
export const MAX_TEMPO_FACTOR = 1.0;

/** Clamp an arbitrary tempo factor into the supported 0.5–1.0 range. */
export function clampTempoFactor(factor: number | undefined, fallback = 1.0): number {
  if (typeof factor !== 'number' || !Number.isFinite(factor)) return fallback;
  return Math.min(MAX_TEMPO_FACTOR, Math.max(MIN_TEMPO_FACTOR, Math.round(factor * 100) / 100));
}

/** Practice BPM for a song at a tempo factor. */
export function practiceBpm(songBpm: number, tempoFactor: number): number {
  return Math.round(songBpm * tempoFactor * 10) / 10;
}
