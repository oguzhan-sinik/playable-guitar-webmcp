import { describe, expect, it } from 'vitest';
import {
  mapSectionLabel,
  buildBeatGrid,
  inferMeter,
  sectionsFromSegments,
  DEFAULT_SECTION_IMPORTANCE,
} from '../../src/engines/songgraph/resolve-analysis.js';
import type { RhythmStructureAnalysis } from '../../src/domain/analysis/raw-music-analysis.js';

describe('mapSectionLabel', () => {
  it('maps All-In-One labels into SectionType', () => {
    expect(mapSectionLabel('intro')).toBe('INTRO');
    expect(mapSectionLabel('verse')).toBe('VERSE');
    expect(mapSectionLabel('chorus')).toBe('CHORUS');
    expect(mapSectionLabel('bridge')).toBe('BRIDGE');
    expect(mapSectionLabel('solo')).toBe('SOLO');
    expect(mapSectionLabel('break')).toBe('BREAKDOWN');
    expect(mapSectionLabel('outro')).toBe('OUTRO');
  });
  it('maps unknown labels to UNKNOWN, never invents sections', () => {
    expect(mapSectionLabel('inst')).toBe('UNKNOWN');
    expect(mapSectionLabel('weird-label')).toBe('UNKNOWN');
  });
});

describe('section importance', () => {
  it('ranks chorus high and unknown low (teach the chorus first)', () => {
    expect(DEFAULT_SECTION_IMPORTANCE.CHORUS).toBeGreaterThan(DEFAULT_SECTION_IMPORTANCE.VERSE);
    expect(DEFAULT_SECTION_IMPORTANCE.VERSE).toBeGreaterThan(DEFAULT_SECTION_IMPORTANCE.INTRO);
    expect(DEFAULT_SECTION_IMPORTANCE.UNKNOWN).toBeLessThan(DEFAULT_SECTION_IMPORTANCE.INTRO);
  });
});

describe('buildBeatGrid', () => {
  const rhythm: RhythmStructureAnalysis = {
    provider: 'all-in-one',
    beats: [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5],
    downbeats: [0, 2.0],
    beatPositions: [1, 2, 3, 4, 1, 2, 3, 4],
  };

  it('marks real model-predicted downbeats, matched to the grid', () => {
    const beats = buildBeatGrid(rhythm, 10);
    expect(beats.map((b) => b.isDownbeat)).toEqual([true, false, false, false, true, false, false, false]);
  });
  it('keeps positionInBar from the model', () => {
    const beats = buildBeatGrid(rhythm, 10);
    expect(beats[1]!.positionInBar).toBe(2);
    expect(beats[4]!.positionInBar).toBe(1);
  });
  it('falls back to only-beat-0 downbeat when the model has none', () => {
    const beats = buildBeatGrid({ provider: 'x', beats: rhythm.beats }, 10);
    expect(beats.filter((b) => b.isDownbeat).map((b) => b.beat)).toEqual([0]);
  });
});

describe('inferMeter', () => {
  it('derives 4/4-like meter from 1 2 3 4 repetition', () => {
    const meter = inferMeter({
      provider: 'x',
      beats: Array.from({ length: 16 }, (_, i) => i * 0.5),
      beatPositions: [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4],
    });
    expect(meter).toMatchObject({ numerator: 4, source: 'ANALYZED' });
    expect(meter.confidence).toBeGreaterThan(0.5);
  });
  it('derives 3-like grouping from 1 2 3', () => {
    const meter = inferMeter({
      provider: 'x',
      beatPositions: [1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3],
    });
    expect(meter.numerator).toBe(3);
  });
  it('falls back to DEFAULT 4/4 without position data', () => {
    expect(inferMeter({ provider: 'x' })).toMatchObject({
      numerator: 4,
      denominator: 4,
      source: 'DEFAULT',
    });
  });
});

describe('sectionsFromSegments', () => {
  const beats = Array.from({ length: 32 }, (_, i) => ({
    beat: i,
    timeMs: i * 500,
    isDownbeat: i % 4 === 0,
  }));
  it('converts seconds-based labeled segments into beat sections', () => {
    const sections = sectionsFromSegments(
      [
        { start: 0, end: 4, label: 'intro' },
        { start: 4, end: 12, label: 'chorus' },
        { start: 12, end: 16, label: 'verse' },
      ],
      beats,
    );
    expect(sections.map((s) => s.type)).toEqual(['INTRO', 'CHORUS', 'VERSE']);
    expect(sections[1]!.startBeat).toBe(8);
    expect(sections[1]!.importance).toBe(DEFAULT_SECTION_IMPORTANCE.CHORUS);
    expect(sections[1]!.confidence).toBeLessThan(1); // model output, not truth
  });
  it('falls back to a single UNKNOWN section without segments', () => {
    const sections = sectionsFromSegments([], beats);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.type).toBe('UNKNOWN');
    expect(sections[0]!.confidence).toBeLessThanOrEqual(0.3);
  });
});
