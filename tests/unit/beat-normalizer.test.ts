import { describe, expect, it } from 'vitest';
import { ticksToBeats, secondsToNearestBeat, timeRangeToBeatRange } from '../../src/engines/songgraph/beat-normalizer.js';
import { AppError } from '../../src/errors/app-error.js';

const beat = (t: number) => ({ timeSeconds: t });

describe('ticksToBeats', () => {
  it('converts seconds to BeatEvents with indices and ms', () => {
    const beats = ticksToBeats([0, 0.5, 1.0, 1.5], 10);
    expect(beats).toEqual([
      { beat: 0, timeMs: 0, isDownbeat: true },
      { beat: 1, timeMs: 500, isDownbeat: false },
      { beat: 2, timeMs: 1000, isDownbeat: false },
      { beat: 3, timeMs: 1500, isDownbeat: false },
    ]);
  });
  it('never claims downbeats it did not detect', () => {
    const beats = ticksToBeats([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], 10);
    expect(beats.filter((b) => b.isDownbeat)).toHaveLength(1);
    expect(beats[3]!.isDownbeat).toBe(false);
  });
  it('sorts, deduplicates, and drops out-of-range ticks', () => {
    const beats = ticksToBeats([1, 0, 0.5, 0.5, -1, 99, Number.NaN], 2);
    expect(beats.map((b) => b.timeMs)).toEqual([0, 500, 1000]);
  });
});

describe('secondsToNearestBeat', () => {
  const beats = ticksToBeats([0, 0.5, 1, 1.5, 2], 2);
  it('snaps to the nearest detected beat, not a bpm formula', () => {
    expect(secondsToNearestBeat(0.42, beats)).toBe(1);
    expect(secondsToNearestBeat(0.61, beats)).toBe(1);
    expect(secondsToNearestBeat(1.9, beats)).toBe(4);
  });
  it('clamps outside the grid', () => {
    expect(secondsToNearestBeat(-5, beats)).toBe(0);
    expect(secondsToNearestBeat(99, beats)).toBe(4);
  });
  it('requires beats', () => {
    expect(() => secondsToNearestBeat(0, [])).toThrow(AppError);
  });
});

describe('timeRangeToBeatRange', () => {
  const beats = ticksToBeats([0, 0.5, 1, 1.5, 2], 2);
  it('maps a range onto exclusive-end beat indices', () => {
    expect(timeRangeToBeatRange(0, 1, beats)).toEqual({ startBeat: 0, endBeat: 2 });
    expect(timeRangeToBeatRange(0.5, 1.5, beats)).toEqual({ startBeat: 1, endBeat: 3 });
  });
  it('never returns an empty range', () => {
    expect(timeRangeToBeatRange(0.7, 0.75, beats)).toEqual({ startBeat: 1, endBeat: 2 });
  });
});
