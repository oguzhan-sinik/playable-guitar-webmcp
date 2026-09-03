import { z } from 'zod';
import { GuitarPositionSchema } from '../guitar/guitar-position.js';

export const ArrangementNoteEventSchema = z.object({
  id: z.string().min(1),
  /** Original SongGraph note this arrangement note came from, when retained. */
  sourceNoteId: z.string().optional(),
  midi: z.number().int().min(0).max(127),
  /** Fret is relative to the arrangement's capo; must reproduce `midi`. */
  position: GuitarPositionSchema,
  startBeat: z.number().min(0),
  durationBeats: z.number().positive(),
  salience: z.number().min(0).max(1),
  motifIds: z.array(z.string()),
});
export type ArrangementNoteEvent = z.infer<typeof ArrangementNoteEventSchema>;
