import type { RawMusicAnalysis } from '../../../domain/analysis/raw-music-analysis.js';
import { NO_CHORD } from '../../../domain/music/normalize.js';
import type { RhythmResult } from './rhythm-analyzer.js';
import type { TonalResult } from './tonal-analyzer.js';
import type { ChordResult } from './chord-analyzer.js';

/**
 * Assemble provider outputs into the provider-neutral RawMusicAnalysis.
 * Chord strengths are relative scores, not calibrated probabilities: when the
 * strongest beat exceeds 1 we rescale all strengths by it so confidences land
 * in [0, 1] while relative ordering (the part we actually trust) is preserved.
 */
export function normalizeEssentiaOutput(
  parts: { rhythm: RhythmResult; tonal: TonalResult | null; chords: ChordResult },
  durationSeconds: number,
  config: { minimumChordConfidence: number },
): RawMusicAnalysis {
  const warnings: Array<{ code: string; message: string }> = [];
  const { rhythm, chords } = parts;

  const maxStrength = Math.max(...chords.strengths, 0);
  const scale = maxStrength > 1 ? 1 / maxStrength : 1;
  const min = config.minimumChordConfidence / (scale === 0 ? 1 : Math.max(maxStrength, 0.0001));
  const observations = chords.chords.map((label, i) => {
    const startSeconds = rhythm.ticksSeconds[i] ?? 0;
    const endSeconds = rhythm.ticksSeconds[i + 1] ?? durationSeconds;
    const confidence = Math.max(0, Math.min(1, (chords.strengths[i] ?? 0) * scale));
    return {
      startSeconds,
      endSeconds,
      label: confidence < min ? NO_CHORD : label,
      confidence,
    };
  });
  if (observations.some((o) => o.label === NO_CHORD)) {
    warnings.push({
      code: 'LOW_CHORD_CONFIDENCE',
      message: 'Some beats had chord confidence below threshold and were marked NO_CHORD',
    });
  }
  if (parts.tonal === null) {
    warnings.push({ code: 'NO_KEY', message: 'Key detection produced no result' });
  }

  return {
    provider: 'essentia',
    providerVersion: '0.1.3',
    rhythm: {
      bpm: rhythm.bpm,
      beats: rhythm.ticksSeconds.map((t) => ({ timeSeconds: t })),
      confidence: Math.max(0, Math.min(1, rhythm.confidence)),
      bpmCandidates: bpmCandidatesFromEstimates(rhythm.estimates),
    },
    tonal: {
      ...(parts.tonal !== null && {
        key: { root: parts.tonal.root, scale: parts.tonal.scale as 'major' | 'minor', confidence: parts.tonal.confidence },
      }),
      chords: observations,
    },
    warnings,
  };
}

/**
 * Collapse the multifeature tempo estimates into weighted candidates by
 * rounding to 0.1 BPM. Preserves half/double-time alternatives instead of
 * forcing a single answer.
 */
export function bpmCandidatesFromEstimates(
  estimates: number[],
  topN = 5,
): Array<{ bpm: number; confidence: number; provider: string; relation: 'PRIMARY'; derived: boolean }> {
  if (estimates.length === 0) return [];
  const counts = new Map<number, number>();
  for (const e of estimates) {
    const key = Math.round(e * 10) / 10;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([bpm, count]) => ({
      bpm,
      confidence: count / estimates.length,
      provider: 'essentia',
      relation: 'PRIMARY' as const,
      derived: false,
    }));
}
