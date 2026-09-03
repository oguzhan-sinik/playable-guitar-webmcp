import type { Song } from '../../domain/song/song.js';
import { SongGraphSchema, type SongGraph } from '../../domain/music/song-graph.js';
import type { RawMusicAnalysis } from '../../domain/analysis/raw-music-analysis.js';
import { AppError } from '../../errors/app-error.js';
import { newId } from '../../utils/ids.js';
import { DEFAULT_ANALYSIS_CONFIG, type AnalysisConfig } from './config.js';
import { ticksToBeats } from './beat-normalizer.js';
import { normalizeChordObservations } from './chord-normalizer.js';
import { smoothSingleBeatGlitches, segmentChordTimeline } from './chord-segmenter.js';
import { aggregateConfidence, averageChordConfidence } from './confidence.js';

export interface BuildSongGraphOptions {
  config?: AnalysisConfig;
  providerVersion?: string;
  analysisVersion?: string;
  sourceAudioSha256?: string;
  analyzedAt?: string;
}

/**
 * RawMusicAnalysis -> SongGraph. Populates rhythm, key, chord timeline; no
 * melody/motifs yet (later tickets). Structural segmentation is deferred: a
 * single UNKNOWN section with honest low confidence covers the timeline.
 */
export function buildSongGraph(
  song: Song,
  analysis: RawMusicAnalysis,
  options: BuildSongGraphOptions = {},
): SongGraph {
  try {
    const config = options.config ?? DEFAULT_ANALYSIS_CONFIG;
    const durationSeconds = song.durationMs / 1000;
    const beats = ticksToBeats(analysis.rhythm.beats.map((b) => b.timeSeconds), durationSeconds);
    if (beats.length < 4) {
      throw new AppError(
        'INSUFFICIENT_BEATS',
        `Only ${beats.length} usable beat(s) detected — cannot build a useful SongGraph`,
      );
    }

    const normalized = normalizeChordObservations(analysis.tonal.chords, config);
    const { observations: smoothed, warnings: smoothWarnings } = smoothSingleBeatGlitches(normalized);
    const chords = segmentChordTimeline(smoothed, beats);

    const warnings = [...analysis.warnings, ...smoothWarnings];
    if (chords.length === 0) {
      warnings.push({ code: 'NO_CHORDS', message: 'No confident chord observations survived normalization' });
    }

    const confidence = aggregateConfidence(
      analysis,
      config.confidenceWeights,
      averageChordConfidence(analysis),
    );
    if (confidence.overall < config.lowConfidenceThreshold) {
      warnings.push({
        code: 'ANALYSIS_LOW_CONFIDENCE',
        message: `Overall analysis confidence ${confidence.overall.toFixed(2)} is below ${config.lowConfidenceThreshold}`,
      });
    }

    const lastBeat = beats[beats.length - 1]!.beat;
    const endBeat = Math.max(lastBeat, chords.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 0));

    const graph: SongGraph = {
      id: song.id,
      metadata: {
        title: song.title,
        ...(song.artist !== undefined && { artist: song.artist }),
        durationMs: song.durationMs,
      },
      global: {
        bpm: analysis.rhythm.bpm,
        timeSignature: { numerator: 4, denominator: 4, confidence: 0.2, source: 'DEFAULT' },
        ...(analysis.tonal.key !== undefined && {
          key: `${analysis.tonal.key.root} ${analysis.tonal.key.scale}`,
        }),
        tuningReferenceHz: 440,
      },
      beats,
      sections: [
        {
          id: newId('sec'),
          type: 'UNKNOWN',
          startBeat: 0,
          endBeat,
          confidence: 0.3,
          importance: 0.5,
        },
      ],
      harmony: { chords },
      motifs: [],
      confidence,
      provenance: {
        provider: analysis.provider,
        ...(options.providerVersion !== undefined && { providerVersion: options.providerVersion }),
        analysisVersion: options.analysisVersion ?? '1',
        createdAt: options.analyzedAt ?? new Date().toISOString(),
        ...(options.sourceAudioSha256 !== undefined && { sourceAudioSha256: options.sourceAudioSha256 }),
      },
    };
    return SongGraphSchema.parse(graph) as SongGraph;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('SONG_GRAPH_BUILD_FAILED', `SongGraph construction failed: ${(err as Error).message}`, {
      cause: err,
    });
  }
}
