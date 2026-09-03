import { tool } from 'langchain';
import { z } from 'zod';
import type { AnalysisEvidenceSummary } from './evidence.js';

export type AnalysisVariantRequest = 'RERUN_RHYTHM' | 'RERUN_CHORDS' | 'USE_ALTERNATIVE_TEMPO' | 'NO_ACTION';

export interface AnalysisToolContext {
  evidence: AnalysisEvidenceSummary;
  variantRequests: AnalysisVariantRequest[];
}

/**
 * Read-only evidence tools. Everything returns structured JSON; nothing here
 * touches the filesystem, shell, or network. The one write-flavored tool
 * (request_analysis_variant) only records a constrained request that the
 * deterministic graph executes with existing infrastructure.
 */
export function createAnalysisTools(context: AnalysisToolContext) {
  const e = context.evidence;
  return [
    tool(
      () => ({
        resolvedBpm: e.resolvedRhythm.bpm,
        rhythmConfidence: e.resolvedRhythm.rhythmConfidence,
        selectedProvider: e.tempoProvenance.selectedProvider,
        providerObservations: e.tempoProvenance.observations,
        evidence: e.tempoProvenance.evidence,
      }),
      {
        name: 'get_tempo_evidence',
        description: 'Resolved tempo, provider observations (including metrical hypotheses), and the deterministic evidence chain that selected it.',
        schema: z.object({}),
      },
    ),
    tool(
      () => ({
        timeSignature: e.resolvedRhythm.timeSignature,
        meterSource: e.resolvedRhythm.meterSource,
        meterConfidence: e.resolvedRhythm.meterConfidence,
        downbeats: e.resolvedRhythm.downbeats,
      }),
      {
        name: 'get_meter_evidence',
        description: 'Resolved meter (time signature, source, confidence) and downbeat count.',
        schema: z.object({}),
      },
    ),
    tool(
      () => ({
        sections: e.chordConsensus.sections,
        overallAverageConfidence: e.chordConsensus.averageConfidence,
      }),
      {
        name: 'get_chord_disagreement',
        description: 'Per-section chord progression summaries with average provider agreement; low agreement marks disagreement regions.',
        schema: z.object({}),
      },
    ),
    tool(
      () => e.chordConsensus.sections,
      {
        name: 'get_chord_timeline',
        description: 'The per-section chord timeline summary (dominant progressions, not every beat).',
        schema: z.object({}),
      },
    ),
    tool(
      () => ({
        sections: e.chordConsensus.sections.map((s) => ({ type: s.type, startBeat: s.startBeat, endBeat: s.endBeat })),
        sectionCount: e.chordConsensus.sections.length,
      }),
      {
        name: 'get_section_summary',
        description: 'Functional section boundaries detected for the song.',
        schema: z.object({}),
      },
    ),
    tool(() => e.warnings, {
      name: 'get_analysis_warnings',
      description: 'Warnings emitted by the deterministic analysis pipeline.',
      schema: z.object({}),
    }),
    tool(
      () => ({
        rhythmProviders: e.rhythmProviders,
        chordProviders: e.chordProviders,
        key: e.key ?? null,
      }),
      {
        name: 'get_provider_results',
        description: 'Per-provider rhythm/chord summaries and detected key.',
        schema: z.object({}),
      },
    ),
    tool(
      ({ request }: { request: AnalysisVariantRequest }) => {
        if (request !== 'NO_ACTION') context.variantRequests.push(request);
        return {
          recorded: request,
          note: 'The workflow may execute this with deterministic tools; results return on the next review.',
        };
      },
      {
        name: 'request_analysis_variant',
        description:
          'Request a constrained deterministic re-analysis: RERUN_RHYTHM, RERUN_CHORDS, USE_ALTERNATIVE_TEMPO, or NO_ACTION. You cannot run custom inference.',
        schema: z.object({ request: z.enum(['RERUN_RHYTHM', 'RERUN_CHORDS', 'USE_ALTERNATIVE_TEMPO', 'NO_ACTION']) }),
      },
    ),
  ];
}
