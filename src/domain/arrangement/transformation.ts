import { z } from 'zod';

export const TRANSFORMATION_TYPES = [
  'TEMPO_REDUCTION',
  'FINGERING_OPTIMIZATION',
  'CAPO_OPTIMIZATION',
  'CHORD_SIMPLIFICATION',
  'BARRE_REMOVAL',
  'RHYTHM_SIMPLIFICATION',
  'MELODY_REDUCTION',
  'OCTAVE_SUBSTITUTION',
  'TECHNIQUE_SIMPLIFICATION',
  'VOICE_REDUCTION',
] as const;
export type TransformationType = (typeof TRANSFORMATION_TYPES)[number];

export const AppliedTransformationSchema = z.object({
  type: z.enum(TRANSFORMATION_TYPES),
  description: z.string().min(1),
  affectedEventIds: z.array(z.string()),
  parameters: z.record(z.string(), z.unknown()).optional(),
  difficultyBefore: z.number().optional(),
  difficultyAfter: z.number().optional(),
  fidelityBefore: z.number().optional(),
  fidelityAfter: z.number().optional(),
});
export type AppliedTransformation = z.infer<typeof AppliedTransformationSchema>;
