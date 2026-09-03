import { z } from 'zod';

export const MOTIF_TYPES = ['MELODY', 'RIFF', 'RHYTHM', 'HARMONY', 'BASS'] as const;
export type MotifType = (typeof MOTIF_TYPES)[number];

/** Domain representation only — motif detection is a later ticket. */
export const MusicalMotifSchema = z.object({
  id: z.string().min(1),
  sectionId: z.string().min(1),
  type: z.enum(MOTIF_TYPES),
  /** References into SongGraph.melody.notes / other event collections. */
  eventIds: z.array(z.string()),
  salience: z.number().min(0).max(1),
  recognizabilityImportance: z.number().min(0).max(1),
});
export type MusicalMotif = z.infer<typeof MusicalMotifSchema>;
