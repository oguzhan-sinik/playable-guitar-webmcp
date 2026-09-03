import { describe, expect, it } from 'vitest';
import {
  getChordPitchClasses,
  transposeChord,
  type ChordEvent,
} from '../../src/domain/music/chord.js';
import {
  BUILT_IN_SHAPES,
  findShape,
  formatShape,
  shapeToPositions,
} from '../../src/domain/guitar/chord-shape.js';
import { validateChordShape } from '../../src/engines/guitar/chord-shape-validator.js';
import { calculateChordDifficulty, calculateChordTransitionCost } from '../../src/engines/guitar/chord-difficulty.js';

const chord = (root: ChordEvent['root'], quality: ChordEvent['quality']): ChordEvent => ({
  startBeat: 0,
  durationBeats: 4,
  root,
  quality,
  confidence: 1,
});

const QUALITY_INTERVALS: Record<string, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
};

describe('chord pitch classes', () => {
  it('C major -> C E G', () => {
    expect(getChordPitchClasses(chord('C', 'major'))).toEqual(['C', 'E', 'G']);
  });
  it('A minor -> A C E', () => {
    expect(getChordPitchClasses(chord('A', 'minor'))).toEqual(['A', 'C', 'E']);
  });
  it('G7 -> G B D F', () => {
    expect(getChordPitchClasses(chord('G', 'dominant7'))).toEqual(['G', 'B', 'D', 'F']);
  });
  it('includes slash bass when foreign', () => {
    expect(getChordPitchClasses({ ...chord('C', 'major'), bass: 'E' })).toEqual(['C', 'E', 'G']);
    expect(getChordPitchClasses({ ...chord('C', 'major'), bass: 'D' })).toEqual(['C', 'E', 'G', 'D']);
  });
  it('transposes root and bass', () => {
    expect(transposeChord(chord('C', 'major'), 2).root).toBe('D');
    expect(transposeChord(chord('B', 'minor'), 1).root).toBe('C');
    expect(
      transposeChord({ ...chord('C', 'major'), bass: 'G' }, 5).bass,
    ).toBe('C');
  });
});

describe('built-in chord shape validation', () => {
  for (const shape of BUILT_IN_SHAPES) {
    it(`validates ${shape.chord}`, () => {
      const m = /^([A-G]#?b?)(maj7|m7|m|7)?$/.exec(shape.chord)!;
      if (!m) return; // non-standard name, covered elsewhere
      const quality = { '': 'major', m: 'minor', '7': 'dominant7', maj7: 'major7', m7: 'minor7' }[m[2] ?? '']!;
      // domain pitch classes are sharp-spelled: flats normalize to sharps
      const root = m[1]!.replace('Bb', 'A#').replace('Eb', 'D#').replace('Ab', 'G#').replace('Db', 'C#');
      const result = validateChordShape(shape, QUALITY_INTERVALS[quality]!, root as never);
      expect(result.problems).toEqual([]);
      expect(result.valid).toBe(true);
    });
  }

  it('detects a corrupted shape', () => {
    const bad = { chord: 'C', frets: [0, 1, 0, 4, 0, null] as Array<number | null> };
    const result = validateChordShape(bad, QUALITY_INTERVALS.major!, 'C');
    expect(result.valid).toBe(false);
    expect(result.problems.some((p) => p.includes('not a chord tone'))).toBe(true);
  });

  it('renders conventional low-to-high format', () => {
    expect(formatShape(findShape('C')!)).toBe('x32010');
    expect(formatShape(findShape('F')!)).toBe('133211');
  });

  it('shapeToPositions skips muted strings', () => {
    expect(shapeToPositions(findShape('C')!)).toHaveLength(5);
    expect(shapeToPositions(findShape('G')!)).toHaveLength(6);
  });
});

describe('chord difficulty ordering', () => {
  const diff = (name: string) => calculateChordDifficulty(findShape(name)!);
  it('open chords easier than full barre', () => {
    expect(diff('Em')).toBeLessThan(diff('F'));
    expect(diff('C')).toBeLessThan(diff('F'));
    expect(diff('Em')).toBeLessThan(diff('Bm'));
  });
  it('is deterministic', () => {
    expect(diff('F')).toBe(diff('F'));
  });
  it('barre shape reports barre info used in scoring', () => {
    expect(findShape('F')!.barre).toEqual({ fret: 1, fromString: 1, toString: 6 });
    expect(findShape('Bm')!.barre).toEqual({ fret: 2, fromString: 1, toString: 5 });
  });
});

describe('chord transition cost', () => {
  it('same chord costs zero', () => {
    const em = findShape('Em')!;
    expect(calculateChordTransitionCost(em, em).total).toBe(0);
  });
  it('adjacent shapes cheaper than distant ones', () => {
    const cost = (a: string, b: string) =>
      calculateChordTransitionCost(findShape(a)!, findShape(b)!).total;
    expect(cost('Em', 'Em7')).toBeLessThan(cost('C', 'Bm'));
  });
  it('barre introduction adds cost', () => {
    const cost = (a: string, b: string) =>
      calculateChordTransitionCost(findShape(a)!, findShape(b)!);
    expect(cost('Em', 'F').barreChange).toBe(1);
    expect(cost('F', 'Bm').barreChange).toBe(0); // both barre
  });
});
