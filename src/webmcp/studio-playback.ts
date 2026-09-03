/// <reference lib="dom" />
/**
 * Studio playback: bridges the deterministic preview renderer to the Web
 * Audio API. WebMCP tools PREPARE previews; only a human click plays them.
 * No autoplay anywhere.
 */
import { renderPracticePreview, MAX_PREVIEW_SECONDS, type PracticePreview } from '../audio-rendering/preview-render.js';
import { cachePreviewPreview, getCachedPreview, type PreviewCacheKeyInput } from '../audio-rendering/preview-cache.js';
import type { ArrangementDetail, PracticeConfig, PreviewInfo } from './tool-context.js';

// the studio rehydrates a minimal arrangement/graph for the renderer; the
// renderer only touches the fields it needs (beats via beatSec, chord events)
type RenderSong = Parameters<typeof renderPracticePreview>[0]['song'];
type RenderArrangement = Parameters<typeof renderPracticePreview>[0]['arrangement'];

let current: { preview: PracticePreview; info: PreviewInfo } | null = null;
let audioCtx: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;

export type ChordListener = (chord: string | null) => void;
const chordListeners = new Set<ChordListener>();

let rafHandle: number | null = null;

export function onCurrentChord(listener: ChordListener): () => void {
  chordListeners.add(listener);
  return () => chordListeners.delete(listener);
}

function sectionWindow(detail: ArrangementDetail, sectionType: string | null): { startBeat: number; endBeat: number } {
  if (sectionType === null) return { startBeat: 0, endBeat: Number.MAX_SAFE_INTEGER };
  const hit = detail.sections.find((s) => s.type === sectionType);
  // fall back to the whole song window when the section is unknown
  return hit !== undefined
    ? { startBeat: hit.startBeat, endBeat: hit.endBeat }
    : { startBeat: 0, endBeat: Number.MAX_SAFE_INTEGER };
}

function cacheKeyInput(detail: ArrangementDetail, practice: PracticeConfig, window: { startBeat: number; endBeat: number }): PreviewCacheKeyInput {
  return {
    songId: detail.songId,
    arrangementId: `${detail.level}:${detail.capo}`,
    startBeat: window.startBeat,
    endBeat: window.endBeat,
    tempoFactor: practice.tempoFactor,
    metronome: practice.metronome,
    countInBars: practice.countInBars,
  };
}

/**
 * Render (or reuse) the section preview. Synchronous DSP on a small window —
 * typically well under a second. No AudioContext is created here: preparing
 * a preview must work without Web Audio (tools, tests) and never plays.
 */
export function renderStudioPreview(detail: ArrangementDetail, practice: PracticeConfig): PreviewInfo {
  const window = sectionWindow(detail, practice.section);
  const key = cacheKeyInput(detail, practice, window);
  const cached = getCachedPreview(key);
  if (cached !== undefined) {
    const info = previewInfo(cached, detail, practice);
    current = { preview: cached, info };
    return info;
  }

  const preview = renderPracticePreview({
    song: {
      id: detail.songId,
      global: { bpm: 60 / detail.beatSec, timeSignature: { numerator: detail.meterNumerator, denominator: 8, confidence: 1, source: 'ANALYZED' as const } },
      beats: [],
    } as unknown as RenderSong,
    arrangement: {
      id: `${detail.level}:${detail.capo}`,
      songId: detail.songId,
      tuning: { tuning: detail.openStrings as [number, number, number, number, number, number], frets: 24, capo: detail.capo },
      tempoFactor: practice.tempoFactor,
      durationBeats: 1,
      chords: detail.chords.map((c, i) => ({
        id: `c${i}`,
        chord: { ...parseSounding(c.sounding), startBeat: c.startBeat, durationBeats: c.durationBeats, confidence: 1 },
        shapeName: c.shape,
        startBeat: c.startBeat,
        durationBeats: c.durationBeats,
      })),
      notes: [],
      techniques: [],
      transformations: [],
    } as RenderArrangement,
    startBeat: window.startBeat,
    endBeat: window.endBeat,
    tempoFactor: practice.tempoFactor,
    metronome: practice.metronome,
    countInBars: practice.countInBars,
  });

  cachePreviewPreview(key, preview);
  const info = previewInfo(preview, detail, practice);
  current = { preview, info };
  return info;
}

function previewInfo(preview: PracticePreview, detail: ArrangementDetail, practice: PracticeConfig): PreviewInfo {
  return {
    ready: true,
    section: practice.section,
    tempoFactor: practice.tempoFactor,
    durationSec: Math.round(preview.durationSec * 10) / 10,
    chords: [...new Set(preview.timeline.map((t) => t.chord))],
    preparedAtMs: Date.now(),
    level: detail.level,
    capo: detail.capo,
    tempoBpm: detail.tempoBpm,
  };
}

/** "G#m" → { root: "G#", quality: "minor" } — for timeline labels. */
function parseSounding(label: string): { root: string; quality: 'major' | 'minor' } {
  const minor = label.endsWith('m') && !label.endsWith('maj');
  const root = minor ? label.slice(0, -1) : label;
  return { root, quality: minor ? 'minor' : 'major' };
}

function getAudioContext(): AudioContext {
  if (audioCtx === null) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (Ctor === undefined) throw new Error('Web Audio API unavailable in this browser');
    audioCtx = new Ctor();
  }
  return audioCtx;
}

function toBuffer(ctx: AudioContext, preview: PracticePreview): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.max(1, preview.samples.length), preview.sampleRate);
  buffer.copyToChannel(preview.samples as Float32Array<ArrayBuffer>, 0);
  return buffer;
}

/** Human-click playback. Returns actual duration in seconds. */
export async function playPreview(): Promise<number> {
  if (current === null) throw new Error('No preview prepared yet.');
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  stopPreview();
  const src = ctx.createBufferSource();
  src.buffer = toBuffer(ctx, current.preview);
  src.loop = false; // loop handled by restart for deterministic timing
  src.connect(ctx.destination);
  src.start();
  source = src;
  trackCurrentChord(ctx, src);
  return current.info.durationSec;
}

export function stopPreview(): void {
  if (source !== null) {
    try {
      source.stop();
    } catch {
      // already stopped
    }
    source = null;
  }
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  for (const listener of chordListeners) listener(null);
}

/** Loop playback until told to stop (studio LOOP toggle). */
export async function playLooped(): Promise<void> {
  await playPreview();
  if (source !== null && current !== null) {
    source.loop = true;
    source.loopEnd = current.preview.durationSec;
  }
}

function trackCurrentChord(ctx: AudioContext, src: AudioBufferSourceNode): void {
  const startedAt = ctx.currentTime;
  const tick = (): void => {
    if (src !== source || current === null) return;
    const t = ctx.currentTime - startedAt;
    const hit = current.preview.timeline.find((entry) => t >= entry.startSec && t < entry.endSec);
    for (const listener of chordListeners) listener(hit?.chord ?? null);
    rafHandle = requestAnimationFrame(tick);
  };
  rafHandle = requestAnimationFrame(tick);
}

export { MAX_PREVIEW_SECONDS };
