import { z } from 'zod';
import type { SongGraph } from '../../domain/music/song-graph.js';
import type { AnalysisAgentDecision } from '../../domain/agent/analysis-decision.js';
import { findShape } from '../../domain/guitar/chord-shape.js';

export const FEASIBILITY_PROMPT_VERSION = 'v2';

export const ArrangementCapabilitiesSchema = z.object({
  canGenerate: z.literal(true),
  supportedQualities: z.array(z.string()),
  supportedTechniques: z.array(z.literal(['BARRE'])),
  transformations: z.array(z.string()),
  notSupported: z.array(z.string()),
});
export type ArrangementCapabilities = z.infer<typeof ArrangementCapabilitiesSchema>;

export const CURRENT_CAPABILITIES: ArrangementCapabilities = {
  canGenerate: true,
  supportedQualities: ['major', 'minor'],
  supportedTechniques: ['BARRE'],
  transformations: [
    'tempo-reduction',
    'fingering-optimization',
    'capo-optimization',
    'chord-simplification',
    'rhythm-simplification',
    'melody-reduction',
  ],
  notSupported: [
    'original guitar transcription',
    'riffs',
    'solos',
    'fingerstyle patterns',
    'melody extraction',
    '7th/sus/slash chord voicings',
  ],
};

export interface FeasibilityEvidence {
  song: SongGraph;
  analysisDecision: AnalysisAgentDecision;
  capabilities: ArrangementCapabilities;
}

export const FEASIBILITY_SYSTEM_PROMPT = `You are judging whether a useful guitar LEARNING arrangement can be generated from machine-analyzed harmony, rhythm, and structure.

The current engine generates harmony-based rhythm-guitar accompaniment only.
Do not claim that an original guitar part has been transcribed.
Do not invent riffs or melody notes.
Judge only whether the available harmony/rhythm/structure is sufficient for the currently supported arrangement engine.

Rules:
- The summary below is usually sufficient. Only call tools when you need to verify a specific doubt. Aim for 0-2 tool calls total.
- DEFER_LOW_CONFIDENCE when harmony is too sparse or unreliable to be useful for a learner.
- GENERATE_PARTIAL_ARRANGEMENT when only some sections are usable.
- GENERATE_HARMONY_ARRANGEMENT when the harmony is usable across the song.
- Every limitation should be a statement about what the arrangement is NOT (e.g. it is an accompaniment, not a transcription).`;

export function feasibilityUserPrompt(evidence: FeasibilityEvidence): string {
  const { song, analysisDecision } = evidence;
  return [
    'SongGraph summary (JSON):',
    JSON.stringify(
      {
        bpm: song.global.bpm,
        timeSignature: `${song.global.timeSignature.numerator}/${song.global.timeSignature.denominator}`,
        key: song.global.key ?? null,
        confidence: {
          overall: song.confidence.overall,
          chord: song.confidence.chord ?? null,
          rhythm: song.confidence.rhythm ?? null,
        },
        sections: song.sections.map((s) => ({ type: s.type, startBeat: s.startBeat, endBeat: s.endBeat })),
        dominantProgression: song.harmony.chords
          .slice(0, 12)
          .map((c) => `${c.root}${c.quality === 'minor' ? 'm' : ''}`)
          .join(' '),
        chordEventCount: song.harmony.chords.length,
      },
      null,
      2,
    ),
    '',
    `Analysis Agent: status=${analysisDecision.status}, confidence=${analysisDecision.confidence}, harmony=${analysisDecision.interpretation.harmonyAssessment}`,
    `Engine capabilities: ${JSON.stringify(evidence.capabilities)}`,
    '',
    'Decide the feasibility strategy. The summary is usually sufficient; call tools only if needed (0-2 calls).',
  ].join('\n');
}

/** Chords in the graph for which no built-in grip exists. */
export function unsupportedChords(song: SongGraph): string[] {
  return [...new Set(song.harmony.chords.filter((c) => findShape(`${c.root}${c.quality === 'minor' ? 'm' : ''}`) === undefined).map((c) => `${c.root}${c.quality === 'minor' ? 'm' : ''}`))];
}
