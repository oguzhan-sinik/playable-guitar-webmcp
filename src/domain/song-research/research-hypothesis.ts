/**
 * Hypotheses and conflicts: places where sources agree only partially or
 * disagree outright. The resolver never silently overwrites — it keeps both
 * readings and tells the agent what to research next.
 */
export type HypothesisKind = 'CONSENSUS' | 'LIKELY_TRANSPOSED_EQUIVALENT' | 'METRICAL_RELATION';

export interface ResearchHypothesis {
  field: string;
  kind: HypothesisKind;
  value: unknown;
  /** Sum of normalized evidence weights behind this reading. */
  support: number;
  evidenceIds: string[];
  /** Independent source families behind this reading. */
  families: string[];
  explanation: string;
}

export interface ResearchConflict {
  field: string;
  hypotheses: Array<{
    value: unknown;
    support: number;
    evidenceIds: string[];
    families: string[];
  }>;
  suggestedResolutionQueries: string[];
}

export interface ResearchGap {
  field: string;
  reason: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  suggestedQueries: string[];
}
