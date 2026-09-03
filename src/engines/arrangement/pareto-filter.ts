import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';

export type Dominance = 'A' | 'B' | 'NEITHER' | 'EQUAL';

/**
 * A dominates B when A is no harder AND at least as faithful, with at least
 * one strict improvement.
 */
export function dominates(
  a: { difficulty: number; fidelity: number },
  b: { difficulty: number; fidelity: number },
): Dominance {
  const aBetter = a.difficulty < b.difficulty || a.fidelity > b.fidelity;
  const aNoWorse = a.difficulty <= b.difficulty && a.fidelity >= b.fidelity;
  const bNoWorse = b.difficulty <= a.difficulty && b.fidelity >= a.fidelity;
  if (aNoWorse && aBetter) return 'A';
  if (bNoWorse && (b.difficulty < a.difficulty || b.fidelity > a.fidelity)) return 'B';
  if (aNoWorse && bNoWorse) return 'EQUAL';
  return 'NEITHER';
}

export interface ComparisonSummary {
  difficultyDelta: number;
  fidelityDelta: number;
  dominance: Dominance;
}

export function compareArrangements(
  a: GuitarArrangement,
  b: GuitarArrangement,
): ComparisonSummary {
  const da = a.difficulty?.total ?? 0;
  const db = b.difficulty?.total ?? 0;
  const fa = a.fidelity?.total ?? 0;
  const fb = b.fidelity?.total ?? 0;
  return {
    difficultyDelta: Math.round((da - db) * 100) / 100,
    fidelityDelta: Math.round((fa - fb) * 1000) / 1000,
    dominance: dominates({ difficulty: da, fidelity: fa }, { difficulty: db, fidelity: fb }),
  };
}

/** Keep only non-dominated arrangements (Pareto frontier on difficulty vs fidelity). */
export function paretoFilter(arrangements: GuitarArrangement[]): GuitarArrangement[] {
  const scored = arrangements.filter((a) => a.difficulty && a.fidelity);
  return scored.filter((a, i) =>
    !scored.some((b, j) =>
      i !== j &&
      dominates(
        { difficulty: b.difficulty!.total, fidelity: b.fidelity!.total },
        { difficulty: a.difficulty!.total, fidelity: a.fidelity!.total },
      ) === 'A',
    ),
  );
}
