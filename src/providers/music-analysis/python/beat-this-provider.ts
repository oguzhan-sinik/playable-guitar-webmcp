import type { RhythmProviderResult, TempoCandidate } from '../../../domain/analysis/raw-music-analysis.js';
import type { MusicAnalysisProvider, MusicAnalysisRequest, PartialRawMusicAnalysis } from '../music-analysis-provider.js';
import { PythonMirWorker } from './python-worker.js';

interface MirBeatThisOutput {
  provider: string;
  model?: string;
  device?: string;
  beats: number[];
  downbeats: number[];
  beatPositions?: number[];
  tempoCandidates?: Array<TempoCandidate & { source?: string }>;
  runtimeMs?: number;
}

interface MirMadmomDownbeatOutput {
  provider: string;
  model?: string;
  device?: string;
  beats: number[];
  downbeats: number[];
  beatPositions?: number[];
  tempoCandidates?: Array<TempoCandidate & { source?: string }>;
  meterHypotheses?: Array<{ beatsPerBar: number; beats: number[]; downbeats: number[]; beatPositions?: number[] }>;
  runtimeMs?: number;
}

interface MirMadmomBeatOutput {
  provider: string;
  model?: string;
  device?: string;
  beats: number[];
  downbeats?: number[];
  tempoCandidates?: Array<TempoCandidate & { source?: string }>;
  runtimeMs?: number;
}

const analyzedAt = () => new Date().toISOString();

/** Beat This (learned beat/downbeat tracker, 'final0' checkpoint). High-priority
 * rhythm evidence: strong beat + downbeat prior per ticket spec. */
export class BeatThisRhythmProvider implements MusicAnalysisProvider {
  readonly id = 'beat-this';
  readonly version = '1.1.0';

  private readonly worker: PythonMirWorker;
  private readonly model: string;
  private readonly device: string;

  constructor(options: { worker?: PythonMirWorker; model?: string; device?: string } = {}) {
    this.worker = options.worker ?? new PythonMirWorker();
    this.model = options.model ?? 'final0';
    this.device = options.device ?? process.env.MIR_DEVICE ?? 'cpu';
  }

  capabilities() {
    return ['TEMPO', 'BEATS', 'DOWNBEATS'] as const;
  }

  async analyze(audioPath: string, _request?: MusicAnalysisRequest): Promise<PartialRawMusicAnalysis> {
    void _request;
    const out = (await this.worker.run(['rhythm-beatthis', audioPath, '--model', this.model, '--device', this.device], 3_600_000)) as unknown as MirBeatThisOutput;
    const result: RhythmProviderResult = {
      provider: this.id,
      ...(out.model !== undefined && { model: out.model }),
      beats: out.beats,
      downbeats: out.downbeats,
      tempoCandidates: out.tempoCandidates ?? [],
      ...(out.runtimeMs !== undefined && { runtimeMs: out.runtimeMs }),
      provenance: { ...(out.device !== undefined && { device: out.device }), packageVersion: this.version, analyzedAt: analyzedAt() },
    };
    return { rhythmResult: result };
  }
}

/** madmom RNNBeatProcessor + DBNBeatTrackingProcessor — independent beat
 * evidence with its own DBN tempo model. */
export class MadmomBeatProvider implements MusicAnalysisProvider {
  readonly id = 'madmom-beat';
  readonly version = '0.3.0';

  private readonly worker: PythonMirWorker;
  private readonly device: string;

  constructor(options: { worker?: PythonMirWorker; device?: string } = {}) {
    this.worker = options.worker ?? new PythonMirWorker();
    this.device = options.device ?? process.env.MIR_DEVICE ?? 'cpu';
  }

  capabilities() {
    return ['TEMPO', 'BEATS'] as const;
  }

  async analyze(audioPath: string, _request?: MusicAnalysisRequest): Promise<PartialRawMusicAnalysis> {
    void _request;
    const out = (await this.worker.run(['rhythm-madmom-beat', audioPath, '--device', this.device], 3_600_000)) as unknown as MirMadmomBeatOutput;
    const result: RhythmProviderResult = {
      provider: this.id,
      ...(out.model !== undefined && { model: out.model }),
      beats: out.beats,
      ...(out.downbeats !== undefined && { downbeats: out.downbeats }),
      tempoCandidates: out.tempoCandidates ?? [],
      ...(out.runtimeMs !== undefined && { runtimeMs: out.runtimeMs }),
      provenance: { ...(out.device !== undefined && { device: out.device }), packageVersion: this.version, analyzedAt: analyzedAt() },
    };
    return { rhythmResult: result };
  }
}

/** madmom RNNDownBeatProcessor decoded once per beats_per_bar hypothesis
 * (2, 3, 4, 6). Hypotheses are scored symmetrically by the meter resolver —
 * compound meters are first-class, not an afterthought. */
export class MadmomDownbeatProvider implements MusicAnalysisProvider {
  readonly id = 'madmom-downbeat';
  readonly version = '0.3.0';

  private readonly worker: PythonMirWorker;
  private readonly device: string;
  private readonly beatsPerBar: number[];

  constructor(options: { worker?: PythonMirWorker; device?: string; beatsPerBar?: number[] } = {}) {
    this.worker = options.worker ?? new PythonMirWorker();
    this.device = options.device ?? process.env.MIR_DEVICE ?? 'cpu';
    this.beatsPerBar = options.beatsPerBar ?? [2, 3, 4, 6];
  }

  capabilities() {
    return ['TEMPO', 'BEATS', 'DOWNBEATS', 'METER'] as const;
  }

  async analyze(audioPath: string, _request?: MusicAnalysisRequest): Promise<PartialRawMusicAnalysis> {
    void _request;
    const out = (await this.worker.run(
      ['rhythm-madmom-downbeat', audioPath, '--device', this.device, '--beats-per-bar', this.beatsPerBar.join(',')],
      3_600_000,
    )) as unknown as MirMadmomDownbeatOutput;
    const result: RhythmProviderResult = {
      provider: this.id,
      ...(out.model !== undefined && { model: out.model }),
      beats: out.beats,
      downbeats: out.downbeats,
      ...(out.beatPositions !== undefined && { beatPositions: out.beatPositions }),
      tempoCandidates: out.tempoCandidates ?? [],
      ...(out.meterHypotheses !== undefined && { meterHypotheses: out.meterHypotheses }),
      ...(out.runtimeMs !== undefined && { runtimeMs: out.runtimeMs }),
      provenance: { ...(out.device !== undefined && { device: out.device }), packageVersion: this.version, analyzedAt: analyzedAt() },
    };
    return { rhythmResult: result };
  }
}
