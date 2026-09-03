import { z } from 'zod';

export const AudioSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('local'), original: z.string() }),
  z.object({ type: z.literal('url'), url: z.string().url() }),
]);
export type AudioSource = z.infer<typeof AudioSourceSchema>;

export const SongSchema = z.object({
  id: z.string().regex(/^song_[0-9a-f]{12}$/),
  title: z.string().min(1),
  artist: z.string().optional(),
  source: AudioSourceSchema,
  durationMs: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type Song = z.infer<typeof SongSchema>;
