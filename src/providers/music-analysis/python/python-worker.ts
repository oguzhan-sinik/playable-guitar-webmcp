import path from 'node:path';
import { AppError } from '../../../errors/app-error.js';
import type { RawSegment, RhythmStructureAnalysis, ChordAnalysisResult } from '../../../domain/analysis/raw-music-analysis.js';
import { runProcess, mirWorkerDir, type ProcessRunResult } from './process-runner.js';

/** JSON contracts mirrored from mir/mir_worker/schemas.py. */
export interface MirRhythmStructureOutput extends RhythmStructureAnalysis {
  bpmCandidates?: Array<{ bpm: number; relation: 'PRIMARY' | 'HALF' | 'DOUBLE' | 'OTHER'; provider: string; derived: boolean }>;
  segments?: RawSegment[];
}

export interface MirChordsOutput {
  pipeline: string;
  model?: string;
  vocabulary: string;
  segments: Array<{ startSeconds: number; endSeconds: number; label: string }>;
  confidence?: number | null;
  runtimeMs?: number;
}

export interface MirStemsOutput {
  stems: Record<string, string>;
  model: string;
  runtimeMs: number;
}

export interface MirDoctorComponent {
  name: string;
  ok: boolean;
  version?: string;
  error?: string;
}

export interface MirDoctorReport {
  python: string;
  components: MirDoctorComponent[];
}

/**
 * Subprocess client for the Python MIR worker (uv environment under mir/).
 * JSON in / JSON out; all provider knowledge stays on the Python side.
 */
export class PythonMirWorker {
  constructor(private readonly mirDir: string = mirWorkerDir()) {}

  /** Runs `uv run mir-worker <args>`; resolves the parsed JSON payload. */
  async run(args: string[], timeoutMs: number): Promise<Record<string, unknown>> {
    let result: ProcessRunResult;
    try {
      result = await runProcess('uv', ['run', 'mir-worker', ...args], {
        cwd: this.mirDir,
        timeoutMs,
      });
    } catch (err) {
      if (err instanceof AppError) {
        throw new AppError('BINARY_UNAVAILABLE', `MIR worker unavailable: ${err.message}`, { cause: err });
      }
      throw err;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(result.stdout);
    } catch {
      // tolerate stray log lines: use the last stdout line that parses as JSON
      const lines = result.stdout.split('\n').filter((l) => l.trim().startsWith('{'));
      const last = lines[lines.length - 1];
      if (last === undefined) {
        throw new AppError('BINARY_UNAVAILABLE', `MIR worker produced non-JSON output: ${result.stdout.slice(0, 200)}`);
      }
      try {
        payload = JSON.parse(last);
      } catch {
        throw new AppError('BINARY_UNAVAILABLE', `MIR worker produced non-JSON output: ${result.stdout.slice(0, 200)}`);
      }
    }
    const record = payload as Record<string, unknown>;
    if (record['error'] !== undefined) {
      const err = record['error'] as { code: string; message: string };
      throw new AppError('ANALYSIS_DECODE_FAILED', `MIR worker ${err.code}: ${err.message}`);
    }
    return record;
  }

  async doctor(timeoutMs = 120_000): Promise<MirDoctorReport> {
    return (await this.run(['doctor'], timeoutMs)) as unknown as MirDoctorReport;
  }

  async rhythmStructure(
    wavPath: string,
    options: { model?: string; device?: string; outDir?: string; timeoutMs?: number } = {},
  ): Promise<MirRhythmStructureOutput> {
    const args = [
      'rhythm',
      path.resolve(wavPath),
      '--device',
      options.device ?? 'cpu',
      ...(options.model !== undefined ? ['--model', options.model] : []),
      ...(options.outDir !== undefined ? ['--out-dir', path.resolve(options.outDir)] : []),
    ];
    return (await this.run(args, options.timeoutMs ?? 3_600_000)) as unknown as MirRhythmStructureOutput;
  }

  async chords(
    wavPath: string,
    pipeline: 'deepchroma' | 'cnn-crf',
    options: { timeoutMs?: number } = {},
  ): Promise<MirChordsOutput> {
    const out = (await this.run(
      ['chords', path.resolve(wavPath), '--pipeline', pipeline],
      options.timeoutMs ?? 1_800_000,
    )) as unknown as MirChordsOutput;
    return out;
  }

  async separate(
    wavPath: string,
    outDir: string,
    options: { device?: string; timeoutMs?: number } = {},
  ): Promise<MirStemsOutput> {
    return (await this.run(
      ['separate', path.resolve(wavPath), '--out-dir', path.resolve(outDir), '--device', options.device ?? 'cpu'],
      options.timeoutMs ?? 3_600_000,
    )) as unknown as MirStemsOutput;
  }
}
