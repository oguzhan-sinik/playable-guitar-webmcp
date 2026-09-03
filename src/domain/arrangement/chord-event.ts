import { z } from 'zod';
import { ChordEventSchema } from '../music/chord.js';
import type { GuitarChordShape } from '../guitar/chord-shape.js';

/**
 * What the guitarist plays at a point in time. `chord` is the sounding
 * harmony; `shape` is the physical grip. With a capo, shape pitches shift by
 * the capo — the validator enforces shape(+capo) === chord pitch classes.
 */
export const ArrangementChordEventSchema = z.object({
  id: z.string().min(1),
  chord: ChordEventSchema,
  shapeName: z.string().min(1),
  startBeat: z.number().min(0),
  durationBeats: z.number().positive(),
});
export type ArrangementChordEvent = z.infer<typeof ArrangementChordEventSchema>;

// resolved (non-serialized) form carries the full shape object
export interface ArrangementChordEventResolved extends ArrangementChordEvent {
  shape: GuitarChordShape;
}
