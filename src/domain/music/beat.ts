import { z } from 'zod';

export const BeatEventSchema = z.object({
  /** Beat index in the song timeline; 0-based. */
  beat: z.number().int().nonnegative(),
  timeMs: z.number().nonnegative(),
  isDownbeat: z.boolean(),
  /** 1-based position within the bar when a provider detected it. */
  positionInBar: z.number().int().positive().optional(),
});
export type BeatEvent = z.infer<typeof BeatEventSchema>;

export const TimeSignatureSchema = z.object({
  numerator: z.number().int().positive(),
  denominator: z.number().int().refine((d) => [1, 2, 4, 8, 16, 32].includes(d), {
    message: 'Denominator must be a power of two (1, 2, 4, 8, 16, 32)',
  }),
  /**
   * How confident we are in the meter. Defaults keep pre-existing graphs
   * (which had no meter provenance) valid and honestly labeled.
   */
  confidence: z.number().min(0).max(1).default(0),
  /** ANALYZED = detected from audio; DEFAULT = assumed fallback (e.g. 4/4). */
  source: z.enum(['ANALYZED', 'DEFAULT']).default('DEFAULT'),
});
export type TimeSignature = z.infer<typeof TimeSignatureSchema>;
/** Input form: confidence/source optional (defaults applied on parse). */
export type TimeSignatureInput = z.input<typeof TimeSignatureSchema>;

/** True when the beat index is a measure start under the given time signature. */
export function isDownbeat(beat: number, timeSignature: TimeSignature): boolean {
  return beat % timeSignature.numerator === 0;
}
