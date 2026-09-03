import { CHORD_SIMPLIFICATION_EDGES } from '../../domain/guitar/chord-simplification.js';
import { findShape } from '../../domain/guitar/chord-shape.js';
import { cloneArrangement, measureCandidate, transformationOf } from './measurement.js';
import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import type { ChordEvent } from '../../domain/music/chord.js';
import type { ArrangementTransformation, TransformationContext, TransformationResult } from './transformation.js';

/** New ChordEvent for the simplified shape's harmony. */
function simplifiedChord(chord: ChordEvent, toShapeName: string): ChordEvent | null {
  const targetShape = findShape(toShapeName);
  if (!targetShape) return null;
  // chord names in the library always begin with the root pitch class
  const root = toShapeName.match(/^([A-G]#?)/)?.[1];
  if (!root) return null;
  const qualityBySuffix: Record<string, ChordEvent['quality']> = {
    '': 'major', m: 'minor', '7': 'dominant7', maj7: 'major7', m7: 'minor7',
  };
  const quality = qualityBySuffix[toShapeName.slice(root.length)];
  if (quality === undefined) return null;
  return { ...chord, root: root as ChordEvent['root'], quality };
}

/**
 * Applies declared chord-simplification edges (e.g. Cmaj7→C, G7→G) to all
 * matching chord events, one candidate per edge. Actual difficulty/fidelity
 * are measured, not estimated from the edge table.
 */
export class ChordSimplification implements ArrangementTransformation {
  name = 'CHORD_SIMPLIFICATION' as const;

  apply(arrangement: GuitarArrangement, context: TransformationContext): TransformationResult[] {
    const results: TransformationResult[] = [];
    for (const edge of CHORD_SIMPLIFICATION_EDGES) {
      const affected = arrangement.chords.filter((c) => c.shapeName === edge.from);
      if (affected.length === 0) continue;
      const candidate = cloneArrangement(arrangement);
      const ids: string[] = [];
      let valid = true;
      for (const ev of candidate.chords) {
        if (ev.shapeName !== edge.from) continue;
        const newChord = simplifiedChord(ev.chord, edge.to);
        if (!newChord) {
          valid = false;
          break;
        }
        ev.chord = newChord;
        ev.shapeName = edge.to;
        ids.push(ev.id);
      }
      if (!valid) continue;

      const measured = measureCandidate(
        candidate,
        arrangement,
        transformationOf(
          this.name,
          `${edge.from} → ${edge.to} (${affected.length} chord${affected.length > 1 ? 's' : ''})`,
          ids,
          { edge: `${edge.from}->${edge.to}` },
        ),
        context,
      );
      if (measured) results.push(measured);
    }
    return results;
  }
}
