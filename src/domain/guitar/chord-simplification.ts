/**
 * Explicit simplification relationships between chord shapes. Edges are
 * declared, not computed; measured difficulty/fidelity still come from the
 * engines after applying an edge, and candidates are rejected when the
 * measurement disagrees with the estimate.
 *
 * Note: open 7th grips (Cmaj7, Am7…) are physically EASIER than their triads,
 * so the classical 7th→triad edges only reduce difficulty at barre positions.
 * The reliably-measured edge is F (full barre) → Fmaj7 (open grip): real
 * barre removal.
 */
export interface ChordSimplificationEdge {
  from: string;
  to: string;
  difficultyReductionEstimate: number;
  fidelityCostEstimate: number;
}

export const CHORD_SIMPLIFICATION_EDGES: readonly ChordSimplificationEdge[] = [
  { from: 'F', to: 'Fmaj7', difficultyReductionEstimate: 3, fidelityCostEstimate: 0.1 },
  { from: 'Cmaj7', to: 'C', difficultyReductionEstimate: 1.5, fidelityCostEstimate: 0.1 },
  { from: 'Am7', to: 'Am', difficultyReductionEstimate: 1.0, fidelityCostEstimate: 0.1 },
  { from: 'Em7', to: 'Em', difficultyReductionEstimate: 1.0, fidelityCostEstimate: 0.1 },
  { from: 'G7', to: 'G', difficultyReductionEstimate: 1.5, fidelityCostEstimate: 0.1 },
];

export function findSimplification(fromShapeName: string): ChordSimplificationEdge | undefined {
  return CHORD_SIMPLIFICATION_EDGES.find((e) => e.from === fromShapeName);
}
