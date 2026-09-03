import type {
  CanonicalChord,
  CanonicalKey,
  ChordQualityFamily,
} from '../../domain/song-research/evidence-claim.js';
import { SECTION_TYPES, type SectionType } from '../../domain/music/section.js';

/**
 * Normalization: raw strings from arbitrary web pages → canonical musical
 * claims. G#/Ab are enharmonically equivalent; capo'd shape names become
 * sounding harmony before any comparison happens.
 */

// --- key ---

export function parseKey(input: string): CanonicalKey | null {
  const text = input.trim().replace(/^key(\s+of)?\s*:?\s*/i, '').trim();
  const m = /^\s*([A-Ga-g])([#b]?)\s*(major|minor|maj|min|m|−|-)?\s*(major|minor|maj|min)?\s*$/i.exec(text);
  if (m === null) return null;
  const letter = m[1]!.toUpperCase();
  const accidental = m[2] ?? '';
  const semis: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let tonic = semis[letter];
  if (tonic === undefined) return null;
  if (accidental === '#') tonic += 1;
  if (accidental === 'b') tonic -= 1;
  const rest = `${m[3] ?? ''} ${m[4] ?? ''}`.trim().toLowerCase();
  let mode: CanonicalKey['mode'] = 'MAJOR'; // bare "Key: G" conventionally means major
  if (/^(min|minor|m\b|m$|-|−)/.test(rest)) mode = 'MINOR';
  else if (/^(maj|major)/.test(rest)) mode = 'MAJOR';
  else if (rest.length > 0) mode = 'UNKNOWN';
  return { tonicPitchClass: ((tonic % 12) + 12) % 12, mode };
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Display spelling for a key, preferring the chord evidence's accidental world. */
export function keyLabel(key: CanonicalKey, preferFlats: boolean): string {
  const name = (preferFlats ? FLAT_NAMES : SHARP_NAMES)[((key.tonicPitchClass % 12) + 12) % 12]!;
  if (key.mode === 'MINOR') return `${name} minor`;
  if (key.mode === 'UNKNOWN') return name;
  return `${name} major`;
}

// --- chords ---

const SUFFIX_FAMILIES: Array<[RegExp, ChordQualityFamily]> = [
  [/^(maj7|maj9|maj13|maj$|Δ|6|69|add9|add2)/i, 'MAJOR'],
  [/^(m7|m9|m11|m6|min7|min9|min$|m$|min\b|-|−)/i, 'MINOR'],
  [/^(7|9|11|13|dom7|dom9|7sus4)/i, 'SEVENTH'],
];

/**
 * Parse a chord symbol ("Dbmaj7", "G#m", "Fm", "N.C.") into a canonical
 * sounding chord at the given capo. Comparison uses root + broad family;
 * the original label and extension are retained.
 */
export function parseChordSymbol(symbol: string, capo = 0): CanonicalChord | null {
  const text = symbol.trim();
  if (text.length === 0 || /^(n\.?c\.?|x)$/i.test(text)) return null;
  const m = /^([A-Ga-g])([#b]?)(.*)$/.exec(text);
  if (m === null) return null;
  const semis: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let pc = semis[m[1]!.toUpperCase()];
  if (pc === undefined) return null;
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  pc = ((pc + capo) % 12 + 12) % 12;

  const suffix = m[3]!.trim();
  let family: ChordQualityFamily = 'MAJOR'; // bare symbol = major triad
  let matched = false;
  if (suffix.length > 0) {
    for (const [re, f] of SUFFIX_FAMILIES) {
      if (re.test(suffix)) {
        family = f;
        matched = true;
        break;
      }
    }
    if (!matched) family = /m/i.test(suffix) ? 'MINOR' : 'OTHER';
    if (/^(dim|°|o|aug|\+)/i.test(suffix)) family = 'OTHER';
  }
  return { rootPc: pc, family, label: text, ...(suffix.length > 0 ? { extension: suffix } : {}) };
}

/** Convert played guitar shapes at a capo into sounding harmony. */
export function normalizeChordEvidenceToSoundingHarmony(chords: string[], capo: number): CanonicalChord[] {
  return chords.map((c) => parseChordSymbol(c, capo)).filter((c): c is CanonicalChord => c !== null);
}

/** True when two chord spellings live in the flat world (Db/Ab vs C#/G#). */
export function preferFlatSpelling(labels: string[]): boolean {
  let flats = 0;
  for (const label of labels) {
    if (/[A-G]b/.test(label)) flats += 1;
    if (/[A-G]#/.test(label)) flats -= 1;
  }
  return flats > 0;
}

export function chordLabelForPc(rootPc: number, family: ChordQualityFamily, preferFlats: boolean): string {
  const name = (preferFlats ? FLAT_NAMES : SHARP_NAMES)[((rootPc % 12) + 12) % 12]!;
  return `${name}${family === 'MINOR' ? 'm' : ''}`;
}

// --- sections ---

const SECTION_ALIASES: Array<[RegExp, SectionType]> = [
  [/^PRE_?CHORUS$/, 'PRE_CHORUS'],
  [/^POST_?CHORUS$/, 'CHORUS'],
  [/^VERSE/, 'VERSE'],
  [/^CHORUS|REFRAIN|HOOK$/, 'CHORUS'],
  [/^BRIDGE|MIDDLE_?8$/, 'BRIDGE'],
  [/^INTRO$/, 'INTRO'],
  [/^OUTRO|CODA$/, 'OUTRO'],
  [/^SOLO|GUITAR_?SOLO$/, 'SOLO'],
  [/^BREAKDOWN$/, 'BREAKDOWN'],
];

/**
 * "VERSE 1" / "Verse" / "VERSE_1" → VERSE. Unrecognized labels keep a
 * normalized token so evidence still clusters among themselves.
 */
export function normalizeSectionLabel(raw: string): string {
  const norm = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/_?\d+$/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '');
  for (const [re, type] of SECTION_ALIASES) {
    if (re.test(norm)) return type;
  }
  return norm.length > 0 ? norm : 'UNKNOWN';
}

export const KNOWN_SECTION_TYPES: readonly string[] = SECTION_TYPES;

// --- tempo ---

/** Metrical relation candidates; 63/126/189 are one pulse at 1×, 2×, 3×. */
export const TEMPO_RATIOS = [1 / 3, 1 / 2, 2 / 3, 1, 3 / 2, 2, 3] as const;
const TEMPO_TOLERANCE = 0.04;

export function tempoEquivalent(a: number, b: number): { equal: boolean; ratio: number } {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (lo <= 0) return { equal: false, ratio: 1 };
  const observed = hi / lo;
  for (const r of TEMPO_RATIOS) {
    if (Math.abs(observed - r) / r < TEMPO_TOLERANCE) return { equal: true, ratio: a >= b ? r : 1 / r };
  }
  return { equal: false, ratio: observed };
}

export function ratioName(ratio: number): string {
  if (Math.abs(ratio - 2) < TEMPO_TOLERANCE) return 'double-time subdivision';
  if (Math.abs(ratio - 3) < TEMPO_TOLERANCE) return 'triple-time subdivision';
  if (Math.abs(ratio - 1 / 2) < TEMPO_TOLERANCE) return 'half-time feel';
  if (Math.abs(ratio - 1 / 3) < TEMPO_TOLERANCE) return 'third-speed feel';
  if (Math.abs(ratio - 3 / 2) < TEMPO_TOLERANCE) return 'dotted pulse';
  if (Math.abs(ratio - 2 / 3) < TEMPO_TOLERANCE) return 'triplet pulse';
  return 'same pulse';
}

// --- sequence similarity ---

/** Levenshtein edit similarity over canonical chord sequences (0-1). */
export function sequenceSimilarity(a: CanonicalChord[], b: CanonicalChord[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const same = (x: CanonicalChord, y: CanonicalChord): boolean =>
    x.rootPc === y.rootPc && (x.family === y.family || x.family === 'SEVENTH' || y.family === 'SEVENTH');
  const dist = (x: CanonicalChord[], y: CanonicalChord[]): number => {
    const rows: number[] = Array.from({ length: y.length + 1 }, (_, i) => i);
    for (let i = 1; i <= x.length; i++) {
      let prev = rows[0]!;
      rows[0] = i;
      for (let j = 1; j <= y.length; j++) {
        const tmp = rows[j]!;
        rows[j] = Math.min(rows[j]! + 1, rows[j - 1]! + 1, prev + (same(x[i - 1]!, y[j - 1]!) ? 0 : 1));
        prev = tmp;
      }
    }
    return rows[y.length]!;
  };
  return 1 - dist(a, b) / Math.max(a.length, b.length);
}

/** Best similarity over rotations (riffs/loops may be written from any start). */
export function rotationSimilarity(a: CanonicalChord[], b: CanonicalChord[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return sequenceSimilarity(a, b);
  let best = 0;
  for (let r = 0; r < b.length; r++) {
    best = Math.max(best, sequenceSimilarity(a, [...b.slice(r), ...b.slice(0, r)]));
  }
  return best;
}

/** Constant-transposition check: identical interval pattern under +d semitones. */
export function transpositionShift(a: CanonicalChord[], b: CanonicalChord[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  const d = ((b[0]!.rootPc - a[0]!.rootPc) % 12 + 12) % 12;
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.family !== b[i]!.family) return null;
    if (((b[i]!.rootPc - a[i]!.rootPc) % 12 + 12) % 12 !== d) return null;
  }
  return d;
}
