import { z } from 'zod';

export const FidelityScoreSchema = z.object({
  total: z.number().min(0).max(1),
  harmony: z.number().min(0).max(1),
  melody: z.number().min(0).max(1),
  rhythm: z.number().min(0).max(1),
  motifCoverage: z.number().min(0).max(1),
  structure: z.number().min(0).max(1),
});
export type FidelityScore = z.infer<typeof FidelityScoreSchema>;
