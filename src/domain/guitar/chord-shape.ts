/**
 * Curated open/barre chord shapes.
 *
 * Convention: frets[i] is string i+1 (high E first), matching GuitarConfig.tuning.
 * null = muted string. Numbers are absolute instrument frets (capo 0 shapes).
 * Display code reverses for the conventional low-to-high "x32010" rendering.
 */
export interface GuitarChordShape {
  /** Display name, e.g. "C", "Am", "G7". */
  chord: string;
  /** String 1 -> string 6. null = muted. */
  frets: Array<number | null>;
  barre?: {
    fret: number;
    fromString: number;
    toString: number;
  };
}

export const BUILT_IN_SHAPES: readonly GuitarChordShape[] = [
  { chord: 'C', frets: [0, 1, 0, 2, 3, null] },
  { chord: 'A', frets: [0, 2, 2, 2, 0, null] },
  { chord: 'G', frets: [3, 0, 0, 0, 2, 3] },
  { chord: 'E', frets: [0, 0, 1, 2, 2, 0] },
  { chord: 'D', frets: [2, 3, 2, 0, null, null] },
  { chord: 'Am', frets: [0, 1, 2, 2, 0, null] },
  { chord: 'Em', frets: [0, 0, 0, 2, 2, 0] },
  { chord: 'Dm', frets: [1, 3, 2, 0, null, null] },
  { chord: 'F', frets: [1, 1, 2, 3, 3, 1], barre: { fret: 1, fromString: 1, toString: 6 } },
  { chord: 'Bm', frets: [2, 3, 4, 4, 2, null], barre: { fret: 2, fromString: 1, toString: 5 } },
  { chord: 'G7', frets: [1, 0, 0, 0, 2, 3] },
  { chord: 'Cmaj7', frets: [0, 0, 0, 2, 3, null] },
  { chord: 'Am7', frets: [0, 1, 0, 2, 0, null] },
  { chord: 'Em7', frets: [0, 0, 0, 0, 2, 0] },
  { chord: 'Fmaj7', frets: [0, 1, 2, 3, null, null] },
  // movable barre shapes so barre-heavy keys (e.g. Bb, Ab) have base arrangements
  { chord: 'B', frets: [2, 4, 4, 4, 2, null], barre: { fret: 2, fromString: 1, toString: 5 } },
  { chord: 'Bb', frets: [6, 6, 7, 8, 8, 6], barre: { fret: 6, fromString: 1, toString: 6 } },
  { chord: 'Eb', frets: [6, 8, 8, 8, 6, null], barre: { fret: 6, fromString: 1, toString: 5 } },
  { chord: 'Gm', frets: [3, 3, 3, 5, 5, 3], barre: { fret: 3, fromString: 1, toString: 6 } },
  { chord: 'Ab', frets: [4, 4, 5, 6, 6, 4], barre: { fret: 4, fromString: 1, toString: 6 } },
  { chord: 'Db', frets: [4, 6, 6, 6, 4, null], barre: { fret: 4, fromString: 1, toString: 5 } },
  { chord: 'Fm', frets: [1, 1, 1, 3, 3, 1], barre: { fret: 1, fromString: 1, toString: 6 } },
  { chord: 'F#m', frets: [2, 2, 2, 4, 4, 2], barre: { fret: 2, fromString: 1, toString: 6 } },
  { chord: 'Cm', frets: [3, 4, 5, 5, 3, null], barre: { fret: 3, fromString: 1, toString: 5 } },
  { chord: 'G#m', frets: [4, 4, 4, 6, 6, 4], barre: { fret: 4, fromString: 1, toString: 6 } },
  { chord: 'C#m', frets: [4, 5, 6, 6, 4, null], barre: { fret: 4, fromString: 1, toString: 5 } },
  { chord: 'A#m', frets: [1, 2, 3, 3, 1, null], barre: { fret: 1, fromString: 1, toString: 5 } },
];

export function findShape(name: string): GuitarChordShape | undefined {
  return BUILT_IN_SHAPES.find((s) => s.chord === name);
}

/** Conventional low-to-high rendering, e.g. "x32010". */
export function formatShape(shape: GuitarChordShape): string {
  return [...shape.frets]
    .reverse()
    .map((f) => (f === null ? 'x' : String(f)))
    .join('');
}

/** Positions implied by a shape on a capo-0 guitar: string/fret per sounding string. */
export function shapeToPositions(shape: GuitarChordShape): Array<{ string: number; fret: number }> {
  return shape.frets
    .map((fret, i) => ({ string: i + 1, fret }))
    .filter((p): p is { string: number; fret: number } => p.fret !== null);
}
