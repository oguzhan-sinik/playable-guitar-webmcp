import type { MusicAnalysisProvider } from './music-analysis-provider.js';
import { EssentiaMusicAnalysisProvider } from './essentia/essentia-provider.js';
import { AllInOneRhythmStructureProvider } from './python/all-in-one-provider.js';
import { MadmomChordProvider } from './python/madmom-chord-provider.js';
import { BeatThisRhythmProvider, MadmomBeatProvider, MadmomDownbeatProvider } from './python/beat-this-provider.js';
import { PythonMirWorker } from './python/python-worker.js';

export interface StemSeparationProvider {
  readonly id: string;
  separate(wavPath: string, outDir: string, device?: string): Promise<Record<string, string>>;
}

export class DemucsStemSeparationProvider implements StemSeparationProvider {
  readonly id = 'demucs';
  private readonly worker: PythonMirWorker;
  constructor(worker = new PythonMirWorker()) {
    this.worker = worker;
  }
  async separate(wavPath: string, outDir: string, device = process.env.MIR_DEVICE ?? 'cpu') {
    const result = await this.worker.separate(wavPath, outDir, { device });
    return result.stems;
  }
}

let essentiaSingleton: EssentiaMusicAnalysisProvider | null = null;

/** Provider lookup by id. Unknown ids throw — strategy configs are validated here. */
export function createProvider(id: string): MusicAnalysisProvider {
  switch (id) {
    case 'essentia':
      essentiaSingleton ??= new EssentiaMusicAnalysisProvider();
      return essentiaSingleton;
    case 'all-in-one':
      return new AllInOneRhythmStructureProvider();
    case 'deepchroma':
      return new MadmomChordProvider('deepchroma');
    case 'cnn-crf':
      return new MadmomChordProvider('cnn-crf');
    case 'beat-this':
      return new BeatThisRhythmProvider();
    case 'madmom-beat':
      return new MadmomBeatProvider();
    case 'madmom-downbeat':
      return new MadmomDownbeatProvider();
    default:
      throw new Error(
        `Unknown analysis provider "${id}". Available: essentia, all-in-one, beat-this, madmom-beat, madmom-downbeat, deepchroma, cnn-crf`,
      );
  }
}
