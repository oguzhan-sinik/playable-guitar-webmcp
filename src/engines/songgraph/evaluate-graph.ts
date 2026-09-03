import type { SongGraph } from '../../domain/music/song-graph.js';

export interface GraphEvaluation {
  /** |detected - reference| in BPM, also checking half/double-time equivalence. */
  tempo: {
    reference: number;
    detected: number;
    absoluteDifference: number;
    /** Best difference after folding octaves (x1, x2, x0.5, ...). */
    octaveFoldedDifference: number;
    musicallyRelated: boolean;
    /** Metrical relation of detected to reference (within 4% tolerance). */
    metricalRelation: '1:1' | '1:2' | '2:1' | '2:3' | '3:2' | '1:3' | '3:1' | 'OTHER';
  };
  key: { reference: string; detected: string; match: boolean } | null;
  chords: {
    /** Fraction of reference chord time covered by an inferred chord with the same root. */
    rootAccuracy: number;
    /** Given a root match, fraction with matching major/minor quality. */
    qualityAccuracy: number;
    /** Fraction of sampled reference time covered by any inferred chord at all. */
    coverage: number;
    detectedChordChanges: number;
    referenceChordCount: number;
    /** predicted / reference segment count; >1 means over-segmentation. */
    fragmentationRatio: number;
  };
}

const isPowerOfTwoRelated = (a: number, b: number): boolean => {
  const ratio = a / b;
  const log2 = Math.log2(Math.abs(ratio));
  return Math.abs(log2 - Math.round(log2)) < 0.08 && Math.round(log2) >= -2 && Math.round(log2) <= 2;
};

/** Beat index -> seconds. Uses the graph's own detected beat grid when the
 * beat index is on it (grids wobble; a uniform BPM formula would drift),
 * falling back to the BPM formula beyond the grid. */
function beatToSeconds(graph: SongGraph, beat: number): number {
  const index = Math.floor(beat);
  const grid = graph.beats;
  if (grid.length > 0) {
    if (index < grid.length) {
      const base = grid[index]!.timeMs / 1000;
      const frac = beat - index;
      const next = index + 1 < grid.length ? grid[index + 1]!.timeMs / 1000 : base + 60 / graph.global.bpm;
      return base + frac * (next - base);
    }
    const last = grid[grid.length - 1]!;
    return last.timeMs / 1000 + (beat - last.beat) * (60 / graph.global.bpm);
  }
  return (beat * 60) / graph.global.bpm;
}

/** Chord active at time t (seconds), or null for a gap. */
function chordAtTime(graph: SongGraph, t: number) {
  return (
    graph.harmony.chords.find(
      (c) => t >= beatToSeconds(graph, c.startBeat) && t < beatToSeconds(graph, c.startBeat + c.durationBeats),
    ) ?? null
  );
}

/**
 * Dev-only comparison of an inferred graph against a hand-authored reference.
 * The reference is NEVER used during inference — evaluation only.
 *
 * Graphs may have different BPM grids, so comparison happens in the time
 * domain: both chord timelines are converted to seconds using their own BPM
 * and sampled every 0.25 s over the overlap.
 */
export function evaluateGraph(inferred: SongGraph, reference: SongGraph): GraphEvaluation {
  const detected = inferred.global.bpm;
  const refBpm = reference.global.bpm;
  const fold = (bpm: number): number => {
    let b = bpm;
    while (b < refBpm * 0.75) b *= 2;
    while (b > refBpm * 1.5) b /= 2;
    return b;
  };
  const folded = fold(detected);

  const key =
    reference.global.key !== undefined && inferred.global.key !== undefined
      ? {
          reference: reference.global.key,
          detected: inferred.global.key,
          match: normalizeKey(inferred.global.key) === normalizeKey(reference.global.key),
        }
      : null;

  const refEnd = Math.max(...reference.harmony.chords.map((c) => beatToSeconds(reference, c.startBeat + c.durationBeats)));
  const infEnd = Math.max(...inferred.harmony.chords.map((c) => beatToSeconds(inferred, c.startBeat + c.durationBeats)));
  const end = Math.min(refEnd, infEnd);
  const step = 0.25;
  let sampled = 0;
  let rootHits = 0;
  let qualityHits = 0;
  let covered = 0;
  for (let t = 0; t < end; t += step) {
    const refChord = chordAtTime(reference, t);
    const infChord = chordAtTime(inferred, t);
    sampled++;
    if (refChord === null || infChord === null) continue;
    covered++;
    if (refChord.root === infChord.root) {
      rootHits++;
      if (refChord.quality === infChord.quality) qualityHits++;
    }
  }

  const detectedChanges = inferred.harmony.chords.reduce(
    (n, c, i) =>
      i === 0 ||
      inferred.harmony.chords[i - 1]!.root !== c.root ||
      inferred.harmony.chords[i - 1]!.quality !== c.quality
        ? n + 1
        : n,
    0,
  );

  const ratio = detected / refBpm;
  const rel = (target: number): boolean => Math.abs(ratio - target) < 0.04;
  const metricalRelation = rel(1)
    ? ('1:1' as const)
    : rel(0.5)
      ? ('1:2' as const)
      : rel(2)
        ? ('2:1' as const)
        : rel(2 / 3)
          ? ('2:3' as const)
          : rel(1.5)
            ? ('3:2' as const)
            : rel(1 / 3)
              ? ('1:3' as const)
              : rel(3)
                ? ('3:1' as const)
                : ('OTHER' as const);

  return {
    tempo: {
      reference: refBpm,
      detected,
      absoluteDifference: Math.abs(detected - refBpm),
      octaveFoldedDifference: Math.abs(folded - refBpm),
      musicallyRelated: isPowerOfTwoRelated(detected, refBpm) || Math.abs(detected - refBpm) < 6,
      metricalRelation,
    },
    key,
    chords: {
      rootAccuracy: sampled > 0 ? rootHits / sampled : 0,
      qualityAccuracy: sampled > 0 ? qualityHits / sampled : 0,
      coverage: sampled > 0 ? covered / sampled : 0,
      detectedChordChanges: detectedChanges,
      referenceChordCount: reference.harmony.chords.length,
      fragmentationRatio:
        reference.harmony.chords.length > 0
          ? inferred.harmony.chords.length / reference.harmony.chords.length
          : 0,
    },
  };
}

function normalizeKey(key: string): string {
  const m = /^([A-Ga-g][#b]?)\s*(major|minor|maj|min|m)?\s*$/.exec(key.trim());
  if (m === null) return key.trim().toLowerCase();
  const canonical = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  const flats: Record<string, string> = { Bb: 'A#', Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#' };
  const root = flats[canonical] ?? canonical;
  const scale = m[2] === undefined ? 'major' : /maj/i.test(m[2]) ? 'major' : 'minor';
  return `${root} ${scale}`;
}
