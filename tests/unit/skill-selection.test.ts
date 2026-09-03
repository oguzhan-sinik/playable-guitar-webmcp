import { describe, expect, it } from 'vitest';
import { buildArrangementLadder, selectForSkill } from '../../src/engines/arrangement/skill-selection.js';
import { SKILL_PRESETS } from '../../src/domain/skill/skill-preset.js';
import { DEFAULT_GUITAR } from '../../src/domain/guitar/tuning.js';
import type { GuitarArrangement } from '../../src/domain/arrangement/arrangement.js';
import type { DifficultyScore } from '../../src/domain/arrangement/difficulty.js';
import type { FidelityScore } from '../../src/domain/arrangement/fidelity.js';

const diff = (total: number): DifficultyScore => ({
  total,
  chordComplexity: total,
  fingeringComplexity: total,
  handMovement: total,
  transitionSpeed: total,
  rhythmComplexity: total,
  noteDensity: total,
  techniqueComplexity: total,
  pickingComplexity: total,
});

const fid = (): FidelityScore => ({
  total: 1,
  harmony: 1,
  melody: 1,
  rhythm: 1,
  motifCoverage: 1,
  structure: 1,
});

const arr = (difficulty: number, capo = 0, shapeName = 'C'): GuitarArrangement => ({
  id: `a_${difficulty}`,
  songId: 'song_test00000001',
  tuning: { ...DEFAULT_GUITAR, capo },
  tempoFactor: 1,
  durationBeats: 16,
  chords: [{
    id: 'c1',
    startBeat: 0,
    durationBeats: 4,
    shapeName,
    chord: { startBeat: 0, durationBeats: 4, root: 'C', quality: 'major', confidence: 1 },
  }],
  notes: [],
  techniques: [],
  transformations: [],
  difficulty: diff(difficulty),
  fidelity: fid(),
});

describe('skill selection', () => {
  it('beginner picks lowest difficulty under target', () => {
    const candidates = [arr(4.5), arr(2.8, 6), arr(3.5, 3)];
    const picked = selectForSkill(candidates, SKILL_PRESETS.BEGINNER);
    expect(picked?.difficulty?.total).toBe(2.8);
  });

  it('builds a three-level ladder', () => {
    const base = arr(4.5, 0, 'F');
    const candidates = [arr(2.8, 6), arr(3.8, 1), arr(4.5, 0, 'F')];
    const ladder = buildArrangementLadder(candidates, base);
    expect(ladder).toHaveLength(3);
    expect(ladder.map((l) => l.level)).toEqual(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
  });
});
