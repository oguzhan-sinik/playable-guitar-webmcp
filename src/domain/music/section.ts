import { z } from 'zod';

export const SECTION_TYPES = [
  'INTRO',
  'VERSE',
  'PRE_CHORUS',
  'CHORUS',
  'BRIDGE',
  'SOLO',
  'BREAKDOWN',
  'OUTRO',
  'UNKNOWN',
] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export const SongSectionSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(SECTION_TYPES),
    startBeat: z.number().nonnegative(),
    endBeat: z.number().positive(),
    confidence: z.number().min(0).max(1),
    importance: z.number().min(0).max(1),
  })
  .refine((s) => s.endBeat > s.startBeat, {
    message: 'endBeat must be greater than startBeat',
  });
export type SongSection = z.infer<typeof SongSectionSchema>;
