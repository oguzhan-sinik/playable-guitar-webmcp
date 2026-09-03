import { MAX_ANALYSIS_RETRIES, type SongProcessingState } from './state.js';

/** Deterministic routing — the graph decides, never the LLM. */
export function routeAnalysis(state: SongProcessingState): 'feasibility-agent' | 'targeted-analysis' | 'finalize' {
  const status = state.analysisDecision?.status;
  switch (status) {
    case 'DEFER':
      return 'finalize';
    case 'REVIEW_REQUIRED':
      return state.retryCounts.analysisAgent < MAX_ANALYSIS_RETRIES ? 'targeted-analysis' : 'finalize';
    default:
      return 'feasibility-agent';
  }
}

export function routeFeasibility(state: SongProcessingState): 'build-base-arrangement' | 'finalize' {
  return state.feasibilityDecision?.strategy === 'DEFER_LOW_CONFIDENCE' ? 'finalize' : 'build-base-arrangement';
}
