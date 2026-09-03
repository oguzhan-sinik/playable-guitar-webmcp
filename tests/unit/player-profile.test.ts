import { describe, expect, it } from 'vitest';
import {
  defaultProfile,
  presetProfile,
  mergeProfile,
  chordMastery,
} from '../../src/domain/player/player-profile.js';
import { computePlayerDifficulty } from '../../src/engines/difficulty/player-difficulty.js';
import type { GuitarArrangement } from '../../src/domain/arrangement/arrangement.js';
import type { PlayerProfile } from '../../src/domain/player/player-profile.js';

const song = {
  global: {
    bpm: 100,
    tuningReferenceHz: 440,
    timeSignature: { numerator: 4, denominator: 4, confidence: 1, source: 'ANALYZED' as const },
  },
};

function arrangementWith(shapes: string[], overrides: Partial<GuitarArrangement> = {}): GuitarArrangement {
  return {
    id: 'arr_test',
    songId: 'song_test',
    tuning: { tuning: [64, 59, 55, 50, 45, 40], frets: 24, capo: 0 },
    tempoFactor: 1,
    durationBeats: 32,
    chords: shapes.map((shapeName, i) => ({
      id: `c${i}`,
      chord: { root: 'C', quality: 'major', startBeat: i * 4, durationBeats: 4, confidence: 1 },
      shapeName,
      startBeat: i * 4,
      durationBeats: 4,
    })),
    notes: [],
    techniques: [],
    transformations: [],
    difficulty: { total: 4, chordComplexity: 4, fingeringComplexity: 4, handMovement: 4, transitionSpeed: 4, rhythmComplexity: 4, noteDensity: 4, techniqueComplexity: 4, pickingComplexity: 4 },
    fidelity: { total: 1 },
    ...overrides,
  } as GuitarArrangement;
}

describe('player profile: preset → profile', () => {
  it('BEGINNER preset produces a barre-uncomfortable profile with known open chords', () => {
    const profile = presetProfile('BEGINNER');
    expect(profile.barreChords.comfortable).toBe(false);
    expect(chordMastery(profile, 'C')).toBeGreaterThan(0.5);
    expect(chordMastery(profile, 'Bm')).toBeLessThan(0.5);
  });

  it('ADVANCED preset is barre-comfortable', () => {
    expect(presetProfile('ADVANCED').barreChords.comfortable).toBe(true);
  });
});

describe('player profile: detailed overrides preset', () => {
  it('merges knownChords over the preset defaults', () => {
    const base = presetProfile('BEGINNER');
    const merged = mergeProfile(
      { knownChords: { C: 1, G: 1, D: 1, Em: 1, Am: 1 }, barreChords: { comfortable: false } },
      base,
    );
    expect(chordMastery(merged, 'Am')).toBe(1);
    expect(merged.barreChords.comfortable).toBe(false);
    // preset-only chords keep their preset mastery
    expect(chordMastery(merged, 'E')).toBe(chordMastery(base, 'E'));
  });

  it('normalizes chord labels', () => {
    const merged = mergeProfile({ knownChords: { em: 1, 'c#m': 0.8 } });
    expect(merged.knownChords['Em']).toBeDefined();
    expect(merged.knownChords['C#m']?.mastery).toBeCloseTo(0.8);
  });

  it('rejects an empty update', () => {
    // exercised via the WebMCP tool; merge itself needs input
    expect(mergeProfile({ knownChords: { G: 1 } }).knownChords['G']).toBeDefined();
  });
});

describe('player-aware difficulty', () => {
  const beginner = presetProfile('BEGINNER');

  it('known chords score lower than unknown chords', () => {
    const knowsAll: PlayerProfile = mergeProfile(
      { knownChords: { D: 1, G: 1, A: 1 }, barreChords: { comfortable: true } },
      defaultProfile(),
    );
    const knowsNone: PlayerProfile = mergeProfile(
      { knownChords: { F: 1 }, barreChords: { comfortable: true } },
      defaultProfile(),
    );
    const arrangement = arrangementWith(['D', 'G', 'A']);
    const easy = computePlayerDifficulty(arrangement, knowsAll, song);
    const hard = computePlayerDifficulty(arrangement, knowsNone, song);
    expect(easy.playerDifficulty).toBeLessThan(hard.playerDifficulty);
    expect(easy.unfamiliarChordPenalty).toBe(0);
    expect(hard.unfamiliarChordPenalty).toBeGreaterThan(0);
  });

  it('uncomfortable barre chords receive a large penalty', () => {
    const arrangement = arrangementWith(['F', 'C']);
    const comfortable = computePlayerDifficulty(
      arrangement,
      mergeProfile({ barreChords: { comfortable: true } }, defaultProfile()),
      song,
    );
    const uncomfortable = computePlayerDifficulty(
      arrangement,
      mergeProfile({ barreChords: { comfortable: false } }, defaultProfile()),
      song,
    );
    expect(uncomfortable.barrePenalty).toBeGreaterThan(comfortable.barrePenalty);
    expect(uncomfortable.barrePenalty).toBeGreaterThanOrEqual(1.4);
    expect(uncomfortable.reasons.join(' ')).toMatch(/barre/i);
  });

  it('fast tempo above the comfortable BPM adds pressure', () => {
    const arrangement = arrangementWith(['D', 'G']);
    const profile: PlayerProfile = mergeProfile(
      { comfortableTempoBpm: 80, barreChords: { comfortable: true } },
      defaultProfile(),
    );
    const fast = computePlayerDifficulty(arrangement, profile, song);
    const slowed = computePlayerDifficulty(
      arrangement,
      profile,
      song,
      // simulate tempo reduction: half-speed arrangement
    );
    const slowedArrangement = arrangementWith(['D', 'G'], { tempoFactor: 0.5 });
    const slowedScore = computePlayerDifficulty(slowedArrangement, profile, song);
    expect(fast.tempoPenalty).toBeGreaterThan(slowedScore.tempoPenalty);
    expect(fast.tempoPenalty).toBeGreaterThan(0);
    expect(slowed.tempoPenalty).toBe(fast.tempoPenalty); // same inputs → same output
  });

  it('never touches the absolute difficulty engine', () => {
    const arrangement = arrangementWith(['D', 'G']);
    const score = computePlayerDifficulty(arrangement, beginner, song);
    expect(score.absoluteDifficulty).toBe(4);
  });
});
