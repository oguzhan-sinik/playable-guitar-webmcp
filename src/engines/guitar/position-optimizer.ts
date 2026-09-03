import type { NoteEvent } from '../../domain/music/note.js';
import type { GuitarConfig } from '../../domain/guitar/tuning.js';
import { getPositionsForMidi } from '../../domain/guitar/fretboard.js';
import type { GuitarPosition } from '../../domain/guitar/guitar-position.js';
import { computeFingeringCost, DEFAULT_FINGERING_WEIGHTS, type FingeringCost, type FingeringWeights } from '../../domain/guitar/fingering.js';
import { UnplayableNoteError } from '../../domain/guitar/guitar-position.js';

export interface GuitarPositionAssignment {
  noteId: string;
  position: GuitarPosition;
  /** Cost from the previous assignment; null for the first note. */
  transitionCost: FingeringCost | null;
}

/**
 * Monophonic sequence optimizer. Full DP over all valid positions per note
 * (Viterbi-style shortest path), minimizing cumulative transition cost.
 * Throws UnplayableNoteError if any note has zero valid positions — never
 * drops, transposes, or octave-shifts silently.
 */
export function optimizeNotePositions(
  notes: NoteEvent[],
  guitar: GuitarConfig,
  weights: FingeringWeights = DEFAULT_FINGERING_WEIGHTS,
): GuitarPositionAssignment[] {
  const ordered = [...notes].sort((a, b) => a.startBeat - b.startBeat);

  const candidates = ordered.map((note) => {
    const positions = getPositionsForMidi(guitar, note.midi);
    if (positions.length === 0) {
      throw new UnplayableNoteError(note.midi, `no valid position on ${guitar.frets}-fret guitar`);
    }
    return positions;
  });

  // DP: cost[i][j] = min cumulative cost ending at note i, position j.
  let prevCosts = candidates[0]!.map(() => 0);
  let prevTables: Array<Array<number> | null> = candidates[0]!.map(() => null);

  for (let i = 1; i < candidates.length; i++) {
    const curCosts = candidates[i]!.map(() => Infinity);
    const curTables: Array<Array<number> | null> = candidates[i]!.map(() => null);
    for (let j = 0; j < candidates[i]!.length; j++) {
      for (let k = 0; k < candidates[i - 1]!.length; k++) {
        const step = computeFingeringCost(
          candidates[i - 1]![k]!,
          candidates[i]![j]!,
          weights,
        );
        const total = prevCosts[k]! + step.total;
        if (total < curCosts[j]!) {
          curCosts[j] = total;
          curTables[j] = [k];
        }
      }
    }
    prevCosts = curCosts;
    prevTables = curTables;
  }

  // Reconstruct best path.
  let best = 0;
  for (let j = 1; j < prevCosts.length; j++) {
    if (prevCosts[j]! < prevCosts[best]!) best = j;
  }
  const indices: number[] = new Array(candidates.length);
  let idx = best;
  for (let i = candidates.length - 1; i >= 0; i--) {
    indices[i] = idx;
    const back = i === 0 ? null : prevTables[idx];
    if (i > 0) {
      idx = back![0]!;
    }
  }

  return ordered.map((note, i) => {
    const position = candidates[i]![indices[i]!]!;
    return {
      noteId: note.id,
      position,
      transitionCost:
        i === 0
          ? null
          : computeFingeringCost(candidates[i - 1]![indices[i - 1]!]!, position, weights),
    };
  });
}
