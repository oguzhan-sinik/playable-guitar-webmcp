import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import { findShape } from '../../domain/guitar/chord-shape.js';

export interface ArrangementExplanation {
  difficultyBefore: number;
  difficultyAfter: number;
  fidelityAfter: number;
  changes: Array<{ type: string; description: string }>;
}

const barreCount = (arr: GuitarArrangement): number =>
  arr.chords.filter((c) => findShape(c.shapeName)?.barre !== undefined).length;

export function explainArrangement(base: GuitarArrangement, selected: GuitarArrangement): ArrangementExplanation {
  const difficultyBefore = base.difficulty?.total ?? 0;
  const difficultyAfter = selected.difficulty?.total ?? 0;
  const fidelityAfter = selected.fidelity?.total ?? 1;
  const changes: ArrangementExplanation['changes'] = [];

  const barresBefore = barreCount(base);
  const barresAfter = barreCount(selected);
  if (barresAfter < barresBefore) {
    changes.push({ type: 'BARRE_REDUCTION', description: 'Reduces barre-chord difficulty' });
  }

  const uniqueBefore = new Set(base.chords.map((c) => c.shapeName)).size;
  const uniqueAfter = new Set(selected.chords.map((c) => c.shapeName)).size;
  if (uniqueAfter <= uniqueBefore && difficultyAfter < difficultyBefore) {
    changes.push({ type: 'EASIER_SHAPES', description: 'Uses easier chord shapes' });
  }

  if (selected.tuning.capo > 0 && base.tuning.capo === 0) {
    changes.push({ type: 'CAPO', description: 'Same sounding harmony via capo' });
  }

  if (selected.tempoFactor < base.tempoFactor - 0.01) {
    changes.push({
      type: 'TEMPO',
      description: `Slower practice tempo (${Math.round(selected.tempoFactor * 100)}%)`,
    });
  }

  for (const t of selected.transformations) {
    if (t.type === 'FINGERING_OPTIMIZATION') {
      changes.push({ type: t.type, description: 'Reduces hand movement between chords' });
    }
    if (t.type === 'RHYTHM_SIMPLIFICATION') {
      changes.push({ type: t.type, description: 'Simplifies strumming rhythm' });
    }
  }

  if (fidelityAfter >= 0.99) {
    changes.push({ type: 'FIDELITY', description: "Preserves the song's sounding harmony" });
  }

  return { difficultyBefore, difficultyAfter, fidelityAfter, changes };
}
