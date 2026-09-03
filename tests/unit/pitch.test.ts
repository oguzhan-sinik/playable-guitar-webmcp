import { describe, expect, it } from 'vitest';
import {
  midiToPitchClass,
  midiToPitchName,
  pitchClassToNumber,
  numberToPitchClass,
  pitchToMidi,
  transposeMidi,
  transposePitchClass,
  isValidMidi,
} from '../../src/domain/music/pitch.js';

describe('pitch basics', () => {
  it('maps 60 to C4', () => {
    expect(midiToPitchClass(60)).toBe('C');
    expect(midiToPitchName(60)).toBe('C4');
  });
  it('maps 61 to C#4 and 69 to A4', () => {
    expect(midiToPitchName(61)).toBe('C#4');
    expect(midiToPitchName(69)).toBe('A4');
  });
  it('round-trips pitch classes', () => {
    for (let n = 0; n < 12; n++) {
      expect(pitchClassToNumber(numberToPitchClass(n))).toBe(n);
    }
  });
  it('pitchToMidi agrees with midiToPitchName', () => {
    expect(pitchToMidi('C', 4)).toBe(60);
    expect(pitchToMidi('A', 4)).toBe(69);
    expect(pitchToMidi('E', 4)).toBe(64);
  });
});

describe('MIDI range validation with octave boundaries', () => {
  it('accepts 0 and 127', () => {
    expect(midiToPitchName(0)).toBe('C-1');
    expect(midiToPitchName(127)).toBe('G9');
    expect(isValidMidi(0)).toBe(true);
    expect(isValidMidi(127)).toBe(true);
  });
  it('rejects outside 0-127', () => {
    expect(() => midiToPitchName(-1)).toThrow(/out of range/);
    expect(() => midiToPitchName(128)).toThrow(/out of range/);
    expect(() => midiToPitchName(1.5)).toThrow();
    expect(isValidMidi(128)).toBe(false);
    expect(isValidMidi(-1)).toBe(false);
  });
});

describe('transposition', () => {
  it('transposes midi within range', () => {
    expect(transposeMidi(60, 7)).toBe(67);
    expect(transposeMidi(60, 0)).toBe(60);
  });
  it('rejects transposition out of range', () => {
    expect(() => transposeMidi(120, 12)).toThrow(/out of range/);
    expect(() => transposeMidi(5, -6)).toThrow(/out of range/);
  });
  it('wraps pitch classes mod 12', () => {
    expect(transposePitchClass('B', 1)).toBe('C');
    expect(transposePitchClass('C', -1)).toBe('B');
    expect(transposePitchClass('E', 5)).toBe('A');
  });
});
