import type { RawMusicAnalysis, RawChordObservation } from '../../../domain/analysis/raw-music-analysis.js';
import type { MusicAnalysisProvider, MusicAnalysisRequest, PartialRawMusicAnalysis } from '../music-analysis-provider.js';
import { normalizePitchClass } from '../../../domain/music/normalize.js';

export interface FakeAnalysisScenario {
  bpm: number;
  /** Beat grid, seconds. */
  beatTimes: number[];
  key?: { root: string; scale: 'major' | 'minor'; confidence: number };
  /** One label/confidence per beat interval (length = beats - 1). */
  chordLabels: Array<{ label: string; confidence: number }>;
  rhythmConfidence?: number;
}

/** Deterministic provider for tests: raw observations without any DSP.
 * Returns the V1 RawMusicAnalysis shape (V1 tests + graph builder) which is
 * also structurally a valid PartialRawMusicAnalysis for the V2 orchestrator. */
export class FakeMusicAnalysisProvider implements MusicAnalysisProvider {
  readonly id = 'fake';
  readonly version = '1';

  constructor(private readonly scenario: FakeAnalysisScenario) {}

  capabilities() {
    return ['TEMPO', 'BEATS', 'KEY', 'CHORDS'] as const;
  }

  async analyze(_audioPath: string, _request?: MusicAnalysisRequest): Promise<RawMusicAnalysis & PartialRawMusicAnalysis> {
    const s = this.scenario;
    const beats: RawChordObservation[] = s.chordLabels.map((c, i) => ({
      startSeconds: s.beatTimes[i] ?? 0,
      endSeconds: s.beatTimes[i + 1] ?? (s.beatTimes[s.beatTimes.length - 1] ?? 0) + 0.5,
      label: c.label,
      confidence: c.confidence,
    }));
    return {
      provider: this.id,
      providerVersion: this.version,
      rhythm: {
        bpm: s.bpm,
        beats: s.beatTimes.map((t) => ({ timeSeconds: t })),
        confidence: s.rhythmConfidence ?? 0.9,
        bpmCandidates: [{ bpm: s.bpm, confidence: s.rhythmConfidence ?? 0.9, provider: this.id, relation: 'PRIMARY', derived: false }],
      },
      tonal: {
        ...(s.key !== undefined && {
          key: { root: normalizePitchClass(s.key.root), scale: s.key.scale, confidence: s.key.confidence },
        }),
        chords: beats,
      },
      warnings: [],
    };
  }
}
