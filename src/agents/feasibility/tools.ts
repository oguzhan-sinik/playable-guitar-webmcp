import { tool } from 'langchain';
import { z } from 'zod';
import { buildBaseArrangement } from '../../engines/arrangement/build-base-arrangement.js';
import { computeDifficulty } from '../../engines/difficulty/arrangement-difficulty.js';
import type { SongGraph } from '../../domain/music/song-graph.js';
import { unsupportedChords, CURRENT_CAPABILITIES, type FeasibilityEvidence } from './prompt.v1.js';

export function createFeasibilityTools(evidence: FeasibilityEvidence) {
  const { song } = evidence;
  return [
    tool(
      () => song.sections.map((s) => ({ type: s.type, startBeat: s.startBeat, endBeat: s.endBeat, confidence: s.confidence })),
      {
        name: 'get_song_sections',
        description: 'Detected functional sections with confidence.',
        schema: z.object({}),
      },
    ),
    tool(
      () => ({
        chordCount: song.harmony.chords.length,
        averageConfidence:
          song.harmony.chords.length > 0
            ? song.harmony.chords.reduce((s, c) => s + c.confidence, 0) / song.harmony.chords.length
            : 0,
        key: song.global.key ?? null,
        bpm: song.global.bpm,
      }),
      {
        name: 'get_harmony_summary',
        description: 'Chord count, average confidence, key, tempo.',
        schema: z.object({}),
      },
    ),
    tool(() => CURRENT_CAPABILITIES, {
      name: 'get_arrangement_capabilities',
      description: 'What the deterministic guitar engine can and cannot do right now.',
      schema: z.object({}),
    }),
    tool(
      () => {
        try {
          const base = buildBaseArrangement(song);
          const difficulty = computeDifficulty({ arrangement: base, song });
          return {
            feasible: true,
            chordEvents: base.chords.length,
            estimatedBaseDifficulty: difficulty.total,
            shapes: [...new Set(base.chords.map((c) => c.shapeName))],
          };
        } catch (err) {
          return { feasible: false, reason: (err as Error).message };
        }
      },
      {
        name: 'estimate_base_arrangement',
        description: 'Dry-run of the deterministic compiler: base chord grips and estimated difficulty (no persistence).',
        schema: z.object({}),
      },
    ),
    tool(() => unsupportedChords(song), {
      name: 'get_unsupported_chords',
      description: 'Detected chords with no built-in guitar grip (they would be skipped or block generation).',
      schema: z.object({}),
    }),
  ];
}

export type { SongGraph };
