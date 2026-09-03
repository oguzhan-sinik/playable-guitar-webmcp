import { findShape, type GuitarChordShape } from '../../domain/guitar/chord-shape.js';

/**
 * Chord diagram view model. Shape frets are capo-relative positions
 * (fret 0 = open above the capo), so the diagram's nut IS the capo and the
 * capo number renders as context text.
 */
export interface ChordDiagramString {
  /** 1 = high E … 6 = low E (matches GuitarChordShape.frets order). */
  string: number;
  /** Muted (×) strings. */
  muted: boolean;
  /** Open string (○) — fret 0. */
  open: boolean;
  /** Fret row to dot, 1-based within the diagram window. */
  fret: number;
  /** Absolute instrument fret (relative-to-nut), for tooltips. */
  absoluteFret: number;
  /** Barre starts/continues on this string. */
  barre: boolean;
}

export interface ChordDiagram {
  name: string;
  capo: number;
  strings: ChordDiagramString[];
  barre?: { fret: number; fromString: number; toString: number };
  /** Lowest fretted fret shown in the window (usually 1). */
  baseFret: number;
  fretWindow: number;
}

const DEFAULT_WINDOW = 4;

export function buildChordDiagram(
  name: string,
  shape: GuitarChordShape,
  capo = 0,
  fretWindow = DEFAULT_WINDOW,
): ChordDiagram {
  const fretted = shape.frets.filter((f): f is number => f !== null && f > 0);
  const lowest = fretted.length > 0 ? Math.min(...fretted) : 1;
  // window starts at 1 unless the shape lives higher up the neck
  const baseFret = lowest > fretWindow ? lowest : 1;

  const barreFret = shape.barre?.fret;
  const strings: ChordDiagramString[] = shape.frets.map((fret, i) => {
    const string = i + 1;
    const muted = fret === null;
    const fretValue = muted ? 0 : fret;
    const inBarre =
      barreFret !== undefined &&
      string >= shape.barre!.fromString &&
      string <= shape.barre!.toString &&
      fretValue === barreFret;
    return {
      string,
      muted,
      open: !muted && fretValue === 0,
      fret: muted ? 0 : Math.max(0, fretValue - baseFret + 1),
      absoluteFret: fretValue,
      barre: inBarre,
    };
  });

  return {
    name,
    capo,
    strings,
    ...(shape.barre !== undefined && {
      barre: {
        fret: Math.max(1, barreFret! - baseFret + 1),
        fromString: shape.barre.fromString,
        toString: shape.barre.toString,
      },
    }),
    baseFret,
    fretWindow,
  };
}

/** Convenience: diagram from a shape name, or undefined when unknown. */
export function chordDiagramFor(name: string, capo = 0): ChordDiagram | undefined {
  const shape = findShape(name);
  return shape === undefined ? undefined : buildChordDiagram(name, shape, capo);
}
