import { z } from 'zod';

/**
 * Structured Analysis Agent decision. The agent reviews machine-generated
 * evidence; it never emits replacement musical data (no chords, no tempos).
 */
export const AnalysisStatusSchema = z.enum([
  'ACCEPT',
  'ACCEPT_WITH_WARNINGS',
  'REVIEW_REQUIRED',
  'DEFER',
]);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const AnalysisRecommendedActionSchema = z.enum([
  'CONTINUE',
  'RETRY_RHYTHM',
  'RETRY_CHORDS',
  'DEFER',
]);
export type AnalysisRecommendedAction = z.infer<typeof AnalysisRecommendedActionSchema>;

export const AssessmentSchema = z.enum(['COHERENT', 'AMBIGUOUS', 'SUSPICIOUS', 'PARTIAL', 'UNRELIABLE']);

export const AnalysisAgentDecisionSchema = z.object({
  status: AnalysisStatusSchema,
  confidence: z.number().min(0).max(1),
  interpretation: z.object({
    tempoAssessment: AssessmentSchema,
    harmonyAssessment: AssessmentSchema,
    structureAssessment: AssessmentSchema,
  }),
  warnings: z.array(z.string()),
  evidence: z.array(z.string()),
  recommendedAction: AnalysisRecommendedActionSchema,
});
export type AnalysisAgentDecision = z.infer<typeof AnalysisAgentDecisionSchema>;
