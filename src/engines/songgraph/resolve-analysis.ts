import type { Song } from '../../domain/song/song.js';
import {
  SongGraphSchema,
  type SongGraph,
} from '../../domain/music/song-graph.js';
import type { BeatEvent } from '../../domain/music/beat.js';
import { type TimeSignature } from '../../domain/music/beat.js';
import { SECTION_TYPES, type SectionType } from '../../domain/music/section.js';
import type { ChordEvent } from '../../domain/music/chord.js';
import type { RhythmStructureAnalysis, ResolvedRhythm } from '../../domain/analysis/raw-music-analysis.js';
import type { ResolvedTempo } from '../analysis-consensus/tempo-consensus.js';
import type { ChordConsensusSegment } from '../analysis-consensus/chord-consensus.js';
import { newId } from '../../utils/ids.js';

/** Section label vocabulary of All-In-One etc. mapped into SectionType. */
const SECTION_LABEL_MAP: Record<string, SectionType> = {
  intro: 'INTRO',
  verse: 'VERSE',
  chorus: 'CHORUS',
  bridge: 'BRIDGE',
  solo: 'SOLO',
  break: 'BREAKDOWN',
  breakdown: 'BREAKDOWN',
  outro: 'OUTRO',
  inst: 'UNKNOWN',
  transition: 'UNKNOWN',
  'main theme': 'UNKNOWN',
};

/** Deterministic starting importance per section type (configurable). */
export const DEFAULT_SECTION_IMPORTANCE: Record<SectionType, number> = {
  CHORUS: 0.9,
  SOLO: 0.8,
  VERSE: 0.6,
  BRIDGE: 0.6,
  PRE_CHORUS: 0.6,
  INTRO: 0.4,
  BREAKDOWN: 0.4,
  OUTRO: 0.35,
  UNKNOWN: 0.3,
};

export function mapSectionLabel(label: string): SectionType {
  const normalized = label.trim().toLowerCase();
  const mapped = SECTION_LABEL_MAP[normalized];
  return mapped ?? 'UNKNOWN';
}

/**
 * Build the beat grid from learned beats + downbeats. isDownbeat comes from
 * the model's downbeat predictions (matched to the nearest detected beat) —
 * no more "only beat 0 is a downbeat".
 */
export function buildBeatGrid(rhythm: RhythmStructureAnalysis, durationSeconds: number): BeatEvent[] {
  const beatTimes = (rhythm.beats ?? [])
    .filter((t) => Number.isFinite(t) && t >= 0 && t <= durationSeconds)
    .sort((a, b) => a - b);
  const downbeatTimes = rhythm.downbeats ?? [];
  const positions = rhythm.beatPositions ?? [];

  // match downbeat times to nearest beat index
  const downbeatIndexes = new Set<number>();
  for (const d of downbeatTimes) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < beatTimes.length; i++) {
      const dist = Math.abs(beatTimes[i]! - d);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      } else if (beatTimes[i]! > d + 1) {
        break;
      }
    }
    // only trust the match when it is close (half a beat or better)
    const prevGap = bestIdx > 0 ? Math.abs(beatTimes[bestIdx]! - beatTimes[bestIdx - 1]!) : 0.5;
    if (bestIdx >= 0 && bestDist <= Math.max(prevGap / 2, 0.06)) downbeatIndexes.add(bestIdx);
  }

  const beats: BeatEvent[] = [];
  let last = -1;
  for (let i = 0; i < beatTimes.length; i++) {
    const t = beatTimes[i]!;
    if (t === last) continue;
    last = t;
    const detectedPosition = positions.length === beatTimes.length ? positions[i] : undefined;
    const beat: BeatEvent = {
      beat: beats.length,
      timeMs: Math.round(t * 1000),
      isDownbeat: downbeatIndexes.has(i),
      ...(detectedPosition !== undefined && { positionInBar: detectedPosition }),
    };
    beats.push(beat);
  }
  // fallback: if the model gave no downbeats at all, only beat 0 is a downbeat
  if (downbeatIndexes.size === 0 && beats.length > 0) {
    for (const b of beats) b.isDownbeat = false;
    beats[0]!.isDownbeat = true;
  }
  return beats;
}

/**
 * Derive meter from repeated beat-position sequences (e.g. 1 2 3 4 -> 4).
 * Compound meters: we store the detected grouping honestly; notation
 * perfection comes later. Falls back to DEFAULT 4/4 when positions are absent.
 */
export function inferMeter(rhythm: RhythmStructureAnalysis): TimeSignature {
  const positions = rhythm.beatPositions ?? [];
  if (positions.length < 8) {
    return { numerator: 4, denominator: 4, confidence: 0.2, source: 'DEFAULT' };
  }
  const maxPosition = Math.max(...positions);
  if (maxPosition < 2 || maxPosition > 7) {
    return { numerator: 4, denominator: 4, confidence: 0.2, source: 'DEFAULT' };
  }
  const onOne = positions.filter((p) => p === 1).length;
  // how consistently does each bar have exactly maxPosition beats
  const consistency = onOne > 0 ? 1 - Math.abs(countBarLengths(positions, maxPosition) - 1) : 0;
  const confidence = Math.max(0.2, Math.min(0.9, consistency));
  return { numerator: maxPosition, denominator: 4, confidence, source: 'ANALYZED' };
}

function countBarLengths(positions: number[], expected: number): number {
  let bars = 0;
  let wellFormed = 0;
  let current = 0;
  for (const p of positions) {
    current++;
    if (p === 1 && current > 1) {
      if (current - 1 === expected) wellFormed++;
      bars++;
      current = 1;
    }
  }
  if (current === expected) {
    wellFormed++;
    bars++;
  }
  return bars > 0 ? wellFormed / bars : 0;
}

export interface TempoProvenance {
  selectedProvider: string;
  selectedBpm: number;
  observations: Array<{ provider: string; bpm: number; relation: string; derived: boolean }>;
  evidence: Array<{ kind: string; detail: string }>;
}

export interface ChordProvenance {
  providers: Array<{ provider: string; audioVariant: string; segments: number; runtimeMs?: number }>;
  segments: Array<{
    startBeat: number;
    endBeat: number;
    root: string;
    quality: string;
    agreement: number;
    votes: Array<{ provider: string; label: string; audioVariant: string }>;
  }>;
}

export interface ResolvedAnalysis {
  tempo: ResolvedTempo;
  /** V3 rhythm consensus output (present when rhythm consensus ran). */
  rhythm?: ResolvedRhythm;
  overrides?: Array<{ field: string; value: string }>;
  beats: BeatEvent[];
  timeSignature: TimeSignature;
  sections: SongGraph['sections'];
  chords: ChordEvent[];
  keyLabel?: string;
  keyConfidence?: number;
  confidence: { rhythm: number; key: number; chord: number; overall: number };
  warnings: Array<{ code: string; message: string }>;
  tempoProvenance: TempoProvenance;
  chordProvenance: ChordProvenance;
  providers: Array<{ id: string; version: string; capabilities: string[]; runtimeMs?: number }>;
}

/** Assemble SongGraph from resolved multi-provider analysis. */
export function buildSongGraphFromResolved(song: Song, resolved: ResolvedAnalysis): SongGraph {
  const lastBeat = resolved.beats.length > 0 ? resolved.beats[resolved.beats.length - 1]!.beat : 0;
  const chordEnd = resolved.chords.reduce((m, c) => Math.max(m, c.startBeat + c.durationBeats), 0);
  const endBeat = Math.max(lastBeat, chordEnd, 1);

  const graph: SongGraph = {
    id: song.id,
    metadata: {
      title: song.title,
      ...(song.artist !== undefined && { artist: song.artist }),
      durationMs: song.durationMs,
    },
    global: {
      bpm: resolved.tempo.bpm,
      timeSignature: resolved.timeSignature,
      ...(resolved.keyLabel !== undefined && { key: resolved.keyLabel }),
      tuningReferenceHz: 440,
    },
    beats: resolved.beats,
    sections: resolved.sections,
    harmony: { chords: resolved.chords },
    motifs: [],
    confidence: {
      overall: resolved.confidence.overall,
      rhythm: resolved.confidence.rhythm,
      key: resolved.confidence.key,
      chord: resolved.confidence.chord,
    },
    provenance: {
      provider: resolved.providers.map((p) => p.id).join('+'),
      analysisVersion: '2',
      createdAt: new Date().toISOString(),
    },
    analysis: {
      tempo: resolved.tempoProvenance,
      chords: resolved.chordProvenance,
      providers: resolved.providers,
      ...(resolved.rhythm !== undefined && {
        rhythm: {
          bpm: resolved.rhythm.bpm,
          pulseLevel: resolved.rhythm.pulseLevel,
          meter: {
            numerator: resolved.rhythm.meter.numerator,
            denominator: resolved.rhythm.meter.denominator ?? 4,
            ...(resolved.rhythm.meter.grouping !== undefined && { grouping: resolved.rhythm.meter.grouping }),
            ...(resolved.rhythm.meter.compound !== undefined && { compound: resolved.rhythm.meter.compound }),
            confidence: resolved.rhythm.meter.confidence,
            source: resolved.rhythm.meter.source,
          },
          meterAlternatives: resolved.rhythm.meterAlternatives.map((m) => ({ numerator: m.numerator, confidence: m.confidence })),
          evidence: resolved.rhythm.evidence.map((e) => ({ kind: e.kind, detail: e.detail })),
          overrides: resolved.overrides ?? [],
        },
      }),
    },
  };
  return SongGraphSchema.parse(graph) as SongGraph;
}

/** Seconds-based provider segments -> SongGraph sections on the beat grid. */
export function sectionsFromSegments(
  segments: Array<{ start: number; end: number; label: string }>,
  beats: BeatEvent[],
): SongGraph['sections'] {
  const usable = segments.filter((s) => s.end > s.start);
  if (usable.length === 0) {
    return [
      {
        id: newId('sec'),
        type: 'UNKNOWN',
        startBeat: 0,
        endBeat: Math.max(1, beats.length),
        confidence: 0.3,
        importance: DEFAULT_SECTION_IMPORTANCE.UNKNOWN,
      },
    ];
  }
  const timeToBeat = (t: number): number => {
    if (beats.length === 0) return 0;
    let lo = 0;
    let hi = beats.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid]!.timeMs < t * 1000) lo = mid + 1;
      else hi = mid;
    }
    const cand = beats[lo]!;
    const prev = beats[lo - 1];
    if (prev && Math.abs(prev.timeMs - t * 1000) < Math.abs(cand.timeMs - t * 1000)) return prev.beat;
    return cand.beat;
  };
  return usable.map((s) => {
    const type = mapSectionLabel(s.label);
    return {
      id: newId('sec'),
      type,
      startBeat: timeToBeat(s.start),
      endBeat: Math.max(timeToBeat(s.end), timeToBeat(s.start) + 1),
      confidence: 0.7,
      importance: DEFAULT_SECTION_IMPORTANCE[type],
    };
  });
}

export type { ChordConsensusSegment };
