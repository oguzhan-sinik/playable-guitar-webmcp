import type { NoteEvent } from '../../domain/music/note.js';
import { optimizeNotePositions } from '../guitar/position-optimizer.js';
import { computeFingeringCost, DEFAULT_FINGERING_WEIGHTS } from '../../domain/guitar/fingering.js';
import { cloneArrangement, measureCandidate, transformationOf } from './measurement.js';
import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import type { ArrangementTransformation, TransformationContext, TransformationResult } from './transformation.js';

function totalMovement(positions: Array<{ string: number; fret: number }>): number {
  let sum = 0;
  for (let i = 1; i < positions.length; i++) {
    sum += computeFingeringCost(positions[i - 1]!, positions[i]!, DEFAULT_FINGERING_WEIGHTS).total;
  }
  return sum;
}

/**
 * Re-runs the DP position optimizer on the same notes/timing. Same pitches,
 * same rhythm → fidelity unchanged; cumulative movement can only improve.
 */
export class FingeringOptimization implements ArrangementTransformation {
  name = 'FINGERING_OPTIMIZATION' as const;

  apply(arrangement: GuitarArrangement, context: TransformationContext): TransformationResult[] {
    if (arrangement.notes.length === 0) return [];
    const candidate = cloneArrangement(arrangement);
    const notes: NoteEvent[] = candidate.notes.map((n) => ({
      id: n.id,
      midi: n.midi,
      startBeat: n.startBeat,
      durationBeats: n.durationBeats,
      confidence: 1,
    }));
    const optimized = optimizeNotePositions(notes, candidate.tuning);
    const before = totalMovement(arrangement.notes.map((n) => n.position));
    const after = totalMovement(optimized.map((o) => o.position));
    if (after >= before) return [];

    candidate.notes = candidate.notes.map((n, i) => ({ ...n, position: optimized[i]!.position }));
    const measured = measureCandidate(
      candidate,
      arrangement,
      transformationOf(
        this.name,
        `Re-optimized fret positions (movement ${before.toFixed(2)} → ${after.toFixed(2)})`,
        candidate.notes.map((n) => n.id),
        { before, after },
      ),
      context,
    );
    return measured ? [measured] : [];
  }
}
