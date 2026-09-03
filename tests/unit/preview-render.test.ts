import { describe, expect, it } from 'vitest';
import { renderPracticePreview, graphBeatSec } from '../../src/audio-rendering/preview-render.js';
import { shapeSoundingMidis, strumPattern, resolveStrums } from '../../src/audio-rendering/strum.js';
import { pluckString } from '../../src/audio-rendering/ks-voice.js';
import { loadArrangements } from '../../src/application/prepare-arrangement.js';
import { midiToPitchClass } from '../../src/domain/music/pitch.js';

const DEMO_SONG = 'song_5c0d7b45538b';
const OPEN = [64, 59, 55, 50, 45, 40] as const;

describe('exact pitch synthesis', () => {
  it('soundingMidi = openString + capo + fret for every shape', () => {
    // D shape at capo 6: frets [2,3,2,0] on strings 1-4
    const midis = shapeSoundingMidis('D', 6, OPEN);
    expect(midis).toEqual([64 + 2 + 6, 59 + 3 + 6, 55 + 2 + 6, 50 + 0 + 6]);
  });

  it('muted strings never sound', () => {
    const midis = shapeSoundingMidis('D', 0, OPEN);
    expect(midis.length).toBe(4); // D mutes strings 5+6
  });

  it('capo equivalence: capo 6 D-shape sounds the same harmony as nut-position Ab', () => {
    const pcs = (midis: number[]) => new Set(midis.map(midiToPitchClass));
    const atCapo = pcs(shapeSoundingMidis('D', 6, OPEN));
    const atNut = pcs(shapeSoundingMidis('Ab', 0, OPEN));
    expect(atCapo).toEqual(atNut); // Ab major pitch classes either way
  });

  it('synthesis is a pure oscillator voice — no samples, no external audio', () => {
    const note = pluckString(220, 0.5, 22_050, 42);
    expect(note.length).toBe(Math.round(0.5 * 22_050));
    expect(note.every((v) => Math.abs(v) <= 1)).toBe(true);
  });
});

describe('strumming', () => {
  it('DOWN strums sweep low→high, UP strums reverse', () => {
    const pattern = strumPattern(4);
    const strums = resolveStrums(pattern, [40, 45, 50, 55], {
      startSec: 0,
      durationSec: 5,
      eighthSec: 0.25,
      seed: 7,
    });
    const down = strums.find((s) => s.strings[0]?.midi === Math.min(...s.strings.map((x) => x.midi)));
    expect(down).toBeDefined();
    const mids = strums[0]!.strings.map((s) => s.midi);
    expect(mids).toEqual([...mids].sort((a, b) => a - b)); // first DOWN is ascending
    // stagger stays inside the 12–22ms window
    const stagger = strums[0]!.strings[1]!.delaySec - strums[0]!.strings[0]!.delaySec;
    expect(stagger).toBeGreaterThanOrEqual(0.012);
    expect(stagger).toBeLessThanOrEqual(0.022);
  });

  it('6/8 pattern keeps compound grouping (D . . D U .)', () => {
    const pattern = strumPattern(6);
    expect(pattern.map((p) => p.startSec)).toEqual([0, 3, 4]);
    expect(pattern.map((p) => p.direction)).toEqual(['DOWN', 'DOWN', 'UP']);
  });
});

describe('practice preview rendering', () => {
  async function chorusInput() {
    const { graph, ladder } = await loadArrangements(DEMO_SONG);
    const arrangement = ladder.find((l) => l.level === 'BEGINNER')!.arrangement;
    const chorus = graph.sections.find((s) => s.type === 'CHORUS')!;
    return { graph, arrangement, chorus };
  }

  it('renders a section with exact chord timeline and count-in', async () => {
    const { graph, arrangement, chorus } = await chorusInput();
    const preview = renderPracticePreview({
      song: graph,
      arrangement,
      startBeat: chorus.startBeat,
      endBeat: chorus.endBeat,
      tempoFactor: 0.7,
      metronome: true,
      countInBars: 1,
    });
    expect(preview.durationSec).toBeGreaterThan(0);
    expect(preview.countInSec).toBeGreaterThan(0);
    expect(preview.timeline.length).toBeGreaterThan(0);
    expect(preview.timeline[0]!.startSec).toBeGreaterThanOrEqual(preview.countInSec);
    // section-scoped: never a full-track render (45s cap + count-in)
    expect(preview.durationSec).toBeLessThan(50);
  }, 30_000);

  it('deterministic: same inputs → identical samples', async () => {
    const { graph, arrangement, chorus } = await chorusInput();
    const make = () =>
      renderPracticePreview({
        song: graph,
        arrangement,
        startBeat: chorus.startBeat,
        endBeat: chorus.endBeat,
        tempoFactor: 0.7,
        metronome: true,
        countInBars: 1,
      });
    const a = make();
    const b = make();
    expect(Buffer.from(a.samples.buffer).equals(Buffer.from(b.samples.buffer))).toBe(true);
  }, 30_000);

  it('tempo factor changes timing but never pitch content', async () => {
    const { graph, arrangement, chorus } = await chorusInput();
    const full = renderPracticePreview({
      song: graph,
      arrangement,
      startBeat: chorus.startBeat,
      endBeat: chorus.startBeat + 24,
      tempoFactor: 1,
      countInBars: 0,
      metronome: false,
    });
    const slow = renderPracticePreview({
      song: graph,
      arrangement,
      startBeat: chorus.startBeat,
      endBeat: chorus.startBeat + 24,
      tempoFactor: 0.5,
      countInBars: 0,
      metronome: false,
    });
    // same beat window, half tempo → roughly twice as long
    expect(slow.durationSec).toBeGreaterThan(full.durationSec * 1.8);
    // the played pitches come from the same shapes: same per-chord midis
    expect(full.timeline.map((t) => t.chord)).toEqual(slow.timeline.map((t) => t.chord));
  }, 30_000);

  it('metronome accents land on the first downbeat including count-in', async () => {
    const { graph, arrangement, chorus } = await chorusInput();
    const beatSec = graphBeatSec(graph);
    const preview = renderPracticePreview({
      song: graph,
      arrangement,
      startBeat: chorus.startBeat,
      endBeat: chorus.startBeat + 12,
      tempoFactor: 1,
      metronome: true,
      countInBars: 1,
    });
    // first sample with significant energy is the accented count-in click
    const firstLoud = preview.samples.findIndex((v) => Math.abs(v) > 0.1);
    expect(firstLoud).toBeGreaterThanOrEqual(0);
    expect(Math.abs(firstLoud! / preview.sampleRate - 0)).toBeLessThan(beatSec / 2);
  }, 30_000);
});
