import type { MusicAnalysisProvider, MusicAnalysisRequest, PartialRawMusicAnalysis } from '../music-analysis-provider.js';
import { PythonMirWorker } from './python-worker.js';

/**
 * All-In-One Music Structure Analyzer (learned): tempo, beats, downbeats,
 * beat positions, and functional sections in one pass. Output stays raw;
 * meter inference, SectionType mapping, and beat-grid building happen in the
 * consensus/normalization engines.
 */
export class AllInOneRhythmStructureProvider implements MusicAnalysisProvider {
  readonly id = 'all-in-one';
  readonly version = '3.1.0';

  private readonly worker: PythonMirWorker;
  private readonly model: string;
  private readonly device: string;

  constructor(options: { worker?: PythonMirWorker; model?: string; device?: string } = {}) {
    this.worker = options.worker ?? new PythonMirWorker();
    this.model = options.model ?? 'harmonix-fold0';
    this.device = options.device ?? process.env.MIR_DEVICE ?? 'cpu';
  }

  capabilities() {
    return ['TEMPO', 'BEATS', 'DOWNBEATS', 'SECTIONS'] as const;
  }

  async analyze(audioPath: string, request: MusicAnalysisRequest = {}): Promise<PartialRawMusicAnalysis> {
    const out = await this.worker.rhythmStructure(audioPath, {
      model: request.model ?? this.model,
      device: request.device ?? this.device,
    });
    return {
      rhythmStructure: {
        provider: this.id,
        model: out.model,
        bpm: out.bpm ?? undefined,
        beats: out.beats,
        downbeats: out.downbeats,
        beatPositions: out.beatPositions,
        segments: out.segments,
        runtimeMs: out.runtimeMs,
        bpmCandidates: (out.bpmCandidates ?? []).map((c) => ({
          bpm: c.bpm,
          provider: c.provider,
          relation: c.relation as 'PRIMARY' | 'HALF' | 'DOUBLE' | 'OTHER',
          derived: c.derived,
        })),
      },
    };
  }
}
