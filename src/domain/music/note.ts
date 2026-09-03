import { z } from 'zod';

export const NoteEventSchema = z.object({
  id: z.string().min(1),
  midi: z.number().int().min(0).max(127),
  startBeat: z.number().min(0),
  durationBeats: z.number().positive(),
  velocity: z.number().min(0).max(127).optional(),
  confidence: z.number().min(0).max(1),
  salience: z.number().min(0).max(1).optional(),
});
export type NoteEvent = z.infer<typeof NoteEventSchema>;
