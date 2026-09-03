import type { ChordAnalysisResult } from '../../domain/analysis/raw-music-analysis.js';
import type { ChordEvent } from '../../domain/music/chord.js';
import type { PitchClass } from '../../domain/music/pitch.js';
import { normalizeChordLabel } from '../../domain/music/normalize.js';

export interface ChordConsensusVote {
  provider: string;
  label: string;
  audioVariant: string;
}

export interface ChordConsensusSegment {
  startBeat: number;
  endBeat: number;
  root: PitchClass;
  quality: 'major' | 'minor';
  /** Mean normalized winner score across the segment's beats. */
  agreement: number;
  votes: ChordConsensusVote[];
}

export interface ChordConsensusInput {
  timelines: ChordAnalysisResult[];
  /** Resolved beat grid in seconds. */
  beatTimes: number[];
  key?: { root: PitchClass; scale: 'major' | 'minor' } | null;
  config?: {
    /** Segments shorter than this are absorbed into a neighbour unless
     * providers unanimously agreed on them. */
    minimumChordDurationBeats?: number;
    /** Vote weight per provider timeline (e.g. demixed variants may earn trust). */
    providerWeights?: Record<string, number>;
    keyPriorStrength?: number;
  };
}

export interface ChordConsensusOutput {
  chords: ChordEvent[];
  segments: ChordConsensusSegment[];
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

function diatonicRoots(key: { root: PitchClass; scale: string } | null | undefined): Set<number> {
  if (!key) return new Set();
  const tonicPc = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(key.root);
  const scale = key.scale === 'minor' ? MINOR_SCALE : MAJOR_SCALE;
  return new Set(scale.map((s) => (tonicPc + s) % 12));
}

function beatIndexForTime(beatTimes: number[], t: number): number {
  // snap to the nearest beat of the grid
  let lo = 0;
  let hi = beatTimes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beatTimes[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(beatTimes[lo - 1]! - t) < Math.abs(beatTimes[lo]! - t)) return lo - 1;
  return lo;
}

interface BeatState {
  scores: Map<string, number>;
  votes: Map<string, ChordConsensusVote[]>;
}

/**
 * Deterministic evidence-based chord consensus. Not majority vote: per beat,
 * each provider's overlapping segment votes with weight = temporal coverage;
 * a small key-compatibility prior (never a hard rule) and a temporal
 * consistency bonus with the previous winning chord are added. Beat winners
 * merge into segments; short segments are absorbed into a neighbour unless
 * every timeline agreed on them.
 */
export function resolveChords(input: ChordConsensusInput): ChordConsensusOutput {
  const { timelines, beatTimes } = input;
  const config = { minimumChordDurationBeats: 2, keyPriorStrength: 0.15, ...input.config };
  if (beatTimes.length === 0) return { chords: [], segments: [] };

  const diatonic = diatonicRoots(input.key);
  const beats: BeatState[] = beatTimes.map(() => ({ scores: new Map(), votes: new Map() }));

  const vote = (beatIdx: number, keyStr: string, weight: number, v: ChordConsensusVote) => {
    const state = beats[beatIdx]!;
    state.scores.set(keyStr, (state.scores.get(keyStr) ?? 0) + weight);
    const list = state.votes.get(keyStr) ?? [];
    list.push(v);
    state.votes.set(keyStr, list);
  };

  for (const timeline of timelines) {
    const weight = config.providerWeights?.[timeline.provider] ?? 1;
    for (const segment of timeline.segments) {
      const parsed = normalizeChordLabel(segment.label);
      if (parsed === null || (parsed.quality !== 'major' && parsed.quality !== 'minor')) continue;
      const keyStr = `${parsed.root}:${parsed.quality}`;
      const startIdx = beatIndexForTime(beatTimes, segment.startSeconds);
      const endIdx = Math.min(beatIndexForTime(beatTimes, segment.endSeconds) + 1, beatTimes.length);
      for (let b = startIdx; b < endIdx; b++) {
        // coverage of this beat by the segment, in [0, 1]
        const beatStart = beatTimes[b]!;
        const beatEnd = b + 1 < beatTimes.length ? beatTimes[b + 1]! : beatTimes[b]! + 0.5;
        const overlap = Math.min(segment.endSeconds, beatEnd) - Math.max(segment.startSeconds, beatStart);
        const beatDuration = beatEnd - beatStart;
        const coverage = beatDuration > 0 ? Math.max(0, Math.min(1, overlap / beatDuration)) : 0;
        if (coverage <= 0) continue;
        vote(b, keyStr, weight * coverage, {
          provider: timeline.provider,
          label: segment.label,
          audioVariant: timeline.audioVariant,
        });
      }
    }
  }

  // per-beat winner with key prior + temporal consistency
  interface BeatWinner {
    root: PitchClass;
    quality: 'major' | 'minor';
    score: number;
    total: number;
    votes: ChordConsensusVote[];
  }
  const winners: Array<BeatWinner | null> = [];
  let prev: string | null = null;
  for (const state of beats) {
    let best: { keyStr: string; score: number; total: number } | null = null;
    let total = 0;
    for (const [keyStr, score] of state.scores) total += score;
    for (const [keyStr, score] of state.scores) {
      const [rootStr, qualityStr] = keyStr.split(':') as [PitchClass, 'major' | 'minor'];
      let adjusted = score;
      const rootPc = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(rootStr);
      if (diatonic.has(rootPc)) adjusted += config.keyPriorStrength;
      if (keyStr === prev) adjusted += 0.1 * score; // temporal consistency
      if (best === null || adjusted > best.score) best = { keyStr, score: adjusted, total };
    }
    if (best === null || total === 0 || best.score <= 0) {
      winners.push(null);
      prev = null;
      continue;
    }
    const [rootStr, qualityStr] = best.keyStr.split(':') as [PitchClass, 'major' | 'minor'];
    const winner: BeatWinner = {
      root: rootStr,
      quality: qualityStr,
      score: best.score,
      total,
      votes: state.votes.get(best.keyStr) ?? [],
    };
    winners.push(winner);
    prev = best.keyStr;
  }

  // merge consecutive winners into segments
  const segments: ChordConsensusSegment[] = [];
  for (let b = 0; b < winners.length; b++) {
    const w = winners[b]!;
    if (!w) continue;
    const last = segments[segments.length - 1];
    if (last && last.root === w.root && last.quality === w.quality && last.endBeat === b) {
      last.endBeat = b + 1;
      last.agreement = (last.agreement + w.score / Math.max(w.total, 1e-9)) / 2;
      last.votes.push(...w.votes);
      continue;
    }
    segments.push({
      startBeat: b,
      endBeat: b + 1,
      root: w.root,
      quality: w.quality,
      agreement: w.score / Math.max(w.total, 1e-9),
      votes: w.votes,
    });
  }

  // short-segment cleanup: absorb into the longer neighbour unless unanimous
  const minBeats = config.minimumChordDurationBeats;
  const cleaned: ChordConsensusSegment[] = [];
  for (const seg of segments) {
    const duration = seg.endBeat - seg.startBeat;
    const unanimous = seg.votes.length > 0 && new Set(seg.votes.map((v) => v.provider)).size === timelines.length;
    if (duration >= minBeats || unanimous) {
      cleaned.push(seg);
      continue;
    }
    const prevSeg = cleaned[cleaned.length - 1];
    const gapAfter = segments[segments.indexOf(seg) + 1];
    const nextSeg = gapAfter;
    if (prevSeg && (!nextSeg || prevSeg.endBeat - prevSeg.startBeat >= nextSeg.endBeat - nextSeg.startBeat)) {
      prevSeg.endBeat = seg.endBeat; // absorb into previous
    } else if (nextSeg) {
      nextSeg.startBeat = seg.startBeat; // hand beats to the following chord
    } else if (prevSeg) {
      prevSeg.endBeat = seg.endBeat;
    } else {
      cleaned.push(seg); // isolated short segment — keep, it is all we have
    }
  }

  const chords: ChordEvent[] = cleaned.map((s) => ({
    startBeat: s.startBeat,
    durationBeats: s.endBeat - s.startBeat,
    root: s.root,
    quality: s.quality,
    confidence: Math.min(1, s.agreement),
  }));

  return { chords, segments: cleaned };
}
