import { describe, expect, it } from 'vitest';
import { routeAnalysis, routeFeasibility } from '../../src/workflows/song-processing/routing.js';
import { MAX_ANALYSIS_RETRIES, type SongProcessingState } from '../../src/workflows/song-processing/state.js';

const baseState = (): SongProcessingState => ({
  jobId: 'job_test',
  songId: 'song_test',
  dryRun: true,
  song: undefined,
  analysisResult: undefined,
  songGraph: undefined,
  analysisDecision: undefined,
  feasibilityDecision: undefined,
  baseArrangement: undefined,
  candidateArrangements: undefined,
  finalArrangements: undefined,
  warnings: [],
  errors: [],
  trace: [],
  agentProvenance: {},
  retryCounts: { analysisAgent: 0 },
});

describe('routeAnalysis', () => {
  it('ACCEPT routes to feasibility-agent (Test A)', () => {
    const state = {
      ...baseState(),
      analysisDecision: {
        status: 'ACCEPT' as const,
        confidence: 0.9,
        interpretation: {
          tempoAssessment: 'COHERENT' as const,
          harmonyAssessment: 'COHERENT' as const,
          structureAssessment: 'COHERENT' as const,
        },
        warnings: [],
        evidence: [],
        recommendedAction: 'CONTINUE' as const,
      },
    };
    expect(routeAnalysis(state)).toBe('feasibility-agent');
  });

  it('DEFER ends workflow at finalize (Test B)', () => {
    const state = {
      ...baseState(),
      analysisDecision: {
        status: 'DEFER' as const,
        confidence: 0.2,
        interpretation: {
          tempoAssessment: 'UNRELIABLE' as const,
          harmonyAssessment: 'UNRELIABLE' as const,
          structureAssessment: 'UNRELIABLE' as const,
        },
        warnings: ['low confidence'],
        evidence: [],
        recommendedAction: 'DEFER' as const,
      },
    };
    expect(routeAnalysis(state)).toBe('finalize');
  });

  it('REVIEW_REQUIRED retries once then finalizes (Test C)', () => {
    const decision = {
      status: 'REVIEW_REQUIRED' as const,
      confidence: 0.5,
      interpretation: {
        tempoAssessment: 'AMBIGUOUS' as const,
        harmonyAssessment: 'COHERENT' as const,
        structureAssessment: 'COHERENT' as const,
      },
      warnings: [],
      evidence: [],
      recommendedAction: 'RETRY_CHORDS' as const,
    };
    expect(routeAnalysis({ ...baseState(), analysisDecision: decision })).toBe('targeted-analysis');
    expect(
      routeAnalysis({
        ...baseState(),
        analysisDecision: decision,
        retryCounts: { analysisAgent: MAX_ANALYSIS_RETRIES },
      }),
    ).toBe('finalize');
  });
});

describe('routeFeasibility', () => {
  it('GENERATE_HARMONY_ARRANGEMENT builds arrangement (Test D)', () => {
    const state = {
      ...baseState(),
      feasibilityDecision: {
        strategy: 'GENERATE_HARMONY_ARRANGEMENT' as const,
        confidence: 0.85,
        usableSections: ['CHORUS'],
        riskySections: [],
        limitations: [],
        reasons: ['harmony is usable'],
      },
    };
    expect(routeFeasibility(state)).toBe('build-base-arrangement');
  });

  it('DEFER_LOW_CONFIDENCE skips arrangement (Test E)', () => {
    const state = {
      ...baseState(),
      feasibilityDecision: {
        strategy: 'DEFER_LOW_CONFIDENCE' as const,
        confidence: 0.2,
        usableSections: [],
        riskySections: ['VERSE'],
        limitations: ['harmony too uncertain'],
        reasons: [],
      },
    };
    expect(routeFeasibility(state)).toBe('finalize');
  });
});
