import { z } from 'zod';
import { TimeSignatureSchema, type TimeSignatureInput, type BeatEvent } from './beat.js';

/** Rhythmic context for a stretch of the song. V0: one global context on SongGraph. */
export const RhythmContextSchema = z.object({
  bpm: z.number().positive(),
  timeSignature: TimeSignatureSchema,
});
export type RhythmContext = z.infer<typeof RhythmContextSchema>;

/** Build beats 0..totalBeats-1 with beatsPerBar from the time signature. Deterministic. */
export function generateBeatGrid(
  totalBeats: number,
  ctx: { bpm: number; timeSignature: TimeSignatureInput },
): BeatEvent[] {
  return Array.from({ length: totalBeats }, (_, beat) => ({
    beat,
    timeMs: Math.round((beat * 60_000) / ctx.bpm),
    isDownbeat: beat % ctx.timeSignature.numerator === 0,
  }));
}

export { TimeSignatureSchema };
