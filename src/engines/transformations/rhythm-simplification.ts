import { cloneArrangement, measureCandidate, transformationOf } from './measurement.js';
import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import type { ArrangementTransformation, TransformationContext, TransformationResult } from './transformation.js';

type GridLevel = 0.5 | 1 | 'merge';
const GRID_SEQUENCE: GridLevel[] = [0.5, 1, 'merge'];

function gridLabel(g: GridLevel): string {
  return g === 'merge' ? 'one event per chord' : g === 1 ? 'quarter notes' : 'eighth notes';
}

/**
 * Quantize chord-event onsets onto a coarser grid and merge same-chord
 * events landing on the same slot. Floor-snapping preserves downbeats and
 * strong beats: an onset already on the grid never moves. 'merge' collapses
 * runs of the same chord into a single event. Not random subsampling.
 */
export class RhythmSimplification implements ArrangementTransformation {
  name = 'RHYTHM_SIMPLIFICATION' as const;

  apply(arrangement: GuitarArrangement, context: TransformationContext): TransformationResult[] {
    const results: TransformationResult[] = [];
    for (const grid of GRID_SEQUENCE) {
      const candidate = cloneArrangement(arrangement);
      const before = candidate.chords.length;

      // floor-snap onsets to the grid (merge = collapse identical-chord runs)
      for (const ev of candidate.chords) {
        if (grid !== 'merge') {
          ev.startBeat = Math.floor(ev.startBeat / grid) * grid;
        }
      }

      // sort, merge same chord+slot, extend durations to the next event's onset
      candidate.chords.sort((a, b) => a.startBeat - b.startBeat);
      const merged: typeof candidate.chords = [];
      const keyOf = (ev: { shapeName: string; startBeat: number }) =>
        `${ev.shapeName}@${grid === 'merge' ? 'run' : ev.startBeat}`;
      for (const ev of candidate.chords) {
        const prev = merged[merged.length - 1];
        if (prev && keyOf(prev) === keyOf(ev)) {
          prev.durationBeats = Math.max(prev.durationBeats, ev.startBeat + ev.durationBeats - prev.startBeat);
        } else {
          merged.push({ ...ev });
        }
      }
      candidate.chords = merged;
      if (candidate.chords.length >= before) continue;

      // keep notes aligned with the new grid too (onsets only; nothing deleted)
      for (const n of candidate.notes) {
        if (grid !== 'merge') {
          n.startBeat = Math.floor(n.startBeat / grid) * grid;
        }
      }

      const measured = measureCandidate(
        candidate,
        arrangement,
        transformationOf(
          this.name,
          `Rhythm quantized to ${gridLabel(grid)} (${before} → ${candidate.chords.length} chord events)`,
          candidate.chords.map((c) => c.id),
          { grid: String(grid) },
        ),
        context,
      );
      if (measured) results.push(measured);
    }
    return results;
  }
}
