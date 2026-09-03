import { mulberry32 } from '../utils/random.js';
import { findShape } from '../domain/guitar/chord-shape.js';

/**
 * Realistic strumming. DOWN strums sweep low→high across the played strings,
 * UP strums reverse. 12–22 ms between strings plus seeded micro-timing and
 * velocity humanization. Deterministic for a given seed.
 */
export interface StrumHit {
  /** Seconds relative to the strum's beat. */
  offsetSec: number;
  /** Sounding MIDI note per hit string, in play order. */
  notes: number[];
  direction: 'DOWN' | 'UP';
}

export interface StrumEvent {
  startSec: number;
  direction: 'DOWN' | 'UP';
}

/** Deterministic practice pattern for a meter. */
export function strumPattern(meterNumerator: number): StrumEvent[] {
  // slots are eighth notes within one bar
  if (meterNumerator === 6) {
    // 6/8: D . . D U .
    return [
      { startSec: 0, direction: 'DOWN' },
      { startSec: 3, direction: 'DOWN' },
      { startSec: 4, direction: 'UP' },
    ];
  }
  // 4/4 (and default): D . D U . U D U
  return [
    { startSec: 0, direction: 'DOWN' },
    { startSec: 2, direction: 'DOWN' },
    { startSec: 3, direction: 'UP' },
    { startSec: 5, direction: 'UP' },
    { startSec: 6, direction: 'DOWN' },
    { startSec: 7, direction: 'UP' },
  ];
}

export interface ResolvedStrum {
  offsetSec: number;
  /** Sounding midi + per-string delay/velocity, in play order. */
  strings: Array<{ midi: number; delaySec: number; velocity: number }>;
}

/**
 * Expand strum events over a chord's window into per-string note timings.
 * `soundingMidis` must be the arrangement's actual pitches
 * (open + capo + fret) — never reconstructed from the chord label.
 */
export function resolveStrums(
  events: StrumEvent[],
  soundingMidis: number[],
  options: {
    startSec: number;
    durationSec: number;
    eighthSec: number;
    seed: number;
  },
): ResolvedStrum[] {
  const { startSec, durationSec, eighthSec, seed } = options;
  const rng = mulberry32(seed);
  const out: ResolvedStrum[] = [];
  if (soundingMidis.length === 0) return out;

  for (const event of events) {
    const abs = startSec + event.startSec * eighthSec;
    if (abs >= startSec + durationSec) continue;

    // low → high for DOWN, reverse for UP. Midis sorted ascending = low first.
    const ordered = [...soundingMidis].sort((a, b) => a - b);
    if (event.direction === 'UP') ordered.reverse();

    const strings = ordered.map((midi, i) => {
      const stagger = 0.012 + rng() * 0.01; // 12–22 ms
      return {
        midi,
        delaySec: i * stagger + (rng() - 0.5) * 0.004,
        velocity: 0.85 + rng() * 0.25 * (event.direction === 'DOWN' ? 1 : 0.85),
      };
    });
    out.push({ offsetSec: abs, strings });
  }
  return out;
}

/** Sounding midis for a shape at a capo, from real fretboard logic. */
export function shapeSoundingMidis(shapeName: string, capo: number, openStringMidis: readonly number[]): number[] {
  const shape = findShape(shapeName);
  if (shape === undefined) return [];
  const midis: number[] = [];
  for (const [i, fret] of shape.frets.entries()) {
    if (fret === null) continue; // muted strings do not play
    const open = openStringMidis[i];
    if (open === undefined) continue;
    midis.push(open + fret + capo); // soundingMidi = open + capo + fret
  }
  return midis;
}
