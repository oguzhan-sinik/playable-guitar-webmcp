import { BUILT_IN_SHAPES, findShape } from '../../domain/guitar/chord-shape.js';
import { getChordPitchClasses } from '../../domain/music/chord.js';
import { midiToPitchClass, numberToPitchClass, pitchClassToNumber } from '../../domain/music/pitch.js';
import { getPitchAtPosition, getPositionsForMidi } from '../../domain/guitar/fretboard.js';
import { withCapo } from '../../domain/guitar/capo.js';
import { cloneArrangement, measureCandidate, transformationOf } from './measurement.js';
import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import type { ArrangementTransformation, TransformationContext, TransformationResult } from './transformation.js';

const CAPO_RANGE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function shapeSoundingAtCapo(shapeName: string, capo: number): Set<string> {
  const shape = findShape(shapeName);
  if (!shape) return new Set();
  const guitar = { tuning: [64, 59, 55, 50, 45, 40] as const, frets: 24, capo };
  const pcs = new Set<string>();
  for (const [i, fret] of shape.frets.entries()) {
    if (fret === null) continue;
    try {
      pcs.add(midiToPitchClass(getPitchAtPosition(guitar, i + 1, fret)));
    } catch {
      return new Set(); // fret beyond range with this capo
    }
  }
  return pcs;
}

/**
 * For each capo 0-9, find open-family shapes whose sounding pitch classes
 * (shape + capo) match each chord exactly. Sounding key is preserved by
 * construction — this is never a transposition of the song. Returns the best
 * strictly-easier capo configuration, or nothing.
 */
export class CapoOptimization implements ArrangementTransformation {
  name = 'CAPO_OPTIMIZATION' as const;

  apply(arrangement: GuitarArrangement, context: TransformationContext): TransformationResult[] {
    if (arrangement.chords.length === 0) return [];
    const results: TransformationResult[] = [];

    for (const capo of CAPO_RANGE) {
      if (capo === arrangement.tuning.capo) continue;
      const candidate = cloneArrangement(arrangement);

      // 1. every chord must have a shape sounding identically at this capo
      let allMatched = true;
      for (const ev of candidate.chords) {
        const target = new Set(getChordPitchClasses(ev.chord));
        const match = BUILT_IN_SHAPES.find(
          (s) => {
            const sounding = shapeSoundingAtCapo(s.chord, capo);
            return sounding.size === target.size && [...target].every((pc) => sounding.has(pc));
          },
        );
        if (!match) {
          allMatched = false;
          break;
        }
        ev.shapeName = match.chord;
      }
      if (!allMatched) continue;

      // 2. melody notes must still be playable at this capo
      let playable = true;
      for (const note of candidate.notes) {
        const positions = getPositionsForMidi({ ...candidate.tuning, capo }, note.midi);
        if (positions.length === 0) {
          playable = false;
          break;
        }
        note.position = positions[0]!;
      }
      if (!playable) continue;

      candidate.tuning = withCapo(candidate.tuning, capo);

      const measured = measureCandidate(
        candidate,
        arrangement,
        transformationOf(
          this.name,
          `Capo ${capo}: equivalent open-family shapes, sounding harmony unchanged`,
          candidate.chords.map((c) => c.id),
          { capo },
        ),
        context,
      );
      if (measured) results.push(measured);
    }

    // best (lowest difficulty) only
    results.sort((a, b) => a.difficultyAfter.total - b.difficultyAfter.total);
    return results.length > 0 ? [results[0]!] : [];
  }
}
