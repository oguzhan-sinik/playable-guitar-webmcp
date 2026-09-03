import { z } from 'zod';

export const DifficultyScoreSchema = z.object({
  total: z.number().min(0).max(10),
  chordComplexity: z.number().min(0).max(10),
  fingeringComplexity: z.number().min(0).max(10),
  handMovement: z.number().min(0).max(10),
  transitionSpeed: z.number().min(0).max(10),
  rhythmComplexity: z.number().min(0).max(10),
  noteDensity: z.number().min(0).max(10),
  techniqueComplexity: z.number().min(0).max(10),
  pickingComplexity: z.number().min(0).max(10),
});
export type DifficultyScore = z.infer<typeof DifficultyScoreSchema>;
