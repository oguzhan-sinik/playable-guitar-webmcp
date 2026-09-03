import type { ArrangementChordEvent, ArrangementNoteEvent } from '../../domain/arrangement/index.js';
import { findShape } from '../../domain/guitar/chord-shape.js';
import {
  computeFingeringCost,
  DEFAULT_FINGERING_WEIGHTS,
} from '../../domain/guitar/fingering.js';
import { AppError } from '../../errors/app-error.js';
import { clamp10, type DifficultyConfig } from './config.js';

/**
 * Same physical transition in less time = harder.
 * score = mean(transitionCost / availableBeats) * (effectiveBpm / refBpm) * scale.
 * C→G every 4 beats @80bpm ≈ easy; every 1 beat @160bpm ≈ hard.
 */
const SPEED_SCALE = 1.25;

export function computeTransitionSpeed(
  chords: ArrangementChordEvent[],
  notes: ArrangementNoteEvent[],
  bpm: number,
  tempoFactor: number,
  config: DifficultyConfig,
): number {
  const effectiveBpm = bpm * tempoFactor;
  const entries: Array<{ cost: number; beats: number }> = [];

  const sorted = chords.slice().sort((a, b) => a.startBeat - b.startBeat);
  for (let i = 1; i < sorted.length; i++) {
    const prev = findShape(sorted[i - 1]!.shapeName);
    const next = findShape(sorted[i]!.shapeName);
    if (!prev || !next) throw new AppError('DOMAIN_VALIDATION', `Unknown chord shape`);
    const anchor = (shape: typeof prev) => {
      const fretted = shapeToPositions(shape).filter((p) => p.fret > 0);
      return fretted.reduce<{ string: number; fret: number }>((m, p) =>
        m.fret === 0 || p.fret < m.fret ? p : m, { string: 0, fret: Infinity });
    };
    const cost = computeFingeringCost(anchor(prev), anchor(next), DEFAULT_FINGERING_WEIGHTS).total;
    const beats = sorted[i]!.startBeat - sorted[i - 1]!.startBeat;
    if (beats > 0) entries.push({ cost, beats });
  }

  for (let i = 1; i < notes.length; i++) {
    const beats = notes[i]!.startBeat - notes[i - 1]!.startBeat;
    if (beats > 0) {
      entries.push({
        cost: computeFingeringCost(notes[i - 1]!.position, notes[i]!.position, DEFAULT_FINGERING_WEIGHTS).total,
        beats,
      });
    }
  }

  if (entries.length === 0) return 0;
  const meanSpeed = entries.reduce((a, e) => a + e.cost / e.beats, 0) / entries.length;
  return clamp10(meanSpeed * (effectiveBpm / config.refBpm) * SPEED_SCALE);
}

function shapeToPositions(shape: { frets: Array<number | null> }) {
  return shape.frets
    .map((fret, i) => ({ string: i + 1, fret: fret ?? -1 }))
    .filter((p) => p.fret > 0);
}
