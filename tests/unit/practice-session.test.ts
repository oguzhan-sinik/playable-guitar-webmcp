import { describe, expect, it } from 'vitest';
import { buildPracticeSession } from '../../src/domain/practice/practice-session.js';
import { clampTempoFactor, TEMPO_STEPS } from '../../src/domain/practice/practice-tempo.js';
import { presetProfile } from '../../src/domain/player/player-profile.js';
import type { GuitarArrangement } from '../../src/domain/arrangement/arrangement.js';
import type { SongGraph } from '../../src/domain/music/song-graph.js';

const profile = presetProfile('BEGINNER');

const arrangement = {
  id: 'arr_test',
  songId: 'song_test',
  tuning: { tuning: [64, 59, 55, 50, 45, 40], frets: 24, capo: 6 },
  tempoFactor: 0.7,
  durationBeats: 64,
  chords: ['D', 'G', 'A', 'D', 'G', 'A'].map((shapeName, i) => ({
    id: `c${i}`,
    chord: { root: 'C', quality: 'major', startBeat: i * 8, durationBeats: 8, confidence: 1 },
    shapeName,
    startBeat: i * 8,
    durationBeats: 8,
  })),
  notes: [],
  techniques: [],
  transformations: [],
} as unknown as GuitarArrangement;

const song = {
  id: 'song_test',
  global: {
    bpm: 63,
    tuningReferenceHz: 440,
    timeSignature: { numerator: 6, denominator: 8, confidence: 1, source: 'ANALYZED' as const },
  },
} as Pick<SongGraph, 'id' | 'global'>;

const section = { type: 'CHORUS', index: 2 };

describe('practice session builder', () => {
  it('builds for a valid section and fills the requested minutes', () => {
    const session = buildPracticeSession({ song, arrangement, profile, section, minutes: 20 });
    expect(session.sectionId).toBe('CHORUS_2');
    const total = session.steps.reduce((sum, s) => sum + s.minutes, 0);
    expect(total).toBe(20);
  });

  it('keeps the session tempo and records loop state', () => {
    const session = buildPracticeSession({ song, arrangement, profile, section, minutes: 20, tempoFactor: 0.7, loopEnabled: true });
    expect(session.tempoFactor).toBe(0.7);
    expect(session.loopEnabled).toBe(true);
    expect(session.countInBars).toBe(1);
    expect(session.metronomeEnabled).toBe(true);
  });

  it('builds a tempo ladder that ends at the session tempo', () => {
    const session = buildPracticeSession({ song, arrangement, profile, section, minutes: 20, tempoFactor: 0.7 });
    const loopSteps = session.steps.filter((s) => s.kind === 'loop-section');
    const fullRun = session.steps.find((s) => s.kind === 'full-run');
    expect(loopSteps.length).toBeGreaterThanOrEqual(2);
    // loops progress upward and never exceed the final run
    const tempos = loopSteps.map((s) => s.tempoFactor ?? 0);
    expect(tempos[0]!).toBeLessThan(tempos[1]!);
    expect(tempos.every((t) => t <= (fullRun?.tempoFactor ?? 1) + 0.001)).toBe(true);
    expect(fullRun?.tempoFactor).toBe(0.7);
  });

  it('teaches unknown chords before transitions', () => {
    const session = buildPracticeSession({ song, arrangement, profile, section, minutes: 20 });
    expect(session.steps[0]!.kind).toBe('learn-chords');
    expect(session.steps.some((s) => s.kind === 'learn-transition')).toBe(true);
  });

  it('clamps tempo factors into the supported range', () => {
    expect(clampTempoFactor(2)).toBe(1);
    expect(clampTempoFactor(0.1)).toBe(0.5);
    expect(clampTempoFactor(undefined, 0.7)).toBe(0.7);
    expect(TEMPO_STEPS).toContain(0.7);
  });
});
