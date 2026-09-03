import { effectiveSalience } from '../fidelity/melody-similarity.js';
import { cloneArrangement, measureCandidate, transformationOf } from './measurement.js';
import type { ArrangementTransformation, TransformationContext, TransformationResult } from './transformation.js';
import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';

const TARGET_DENSITIES = [0.75, 0.5, 0.25];

/**
 * Deterministic salience-based melody reduction.
 *
 * Deletion order: lowest derived+stored salience first. Notes protected by
 * motif membership are considered only after all unprotected notes — and
 * motifs with recognizabilityImportance >= threshold are never deleted.
 */
export class MelodyReduction implements ArrangementTransformation {
  name = 'MELODY_REDUCTION' as const;

  apply(arrangement: GuitarArrangement, context: TransformationContext): TransformationResult[] {
    if (arrangement.notes.length === 0) return [];
    const results: TransformationResult[] = [];
    const motifOf = new Map<string, { importance: number }>();
    for (const m of context.song.motifs) {
      for (const id of m.eventIds) motifOf.set(id, { importance: m.recognizabilityImportance });
    }

    const salienceOf = (note: GuitarArrangement['notes'][number]) => {
      const src = context.song.melody?.notes.find((o) => o.id === note.sourceNoteId);
      const base = src ? effectiveSalience(src, (id) => (motifOf.get(id) ? ['m'] : [])) : note.salience;
      return base;
    };

    const sortedNotes = arrangement.notes
      .slice()
      .sort((a, b) => {
        const sa = salienceOf(a);
        const sb = salienceOf(b);
        if (sa !== sb) return sa - sb;
        return a.startBeat - b.startBeat;
      });

    for (const target of TARGET_DENSITIES) {
      const keepCount = Math.max(1, Math.ceil(arrangement.notes.length * target));
      const isProtected = (n: GuitarArrangement['notes'][number]) => {
        if (n.sourceNoteId === undefined) return false;
        const m = motifOf.get(n.sourceNoteId);
        return m !== undefined && m.importance >= 0.7;
      };
      const protectedNotes = sortedNotes.filter(isProtected);
      const unprotected = sortedNotes.filter((n) => !isProtected(n));
      const deletable = [...unprotected, ...protectedNotes].slice(0, arrangement.notes.length - keepCount);
      if (deletable.length === 0) continue;

      const candidate = cloneArrangement(arrangement);
      const deleteIds = new Set(deletable.map((n) => n.id));
      candidate.notes = candidate.notes
        .filter((n) => !deleteIds.has(n.id))
        .map((n) => ({ ...n, salience: salienceOf(n) }));

      const measured = measureCandidate(
        candidate,
        arrangement,
        transformationOf(
          this.name,
          `Melody reduced to ${Math.round(target * 100)}% (${arrangement.notes.length} → ${candidate.notes.length} notes)`,
          [...deleteIds],
          { target },
        ),
        context,
      );
      if (measured) results.push(measured);
    }
    return results;
  }
}
