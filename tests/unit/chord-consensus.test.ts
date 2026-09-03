import { describe, expect, it } from 'vitest';
import { resolveChords } from '../../src/engines/analysis-consensus/chord-consensus.js';
import type { ChordAnalysisResult } from '../../src/domain/analysis/raw-music-analysis.js';

const beatTimes = Array.from({ length: 16 }, (_, i) => i * 0.5);
const seg = (start: number, end: number, label: string) => ({ startSeconds: start, endSeconds: end, label, confidence: 1 });

const timeline = (provider: string, segments: ReturnType<typeof seg>[], audioVariant = 'FULL_MIX'): ChordAnalysisResult => ({
  provider,
  vocabulary: 'majmin',
  audioVariant: audioVariant as never,
  segments,
});

describe('resolveChords', () => {
  it('follows provider agreement, not blind majority', () => {
    // essentia (weak confidence) dissents; two learned providers agree
    const timelines = [
      timeline('essentia', [seg(0, 6, 'C')]),
      timeline('deepchroma', [seg(0, 3, 'C'), seg(3, 6, 'G')]),
      timeline('cnn-crf', [seg(0, 3, 'C'), seg(3, 6, 'G')]),
    ];
    const out = resolveChords({ timelines, beatTimes, key: { root: 'C', scale: 'major' } });
    expect(out.chords.map((c) => c.root)).toEqual(['C', 'G']);
    expect(out.chords[0]!.startBeat).toBe(0);
    expect(out.chords[1]!.startBeat).toBe(6);
  });

  it('uses key compatibility as a tie-breaking prior, never a hard rule', () => {
    // one provider claims a non-diatonic Bb over a diatonic C region:
    // stronger weight wins regardless; equal-weight tie -> diatonic wins
    const diatonicFirst = resolveChords({
      timelines: [
        timeline('a', [seg(0, 3, 'C'), seg(3, 6, 'Bb')]),
        timeline('b', [seg(0, 3, 'C'), seg(3, 6, 'C')]),
      ],
      beatTimes,
      key: { root: 'C', scale: 'major' },
    });
    // the tie in the second region resolves to the diatonic C, and the whole
    // timeline therefore merges into a single C segment
    expect(diatonicFirst.chords.map((c) => c.root)).toEqual(['C']);

    // non-diatonic with full agreement is preserved (borrowed chords exist)
    const borrowed = resolveChords({
      timelines: [
        timeline('a', [seg(3, 6, 'Bb')]),
        timeline('b', [seg(3, 6, 'Bb')]),
      ],
      beatTimes,
      key: { root: 'C', scale: 'major' },
    });
    expect(borrowed.chords.map((c) => c.root)).toEqual(['A#']); // normalized spelling
  });

  it('absorbs short glitch segments but retains unanimous short chords', () => {
    // deepchroma briefly glitches to Dm mid-G; cnn-crf never does
    const glitched = resolveChords({
      timelines: [
        timeline('essentia', [seg(0, 3, 'G')]),
        timeline('deepchroma', [seg(0, 1, 'G'), seg(1, 1.5, 'Dm'), seg(1.5, 3, 'G')]),
      ],
      beatTimes,
      key: { root: 'C', scale: 'major' },
      config: { minimumChordDurationBeats: 2 },
    });
    expect(glitched.chords.map((c) => c.root)).toEqual(['G']);

    // both providers agree on a one-beat chord -> retained
    const unanimous = resolveChords({
      timelines: [
        timeline('deepchroma', [seg(2, 2.5, 'F')]),
        timeline('cnn-crf', [seg(2, 2.5, 'F')]),
      ],
      beatTimes,
      key: { root: 'C', scale: 'major' },
      config: { minimumChordDurationBeats: 2 },
    });
    expect(unanimous.chords.map((c) => c.root)).toEqual(['F']);
  });

  it('records per-segment votes so chord beliefs are debuggable', () => {
    const out = resolveChords({
      timelines: [
        timeline('deepchroma', [seg(0, 3, 'C:maj')]),
        timeline('cnn-crf', [seg(0, 3, 'C')]),
      ],
      beatTimes,
    });
    const providers = [...new Set(out.segments[0]!.votes.map((v) => v.provider))].sort();
    expect(providers).toEqual(['cnn-crf', 'deepchroma']);
    expect(out.segments[0]!.votes.some((v) => v.label === 'C:maj')).toBe(true);
  });

  it('normalizes madmom labels (C:maj / A:min / N) through the domain layer', () => {
    const out = resolveChords({
      timelines: [timeline('deepchroma', [seg(0, 1.5, 'C:maj'), seg(1.5, 3, 'A:min'), seg(3, 4, 'N')])],
      beatTimes,
    });
    expect(out.chords.map((c) => `${c.root}:${c.quality}`)).toEqual(['C:major', 'A:minor']);
  });

  it('splits chords on the resolved beat grid, not raw seconds', () => {
    const out = resolveChords({
      timelines: [timeline('deepchroma', [seg(0.1, 5.9, 'C')])],
      beatTimes,
    });
    expect(out.chords[0]!.startBeat).toBe(0);
    expect(out.chords[0]!.startBeat + out.chords[0]!.durationBeats).toBeLessThanOrEqual(beatTimes.length);
  });
});
