import { describe, expect, it } from 'vitest';
import { normalizePitchClass, normalizeChordLabel, NO_CHORD } from '../../src/domain/music/normalize.js';
import { AppError } from '../../src/errors/app-error.js';

describe('normalizePitchClass', () => {
  it('passes through sharp-spelled pitch classes', () => {
    expect(normalizePitchClass('C')).toBe('C');
    expect(normalizePitchClass('G#')).toBe('G#');
    expect(normalizePitchClass('A#')).toBe('A#');
  });
  it('normalizes flats to sharps (enharmonic equivalence)', () => {
    expect(normalizePitchClass('Bb')).toBe('A#');
    expect(normalizePitchClass('Eb')).toBe('D#');
    expect(normalizePitchClass('Ab')).toBe('G#');
    expect(normalizePitchClass('Db')).toBe('C#');
    expect(normalizePitchClass('Gb')).toBe('F#');
  });
  it('is case-insensitive on the letter', () => {
    expect(normalizePitchClass('ab')).toBe('G#');
    expect(normalizePitchClass('g#')).toBe('G#');
  });
  it('rejects garbage', () => {
    expect(() => normalizePitchClass('H')).toThrow(AppError);
    expect(() => normalizePitchClass('')).toThrow(AppError);
  });
});

describe('normalizeChordLabel', () => {
  it('parses major and minor triads', () => {
    expect(normalizeChordLabel('C')).toEqual({ root: 'C', quality: 'major' });
    expect(normalizeChordLabel('G#m')).toEqual({ root: 'G#', quality: 'minor' });
    expect(normalizeChordLabel('A#m')).toEqual({ root: 'A#', quality: 'minor' });
  });
  it('normalizes enharmonic roots', () => {
    expect(normalizeChordLabel('Bbm')).toEqual({ root: 'A#', quality: 'minor' });
    expect(normalizeChordLabel('Ab')).toEqual({ root: 'G#', quality: 'major' });
    expect(normalizeChordLabel('Db')).toEqual({ root: 'C#', quality: 'major' });
  });
  it('degrades richer labels to the triad only for known aliases', () => {
    expect(normalizeChordLabel('Cmin')).toEqual({ root: 'C', quality: 'minor' });
    // not hallucinating qualities we did not ask the provider for
    expect(normalizeChordLabel('Cmaj7')).toBeNull();
    expect(normalizeChordLabel('Csus4')).toBeNull();
  });
  it('maps NO_CHORD and junk to null (never a guessed chord)', () => {
    expect(normalizeChordLabel(NO_CHORD)).toBeNull();
    expect(normalizeChordLabel('no chord')).toBeNull();
    expect(normalizeChordLabel('')).toBeNull();
    expect(normalizeChordLabel('Xyz')).toBeNull();
  });
});
