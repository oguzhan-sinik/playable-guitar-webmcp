import { z } from 'zod';
import type { SongGraph } from '../../domain/music/song-graph.js';
import type { AnalyzeResult } from '../../application/analyze-song.js';

/** Compact, structured evidence for the Analysis Agent. No raw frame data. */
export const ProviderRhythmSummarySchema = z.object({
  provider: z.string(),
  impliedBpm: z.number().nullable(),
  beats: z.number(),
  downbeats: z.number(),
});
export type ProviderRhythmSummary = z.infer<typeof ProviderRhythmSummarySchema>;

export const ProviderChordSummarySchema = z.object({
  provider: z.string(),
  audioVariant: z.string(),
  segments: z.number(),
});
export type ProviderChordSummary = z.infer<typeof ProviderChordSummarySchema>;

export const SectionProgressionSchema = z.object({
  type: z.string(),
  startBeat: z.number(),
  endBeat: z.number(),
  dominantProgression: z.string(),
  averageAgreement: z.number(),
  chordCount: z.number(),
});
export type SectionProgression = z.infer<typeof SectionProgressionSchema>;

export const AnalysisEvidenceSummarySchema = z.object({
  song: z.object({
    title: z.string().optional(),
    artist: z.string().optional(),
    durationMs: z.number(),
  }),
  resolvedRhythm: z.object({
    bpm: z.number(),
    timeSignature: z.string(),
    meterSource: z.string(),
    meterConfidence: z.number(),
    rhythmConfidence: z.number(),
    downbeats: z.number(),
    manualOverrides: z.array(z.object({ field: z.string(), value: z.string() })),
  }),
  rhythmProviders: z.array(ProviderRhythmSummarySchema),
  key: z
    .object({
      label: z.string(),
      confidence: z.number().optional(),
    })
    .optional(),
  chordConsensus: z.object({
    segmentCount: z.number(),
    averageConfidence: z.number(),
    chordConfidence: z.number().optional(),
    sections: z.array(SectionProgressionSchema),
  }),
  chordProviders: z.array(ProviderChordSummarySchema),
  tempoProvenance: z.object({
    selectedProvider: z.string(),
    observations: z.array(z.object({ provider: z.string(), bpm: z.number(), relation: z.string(), derived: z.boolean() })),
    evidence: z.array(z.object({ kind: z.string(), detail: z.string() })),
  }),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
});
export type AnalysisEvidenceSummary = z.infer<typeof AnalysisEvidenceSummarySchema>;

const summarizeProgression = (graph: SongGraph): SectionProgression[] => {
  return graph.sections.map((section) => {
    const inSection = graph.harmony.chords.filter(
      (c) => c.startBeat >= section.startBeat && c.startBeat < section.endBeat,
    );
    const progression = inSection
      .slice(0, 8)
      .map((c) => `${c.root}${c.quality === 'minor' ? 'm' : ''}`)
      .join(' -> ');
    const avg =
      inSection.length > 0 ? inSection.reduce((s, c) => s + c.confidence, 0) / inSection.length : 0;
    return {
      type: section.type,
      startBeat: section.startBeat,
      endBeat: section.endBeat,
      dominantProgression: progression === '' ? '(no confident chords)' : progression,
      averageAgreement: Math.round(avg * 100) / 100,
      chordCount: inSection.length,
    };
  });
};

/** Build the compact evidence summary from existing deterministic output. */
export function buildAnalysisEvidenceSummary(song: SongGraph, analysis: AnalyzeResult | null): AnalysisEvidenceSummary {
  const ts = song.global.timeSignature;
  const overrides =
    (song.analysis?.rhythm?.overrides as Array<{ field: string; value: string }> | undefined) ?? [];
  const observations = (song.analysis?.tempo?.observations ?? []).slice(0, 4);
  const tempoEvidence = (song.analysis?.tempo?.evidence ?? []).slice(0, 3);
  return AnalysisEvidenceSummarySchema.parse({
    song: {
      ...(song.metadata.title !== undefined && { title: song.metadata.title }),
      ...(song.metadata.artist !== undefined && { artist: song.metadata.artist }),
      durationMs: song.metadata.durationMs,
    },
    resolvedRhythm: {
      bpm: song.global.bpm,
      timeSignature: `${ts.numerator}/${ts.denominator}`,
      meterSource: ts.source,
      meterConfidence: ts.confidence,
      rhythmConfidence: song.confidence.rhythm ?? 0,
      downbeats: song.beats.filter((b) => b.isDownbeat).length,
      manualOverrides: overrides,
    },
    rhythmProviders: (analysis?.rhythmSummaries ?? []).map((s) => ({
      provider: s.provider,
      impliedBpm: s.impliedBpm,
      beats: 0,
      downbeats: 0,
    })),
    ...(song.global.key !== undefined && {
      key: {
        label: song.global.key,
        ...(song.confidence.key !== undefined && { confidence: song.confidence.key }),
      },
    }),
    chordConsensus: {
      segmentCount: song.harmony.chords.length,
      averageConfidence:
        song.harmony.chords.length > 0
          ? Math.round(
              (song.harmony.chords.reduce((s, c) => s + c.confidence, 0) / song.harmony.chords.length) * 100,
            ) / 100
          : 0,
      ...(song.confidence.chord !== undefined && { chordConfidence: song.confidence.chord }),
      sections: summarizeProgression(song),
    },
    chordProviders: (song.analysis?.chords?.providers ?? []).map((p) => ({
      provider: p.provider,
      audioVariant: p.audioVariant,
      segments: p.segments,
    })),
    tempoProvenance: {
      selectedProvider: song.analysis?.tempo?.selectedProvider ?? 'consensus',
      observations,
      evidence: tempoEvidence,
    },
    warnings: (analysis?.warnings ?? []).map((w) => ({ code: w.code, message: w.message })),
  });
}
