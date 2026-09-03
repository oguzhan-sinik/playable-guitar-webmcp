import { NO_CHORD, normalizeChordLabel } from '../../../domain/music/normalize.js';
import type { RawChordObservation } from '../../../domain/analysis/raw-music-analysis.js';
import type { AnalysisAudioVariant } from '../../../domain/analysis/raw-music-analysis.js';
import type { MusicAnalysisProvider, MusicAnalysisRequest, PartialRawMusicAnalysis } from '../music-analysis-provider.js';
import { PythonMirWorker } from './python-worker.js';

export type MadmomPipeline = 'deepchroma' | 'cnn-crf';

/** One learned madmom-infer chord pipeline per provider instance. Label format
 * 'C:maj' / 'A:min' / 'N' (no chord) is normalized here. */
export class MadmomChordProvider implements MusicAnalysisProvider {
  readonly id: string;
  readonly version = '0.3.0';

  private readonly worker: PythonMirWorker;
  private readonly pipeline: MadmomPipeline;

  constructor(pipeline: MadmomPipeline, options: { worker?: PythonMirWorker } = {}) {
    this.pipeline = pipeline;
    this.id = pipeline === 'deepchroma' ? 'deepchroma' : 'cnn-crf';
    this.worker = options.worker ?? new PythonMirWorker();
  }

  capabilities() {
    return ['CHORDS'] as const;
  }

  async analyze(audioPath: string, request: MusicAnalysisRequest = {}): Promise<PartialRawMusicAnalysis> {
    const out = await this.worker.chords(audioPath, this.pipeline);
    const variant: AnalysisAudioVariant = request.audioVariant ?? 'FULL_MIX';
    const segments: RawChordObservation[] = out.segments.map((s) => {
      const parsed = normalizeChordLabel(s.label);
      return {
        startSeconds: s.startSeconds,
        endSeconds: s.endSeconds,
        // canonical domain label ('C', 'Am') or NO_CHORD
        label: parsed === null ? NO_CHORD : `${parsed.root}${parsed.quality === 'minor' ? 'm' : ''}`,
        confidence: 1, // placeholder — CRF exposes no per-segment confidence
      };
    });
    segments.forEach((s) => {
      if (s.label === NO_CHORD) s.confidence = 0;
    });
    return {
      chords: [
        {
          provider: this.id,
          model: out.model,
          pipeline: out.pipeline,
          vocabulary: out.vocabulary,
          audioVariant: variant,
          segments,
          ...(out.confidence != null ? { confidence: out.confidence } : {}),
          runtimeMs: out.runtimeMs,
        },
      ],
    };
  }
}
