import type { SongGraph } from '../../domain/music/song-graph.js';
import { getChordPitchClasses, type ChordQuality } from '../../domain/music/chord.js';
import { pitchClassToNumber, numberToPitchClass } from '../../domain/music/pitch.js';
import {
  BUILT_IN_SHAPES,
  findShape,
  type GuitarChordShape,
} from '../../domain/guitar/chord-shape.js';
import { validateChordShape } from '../guitar/chord-shape-validator.js';
import { DEFAULT_GUITAR, type GuitarConfig } from '../../domain/guitar/tuning.js';
import { computeFingeringCost, DEFAULT_FINGERING_WEIGHTS } from '../../domain/guitar/fingering.js';
import { optimizeNotePositions } from '../guitar/position-optimizer.js';
import { GuitarArrangementSchema, type GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import type { ArrangementChordEvent } from '../../domain/arrangement/chord-event.js';
import type { ArrangementNoteEvent } from '../../domain/arrangement/note-event.js';
import { newArrangementId, newId } from '../../utils/ids.js';
import { AppError } from '../../errors/app-error.js';

const QUALITY_INTERVALS: Partial<Record<ChordQuality, number[]>> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
};

/** Shapes whose sounding pitch classes exactly match the chord's. */
function matchingShapes(root: string, quality: ChordQuality): GuitarChordShape[] {
  const intervals = QUALITY_INTERVALS[quality];
  if (intervals === undefined) return [];
  const rootNum = pitchClassToNumber(root as never);
  const target = new Set(intervals.map((i) => numberToPitchClass(rootNum + i)));
  return BUILT_IN_SHAPES.filter((shape) => {
    const sounding = validateChordShape(shape, intervals, root as never);
    if (!sounding.valid) return false;
    const pcs = new Set(sounding.soundingPitches.map((p) => p.pitchClass));
    return pcs.size === target.size && [...target].every((pc) => pcs.has(pc));
  });
}

export interface BuildArrangementOptions {
  guitar?: GuitarConfig;
  tempoFactor?: number;
}

/**
 * V0 deterministic base arrangement from a (synthetic, perfect-information)
 * SongGraph: cheapest valid shape per chord (tie-break: transition from the
 * previous grip), DP-optimized melody positions. Chords and melodies are
 * handled independently; no polyphonic fingering yet.
 */
export function buildBaseArrangement(song: SongGraph, options: BuildArrangementOptions = {}): GuitarArrangement {
  const guitar = options.guitar ?? DEFAULT_GUITAR;
  const tempoFactor = options.tempoFactor ?? 1;

  // --- harmony ---
  const chordEvents: ArrangementChordEvent[] = [];
  let prevAnchor: { string: number; fret: number } | null = null;
  for (const chord of song.harmony.chords) {
    const candidates = matchingShapes(chord.root, chord.quality);
    if (candidates.length === 0) {
      throw new AppError(
        'DOMAIN_VALIDATION',
        `No built-in shape for ${chord.root} ${chord.quality}`,
      );
    }
    const scored = candidates.map((shape) => {
      const fretted = shape.frets
        .map((f, i) => ({ string: i + 1, fret: f }))
        .filter((p): p is { string: number; fret: number } => p.fret !== null && p.fret > 0);
      const anchor = fretted.reduce((m, p) => (p.fret < m.fret ? p : m), { string: 0, fret: Infinity });
      const ownCost = fretted.length * 0.2 + (shape.barre ? 2 : 0);
      const transitionCost = prevAnchor
        ? computeFingeringCost(prevAnchor, anchor, DEFAULT_FINGERING_WEIGHTS).total
        : 0;
      return { shape, anchor, cost: ownCost + transitionCost };
    });
    scored.sort((a, b) => a.cost - b.cost);
    const best = scored[0]!;
    prevAnchor = best.anchor;
    chordEvents.push({
      id: newId('chev'),
      chord: { ...chord },
      shapeName: best.shape.chord,
      startBeat: chord.startBeat,
      durationBeats: chord.durationBeats,
    });
  }

  // --- melody ---
  let noteEvents: ArrangementNoteEvent[] = [];
  if (song.melody && song.melody.notes.length > 0) {
    const motifIdsOf = (noteId: string) =>
      song.motifs.filter((m) => m.eventIds.includes(noteId)).map((m) => m.id);
    const assignments = optimizeNotePositions(song.melody.notes, guitar);
    noteEvents = assignments.map((a) => {
      const src = song.melody!.notes.find((n) => n.id === a.noteId)!;
      return {
        id: newId('nev'),
        sourceNoteId: src.id,
        midi: src.midi,
        position: a.position,
        startBeat: src.startBeat,
        durationBeats: src.durationBeats,
        salience: src.salience ?? 0.3,
        motifIds: motifIdsOf(src.id),
      };
    });
  }

  // --- techniques: one BARRE event per barre-shaped chord grip ---
  const techniques = chordEvents
    .filter((c) => findShape(c.shapeName)?.barre)
    .map((c) => ({ id: newId('tech'), type: 'BARRE' as const, targetEventId: c.id, startBeat: c.startBeat }));

  const ends = [
    ...chordEvents.map((c) => c.startBeat + c.durationBeats),
    ...noteEvents.map((n) => n.startBeat + n.durationBeats),
  ];
  const durationBeats = ends.length > 0 ? Math.max(...ends) : 1;

  const arrangement: GuitarArrangement = {
    id: newArrangementId(),
    songId: song.id,
    tuning: { ...guitar },
    tempoFactor,
    durationBeats,
    chords: chordEvents,
    notes: noteEvents,
    techniques,
    transformations: [],
  };
  return GuitarArrangementSchema.parse(arrangement) as GuitarArrangement;
}
