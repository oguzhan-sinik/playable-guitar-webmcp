import { describe, expect, it } from 'vitest';
import { formatTablature, tablatureFromPositions } from '../../src/domain/guitar/tablature.js';
import { optimizeNotePositions } from '../../src/engines/guitar/position-optimizer.js';
import { DEFAULT_GUITAR } from '../../src/domain/guitar/tuning.js';
import type { NoteEvent } from '../../src/domain/music/note.js';

const note = (id: string, midi: number, startBeat: number): NoteEvent => ({
  id,
  midi,
  startBeat,
  durationBeats: 1,
  confidence: 1,
});

describe('ASCII tablature', () => {
  it('renders string 1 (e) on top', () => {
    const lines = formatTablature(tablatureFromPositions([
      { string: 5, fret: 3, midi: 48 },
      { string: 1, fret: 0, midi: 64 },
    ])).split('\n');
    expect(lines[0]!.startsWith('e|')).toBe(true);
    expect(lines[5]!.startsWith('E|')).toBe(true);
    expect(lines[0]).toContain('-0-');
    expect(lines[4]).toContain('-3-');
  });

  it('can render optimizer output for CLI inspection', () => {
    const result = optimizeNotePositions(
      [note('a', 64, 0), note('b', 65, 1), note('c', 67, 2)],
      DEFAULT_GUITAR,
    );
    const tab = formatTablature(tablatureFromPositions(result.map((r) => r.position)));
    expect(tab.split('\n')).toHaveLength(6);
    expect(tab.split('\n')[0]).toContain('-0-'); // E4 on string 1 fret 0
  });
});
