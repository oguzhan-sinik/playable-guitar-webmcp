import type { MusicalMotif } from '../../domain/music/motif.js';
import type { ArrangementNoteEvent } from '../../domain/arrangement/note-event.js';
import type { FidelityConfig } from './config.js';

/**
 * Recognizability-weighted fraction of motif events retained. Losing a highly
 * recognizable motif hurts much more than losing a background one.
 */
export function motifCoverage(
  motifs: MusicalMotif[],
  arrangementNotes: ArrangementNoteEvent[],
  config: FidelityConfig,
): number {
  if (motifs.length === 0) return 1;
  const retained = new Set(
    arrangementNotes.map((n) => n.sourceNoteId).filter((id): id is string => id !== undefined),
  );
  let weightedSum = 0;
  let totalWeight = 0;
  for (const motif of motifs) {
    const weight = Math.max(0.1, motif.recognizabilityImportance);
    const kept = motif.eventIds.filter((id) => retained.has(id)).length;
    weightedSum += (kept / motif.eventIds.length) * weight;
    totalWeight += weight;
  }
  const base = totalWeight > 0 ? weightedSum / totalWeight : 1;
  // Extra penalty proportional to how many high-recognition motifs lost events.
  const damagedHighRecognition = motifs.filter(
    (m) =>
      m.recognizabilityImportance >= config.highRecognitionThreshold &&
      m.eventIds.some((id) => !retained.has(id)),
  ).length;
  const penalty = damagedHighRecognition > 0
    ? 1 - Math.min(0.3, 0.15 * damagedHighRecognition)
    : 1;
  return base * penalty;
}
