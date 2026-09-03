import type { GuitarArrangement } from '../domain/arrangement/arrangement.js';
import type { SongGraph } from '../domain/music/song-graph.js';
import { pluckString, metronomeClick, mixInto } from './ks-voice.js';
import { strumPattern, resolveStrums, shapeSoundingMidis } from './strum.js';
import { hashString } from '../utils/random.js';

/**
 * Section-scoped practice preview renderer.
 *
 * Synthesizes ONLY the compiled guitar arrangement (exact shapes + capo via
 * fretboard pitch math) plus an optional metronome. Never the original
 * recording, never a music-generation model. Deterministic: same inputs,
 * same samples.
 */
export const PREVIEW_SAMPLE_RATE = 22_050;
/** Never render more than this, whatever the section length. */
export const MAX_PREVIEW_SECONDS = 45;

export interface PreviewTimelineEntry {
  chord: string;
  /** Sounding harmony label, e.g. "Ab". */
  sounding: string;
  startSec: number;
  endSec: number;
}

export interface PracticePreview {
  sampleRate: number;
  samples: Float32Array;
  durationSec: number;
  /** Count-in length, so the UI can show 1-2-3-4 before the guitar enters. */
  countInSec: number;
  timeline: PreviewTimelineEntry[];
  cacheKey: string;
}

export interface PreviewRenderInput {
  song: Pick<SongGraph, 'id' | 'global' | 'beats'>;
  arrangement: GuitarArrangement;
  /** Beat window to render; defaults to the whole arrangement (capped). */
  startBeat?: number;
  endBeat?: number;
  tempoFactor?: number;
  metronome?: boolean;
  countInBars?: number;
  seed?: number;
}

const chordLabelOf = (chord: { root: string; quality: string }): string =>
  `${chord.root}${chord.quality === 'minor' ? 'm' : ''}`;

/**
 * Seconds per graph beat, derived from the beat timeline itself (graph beats
 * can be eighths in compound meters, where global.bpm is the dotted-quarter
 * level — dividing 60/bpm would be 3× too slow).
 */
export function graphBeatSec(song: Pick<SongGraph, 'beats' | 'global'>): number {
  const beats = song.beats;
  if (beats.length >= 2) {
    const last = beats[beats.length - 1]!;
    if (last.beat > 0) return last.timeMs / 1000 / last.beat;
  }
  return 60 / song.global.bpm;
}

export function renderPracticePreview(input: PreviewRenderInput): PracticePreview {
  const { song, arrangement } = input;
  const tempoFactor = input.tempoFactor ?? arrangement.tempoFactor;
  const graphBeat = graphBeatSec(song) / tempoFactor;
  const numerator = song.global.timeSignature.numerator;
  // strum pattern slots are eighths: 1 graph beat in compound meters,
  // half a beat in simple meters
  const slotSec = numerator === 6 ? graphBeat : graphBeat / 2;
  const beatsPerBar = numerator;
  const metronome = input.metronome ?? true;
  const countInBars = input.countInBars ?? 1;
  const pattern = strumPattern(numerator);

  const startBeat = Math.max(0, input.startBeat ?? 0);
  const rawEndBeat = input.endBeat ?? Number.MAX_SAFE_INTEGER;
  const events = arrangement.chords.filter((c) => c.startBeat >= startBeat && c.startBeat < rawEndBeat);
  if (events.length === 0) throw new Error('No chords in the requested section window');

  const windowBeats = events.reduce(
    (max, c) => Math.max(max, c.startBeat + c.durationBeats - startBeat),
    0,
  );
  // cap render length: section-focused by design
  const cappedBeats = Math.min(windowBeats, MAX_PREVIEW_SECONDS / graphBeat);
  const guitarSec = cappedBeats * graphBeat;
  const countInSec = countInBars > 0 ? countInBars * beatsPerBar * graphBeat : 0;
  const totalSec = countInSec + guitarSec;

  const samples = new Float32Array(Math.ceil(totalSec * PREVIEW_SAMPLE_RATE));
  const seed = input.seed ?? hashString(`${song.id}:${arrangement.id}:${tempoFactor}:${startBeat}`);
  const openStrings = arrangement.tuning.tuning;

  const timeline: PreviewTimelineEntry[] = [];
  let stringSeed = seed;

  for (const event of events) {
    const rel = event.startBeat - startBeat;
    if (rel >= cappedBeats) continue;
    const durBeats = Math.min(event.durationBeats, cappedBeats - rel);
    const chordStartSec = countInSec + rel * graphBeat;
    const chordDurSec = durBeats * graphBeat;

    const midis = shapeSoundingMidis(event.shapeName, arrangement.tuning.capo, openStrings);
    const strums = resolveStrums(
      pattern,
      midis,
      { startSec: chordStartSec, durationSec: chordDurSec, eighthSec: slotSec, seed: stringSeed++ },
    );
    for (const strum of strums) {
      for (const string of strum.strings) {
        const freq = 440 * Math.pow(2, (string.midi - 69) / 12);
        const noteSeed = hashString(`${string.midi}:${strum.offsetSec.toFixed(4)}`) ^ seed;
        const note = pluckString(
          freq,
          Math.min(chordDurSec + 1.2, 2.5),
          PREVIEW_SAMPLE_RATE,
          noteSeed,
          string.velocity,
        );
        mixInto(samples, note, Math.round((strum.offsetSec + string.delaySec) * PREVIEW_SAMPLE_RATE));
      }
    }

    const last = timeline[timeline.length - 1];
    if (last !== undefined && last.chord === event.shapeName) {
      last.endSec = chordStartSec + chordDurSec; // merge repeated same-chord bars
    } else {
      timeline.push({
        chord: event.shapeName,
        sounding: chordLabelOf(event.chord),
        startSec: chordStartSec,
        endSec: chordStartSec + chordDurSec,
      });
    }
  }

  // metronome: clicks on the graph-beat grid, accent on each bar downbeat;
  // in compound meters (6/8) bars group into 3+3, so accents land on the
  // dotted-quarter pulse
  if (metronome) {
    // accent period in graph beats: 3 (6/8 dotted-quarter grouping) or 4
    const accentEvery = numerator === 6 ? 3 : 4;
    const totalBeats = countInBars * beatsPerBar + cappedBeats;
    for (let beat = 0; beat < totalBeats; beat++) {
      const t = beat * graphBeat;
      if (t >= totalSec) continue;
      const accent = beat % accentEvery === 0;
      mixInto(samples, metronomeClick(PREVIEW_SAMPLE_RATE, accent), Math.round(t * PREVIEW_SAMPLE_RATE));
    }
  }

  return {
    sampleRate: PREVIEW_SAMPLE_RATE,
    samples,
    durationSec: totalSec,
    countInSec,
    timeline,
    cacheKey: previewCacheKey({
      songId: song.id,
      arrangementId: arrangement.id,
      startBeat,
      endBeat: startBeat + cappedBeats,
      tempoFactor,
      metronome,
      countInBars,
    }),
  };
}

export interface PreviewCacheKeyInput {
  songId: string;
  arrangementId: string;
  startBeat: number;
  endBeat: number;
  tempoFactor: number;
  metronome: boolean;
  countInBars: number;
}

/** songGraphHash + arrangementHash + section + tempo + metronome. */
export function previewCacheKey(input: PreviewCacheKeyInput): string {
  return [
    input.songId,
    input.arrangementId,
    `${input.startBeat}-${input.endBeat}`,
    input.tempoFactor.toFixed(2),
    input.metronome ? 'm' : 's',
    String(input.countInBars),
  ].join('|');
}
