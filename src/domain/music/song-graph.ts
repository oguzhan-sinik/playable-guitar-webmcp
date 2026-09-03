import { z } from 'zod';
import { BeatEventSchema, TimeSignatureSchema } from './beat.js';
import { ChordEventSchema } from './chord.js';
import { MusicalMotifSchema } from './motif.js';
import { NoteEventSchema } from './note.js';
import { SongSectionSchema } from './section.js';

/**
 * Canonical normalized song representation. V0 — will evolve; provider-specific
 * fields must not leak in here.
 */
/**
 * How the graph as a whole came to be. HYBRID = some fields from audio,
 * some improved/resolved through web research. Field-level lineage lives in
 * provenance.fieldProvenance.
 */
export const SONG_GRAPH_ORIGINS = ['AUDIO_ANALYSIS', 'RESEARCH_FUSION', 'HYBRID'] as const;
export type SongGraphOrigin = (typeof SONG_GRAPH_ORIGINS)[number];

/** How precise the section/chord TIMING is. Research-derived graphs are typically SECTION_ONLY. */
export const TIMING_PRECISIONS = ['EXACT', 'APPROXIMATE', 'SECTION_ONLY', 'UNKNOWN'] as const;
export type TimingPrecision = (typeof TIMING_PRECISIONS)[number];

export const FieldProvenanceSchema = z.object({
  origin: z.enum(['MIR', 'WEB_RESEARCH', 'OFFICIAL_METADATA', 'LICENSED_CATALOG', 'USER_CONFIRMED']),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string()),
  resolutionMethod: z.string(),
});
export type FieldProvenance = z.infer<typeof FieldProvenanceSchema>;

export const SongGraphSchema = z.object({
  id: z.string().min(1),
  metadata: z.object({
    title: z.string().optional(),
    artist: z.string().optional(),
    durationMs: z.number().nonnegative(),
  }),
  global: z.object({
    bpm: z.number().positive(),
    timeSignature: TimeSignatureSchema,
    key: z.string().optional(),
    tuningReferenceHz: z.number().positive(),
  }),
  beats: z.array(BeatEventSchema),
  sections: z.array(SongSectionSchema),
  harmony: z.object({
    chords: z.array(ChordEventSchema),
  }),
  melody: z
    .object({
      notes: z.array(NoteEventSchema),
    })
    .optional(),
  motifs: z.array(MusicalMotifSchema),
  /** Timing precision of sections/chords; pre-research graphs default to EXACT/APPROXIMATE from audio. */
  timingPrecision: z.enum(TIMING_PRECISIONS).optional(),
  confidence: z.object({
    overall: z.number().min(0).max(1),
    /** Heuristic component confidences; present when the graph was analyzed. */
    rhythm: z.number().min(0).max(1).optional(),
    key: z.number().min(0).max(1).optional(),
    chord: z.number().min(0).max(1).optional(),
  }),
  /**
   * How this graph came to be. Never contains provider-specific musical data,
   * only lineage for debugging/evaluation.
   */
  provenance: z
    .object({
      provider: z.string(),
      providerVersion: z.string().optional(),
      analysisVersion: z.string(),
      createdAt: z.string().datetime(),
      sourceAudioSha256: z.string().optional(),
      origin: z.enum(SONG_GRAPH_ORIGINS).optional(),
      /** Per-field lineage (identity/tempo/meter/key/harmony/sections/timing). */
      fieldProvenance: z.record(z.string(), FieldProvenanceSchema).optional(),
    })
    .optional(),
  /**
   * V2 analysis provenance: why the system believes what it believes. Kept
   * beside (not inside) the musical events to avoid bloating them.
   */
  analysis: z
    .object({
      tempo: z.object({
        selectedProvider: z.string(),
        selectedBpm: z.number(),
        observations: z.array(
          z.object({
            provider: z.string(),
            bpm: z.number(),
            relation: z.string(),
            derived: z.boolean(),
          }),
        ),
        evidence: z.array(z.object({ kind: z.string(), detail: z.string() })),
      }),
      chords: z.object({
        providers: z.array(
          z.object({
            provider: z.string(),
            audioVariant: z.string(),
            segments: z.number(),
            runtimeMs: z.number().optional(),
          }),
        ),
        segments: z.array(
          z.object({
            startBeat: z.number(),
            endBeat: z.number(),
            root: z.string(),
            quality: z.string(),
            agreement: z.number(),
            votes: z.array(
              z.object({
                provider: z.string(),
                label: z.string(),
                audioVariant: z.string(),
              }),
            ),
          }),
        ),
      }),
      providers: z.array(
        z.object({
          id: z.string(),
          version: z.string(),
          capabilities: z.array(z.string()),
          runtimeMs: z.number().optional(),
        }),
      ),
      /** V3 rhythm consensus provenance: which metrical level the BPM is at,
       * the grouping, and why it was chosen. */
      rhythm: z
        .object({
          bpm: z.number(),
          pulseLevel: z.string(),
          meter: z.object({
            numerator: z.number(),
            denominator: z.number(),
            grouping: z.array(z.number()).optional(),
            compound: z.boolean().optional(),
            confidence: z.number(),
            source: z.string(),
          }),
          meterAlternatives: z.array(z.object({ numerator: z.number(), confidence: z.number() })),
          evidence: z.array(z.object({ kind: z.string(), detail: z.string() })),
          overrides: z.array(z.object({ field: z.string(), value: z.string() })),
        })
        .optional(),
    })
    .optional(),
});
export type SongGraph = z.infer<typeof SongGraphSchema>;
