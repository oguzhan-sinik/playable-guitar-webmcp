import { z } from 'zod';

/**
 * Structured Feasibility Agent decision: can we generate a useful guitar
 * LEARNING arrangement from the available harmony/rhythm/structure?
 * EXTRACT_EXISTING_GUITAR is a documented FUTURE capability — the current
 * engine cannot transcribe original guitar parts, so it is deliberately not
 * part of the selectable strategy union.
 */
export const GuitarFeasibilityStrategySchema = z.enum([
  'GENERATE_HARMONY_ARRANGEMENT',
  'GENERATE_PARTIAL_ARRANGEMENT',
  'DEFER_LOW_CONFIDENCE',
]);
export type GuitarFeasibilityStrategy = z.infer<typeof GuitarFeasibilityStrategySchema>;

export const GuitarFeasibilityDecisionSchema = z.object({
  strategy: GuitarFeasibilityStrategySchema,
  confidence: z.number().min(0).max(1),
  usableSections: z.array(z.string()),
  riskySections: z.array(z.string()),
  limitations: z.array(z.string()),
  reasons: z.array(z.string()),
});
export type GuitarFeasibilityDecision = z.infer<typeof GuitarFeasibilityDecisionSchema>;
