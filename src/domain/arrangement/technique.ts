import { z } from 'zod';

export const GUITAR_TECHNIQUES = [
  'NORMAL',
  'HAMMER_ON',
  'PULL_OFF',
  'SLIDE',
  'BEND',
  'PALM_MUTE',
  'BARRE',
  'ARPEGGIO',
] as const;
export type GuitarTechnique = (typeof GUITAR_TECHNIQUES)[number];

export const TechniqueEventSchema = z.object({
  id: z.string().min(1),
  type: z.enum(GUITAR_TECHNIQUES),
  /** The arrangement event (note or chord id) this technique applies to. */
  targetEventId: z.string().min(1),
  startBeat: z.number().min(0),
});
export type TechniqueEvent = z.infer<typeof TechniqueEventSchema>;
