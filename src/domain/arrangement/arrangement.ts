import { z } from 'zod';
import { GuitarConfigSchema } from '../guitar/tuning.js';
import { TechniqueEventSchema, type TechniqueEvent } from './technique.js';
import { AppliedTransformationSchema, type AppliedTransformation } from './transformation.js';
import { ArrangementChordEventSchema, type ArrangementChordEvent } from './chord-event.js';
import { ArrangementNoteEventSchema, type ArrangementNoteEvent } from './note-event.js';
import { DifficultyScoreSchema, type DifficultyScore } from './difficulty.js';
import { FidelityScoreSchema, type FidelityScore } from './fidelity.js';

export const GuitarArrangementSchema = z.object({
  id: z.string().min(1),
  songId: z.string().min(1),
  /** Physical guitar the arrangement targets (capo included). */
  tuning: GuitarConfigSchema,
  /** Performance tempo multiplier; 1.0 = original BPM. Symbolic content is unaffected. */
  tempoFactor: z.number().positive(),
  durationBeats: z.number().positive(),
  chords: z.array(ArrangementChordEventSchema),
  notes: z.array(ArrangementNoteEventSchema),
  techniques: z.array(TechniqueEventSchema),
  transformations: z.array(AppliedTransformationSchema),
  difficulty: DifficultyScoreSchema.optional(),
  fidelity: FidelityScoreSchema.optional(),
});
export interface GuitarArrangement extends Omit<
  z.infer<typeof GuitarArrangementSchema>,
  'techniques' | 'transformations' | 'chords' | 'notes' | 'difficulty' | 'fidelity'
> {
  techniques: TechniqueEvent[];
  transformations: AppliedTransformation[];
  chords: ArrangementChordEvent[];
  notes: ArrangementNoteEvent[];
  difficulty?: DifficultyScore;
  fidelity?: FidelityScore;
}
