import { describe, expect, it } from 'vitest';
import {
  createResearchSession,
  addEvidence,
  identityKeyOf,
  type SongResearchSession,
} from '../../src/domain/song-research/research-session.js';
import { validateEvidence, isDuplicate } from '../../src/domain/song-research/musical-evidence.js';
import { resolveSongResearch } from '../../src/engines/research/research-resolver.js';
import { parseKey, parseChordSymbol, normalizeSectionLabel, tempoEquivalent, transpositionShift } from '../../src/engines/research/evidence-normalizer.js';
import { domainFamilyOf } from '../../src/domain/song-research/evidence-source.js';
import { AppError } from '../../src/errors/app-error.js';
import { buildResearchSongGraph } from '../../src/engines/research/research-graph.js';
import { buildBaseArrangement } from '../../src/engines/arrangement/build-base-arrangement.js';
import { searchArrangements } from '../../src/engines/arrangement/candidate-search.js';
import { defaultProfile, presetProfile } from '../../src/domain/player/player-profile.js';

function session(): SongResearchSession {
  return createResearchSession({ title: 'Beyaz Skandalım', artist: 'Semicenk' });
}

function submit(s: SongResearchSession, raw: Parameters<typeof validateEvidence>[0]): void {
  addEvidence(s, validateEvidence(raw));
}

describe('normalization', () => {
  it('treats G# major and Ab major as the same key', () => {
    const gs = parseKey('G# major');
    const ab = parseKey('Ab major');
    expect(gs).not.toBeNull();
    expect(ab).not.toBeNull();
    expect(gs!.tonicPitchClass).toBe(ab!.tonicPitchClass);
    expect(parseKey('F#m')!.mode).toBe('MINOR');
    expect(parseKey('key of C#')!.tonicPitchClass).toBe(1);
  });

  it('normalizes chords to sounding harmony through the capo', () => {
    // capo 1: played G Em C D sounds as Ab Fm Db Eb
    const sounding = ['G', 'Em', 'C', 'D'].map((c) => parseChordSymbol(c, 1)!);
    const stated = ['Ab', 'Fm', 'Db', 'Eb'].map((c) => parseChordSymbol(c, 0)!);
    expect(sounding.map((c) => c.rootPc)).toEqual(stated.map((c) => c.rootPc));
    expect(sounding.map((c) => c.family)).toEqual(stated.map((c) => c.family));
  });

  it('parses extensions but keeps the broad family', () => {
    expect(parseChordSymbol('Dbmaj7')!.family).toBe('MAJOR');
    expect(parseChordSymbol('Dbmaj7')!.extension).toBe('maj7');
    expect(parseChordSymbol('Fm7')!.family).toBe('MINOR');
    expect(parseChordSymbol('Ab7')!.family).toBe('SEVENTH');
  });

  it('normalizes section labels', () => {
    expect(normalizeSectionLabel('VERSE 1')).toBe('VERSE');
    expect(normalizeSectionLabel('Pre-Chorus')).toBe('PRE_CHORUS');
    expect(normalizeSectionLabel('PRECHORUS')).toBe('PRE_CHORUS');
  });

  it('detects metrical tempo equivalence and transposition shifts', () => {
    expect(tempoEquivalent(63, 126).equal).toBe(true);
    expect(tempoEquivalent(63, 189).equal).toBe(true);
    expect(tempoEquivalent(63, 100).equal).toBe(false);
    const a = ['G', 'Em', 'C', 'D'].map((c) => parseChordSymbol(c)!);
    const b = ['Ab', 'Fm', 'Db', 'Eb'].map((c) => parseChordSymbol(c)!);
    expect(transpositionShift(a, b)).toBe(1);
  });

  it('groups subdomains into one source family', () => {
    expect(domainFamilyOf('https://tabs.ultimate-guitar.com/tab/x')).toBe('ultimate-guitar.com');
    expect(domainFamilyOf('https://www.ultimate-guitar.com/tab/y')).toBe('ultimate-guitar.com');
  });
});

describe('evidence validation (copyright-size safeguards)', () => {
  it('rejects evidence without a source URL unless submitted by the user', () => {
    expect(() => validateEvidence({ claimType: 'KEY', value: { key: 'Ab' } })).toThrow(/sourceUrl/);
    const user = validateEvidence({ claimType: 'KEY', value: { key: 'Ab' }, submittedBy: 'USER' });
    expect(user.source.domain).toBe('user');
  });

  it('rejects giant chord dumps with EVIDENCE_TOO_LARGE and never stores them', () => {
    const giant = Array.from({ length: 40 }, (_, i) => `C${i}`);
    expect(() => validateEvidence({ claimType: 'CHORD_PROGRESSION', value: { chords: giant }, sourceUrl: 'https://x.example/tab' })).toThrow(
      AppError,
    );
    try {
      validateEvidence({ claimType: 'CHORD_PROGRESSION', value: { chords: giant }, sourceUrl: 'https://x.example/tab' });
    } catch (err) {
      expect((err as AppError).code).toBe('EVIDENCE_TOO_LARGE');
    }
    const lyrics = { chords: ['C'], section: 'x'.repeat(4000) };
    expect(() => validateEvidence({ claimType: 'CHORD_SET', value: lyrics, sourceUrl: 'https://x.example/l' })).toThrow();
  });

  it('deduplicates the same fact from the same URL', () => {
    const a = validateEvidence({ claimType: 'TEMPO', value: { bpm: 63 }, sourceUrl: 'https://a.example/x' });
    const b = validateEvidence({ claimType: 'TEMPO', value: { bpm: 63 }, sourceUrl: 'https://a.example/x' });
    const other = validateEvidence({ claimType: 'TEMPO', value: { bpm: 63 }, sourceUrl: 'https://b.example/x' });
    expect(isDuplicate([a], b)).toBe(true);
    expect(isDuplicate([a], other)).toBe(false);
  });
});

describe('capo consensus (ticket #72)', () => {
  it('Source A sounding harmony and Source B capo-1 shapes strongly agree', () => {
    const s = session();
    submit(s, {
      claimType: 'CHORD_PROGRESSION', value: { section: 'chorus', chords: ['Ab', 'Fm', 'Db', 'Eb'] },
      sourceUrl: 'https://source-a.example/chords', sourceKind: 'MUSIC_ANALYSIS_RESOURCE',
      chordRepresentation: 'SOUNDING_HARMONY',
    });
    submit(s, {
      claimType: 'CHORD_PROGRESSION', value: { section: 'chorus', chords: ['G', 'Em', 'C', 'D'] },
      sourceUrl: 'https://source-b.example/tab', sourceKind: 'CHORD_RESOURCE',
      chordRepresentation: 'PLAYED_GUITAR_SHAPES', capo: 1,
    });
    const r = resolveSongResearch(s);
    expect(r.harmony.sections).toHaveLength(1);
    expect(r.harmony.sections[0]!.chords.map((c) => c.rootPc)).toEqual([8, 5, 1, 3]); // Ab Fm Db Eb
    expect(r.confidence.harmony).toBeGreaterThan(0.8);
    expect(r.conflicts).toHaveLength(0);
  });
});

describe('tempo consensus (ticket #73)', () => {
  it('merges 63/126/63 into one metrical pulse instead of averaging', () => {
    const s = session();
    submit(s, { claimType: 'TEMPO', value: { bpm: 63 }, sourceUrl: 'https://a.example/t', sourceKind: 'MUSIC_ANALYSIS_RESOURCE' });
    submit(s, { claimType: 'TEMPO', value: { bpm: 126 }, sourceUrl: 'https://b.example/t', sourceKind: 'MUSIC_DATABASE' });
    submit(s, { claimType: 'TEMPO', value: { bpm: 63 }, sourceUrl: 'https://c.example/t', sourceKind: 'ARTICLE' });
    submit(s, { claimType: 'METER', value: { numerator: 6, denominator: 8 }, sourceUrl: 'https://a.example/m', sourceKind: 'MUSIC_ANALYSIS_RESOURCE' });
    const r = resolveSongResearch(s);
    expect(r.tempo).toBeDefined();
    expect(r.tempo!.practiceOrMetricBpm).toBe(63);
    expect(r.tempo!.relatedReportedBpms.map((x) => x.bpm)).toContain(126);
    expect(r.tempo!.explanation).toMatch(/double-time/);
    // NOT the average (84)
    expect(r.tempo!.practiceOrMetricBpm).not.toBe(84);
  });
});

describe('source duplicates (ticket #74)', () => {
  it('three pages on one domain count as one independent source', () => {
    const s = session();
    for (const path of ['/1', '/2', '/3']) {
      submit(s, {
        claimType: 'CHORD_PROGRESSION', value: { section: 'chorus', chords: ['Ab', 'Fm', 'Db', 'Eb'] },
        sourceUrl: `https://same.example${path}`, sourceKind: 'CHORD_RESOURCE',
      });
    }
    const r = resolveSongResearch(s);
    // one family: noisy-or of a single prior, never multi-source certainty
    expect(r.confidence.harmony).toBeLessThan(0.75);
    expect(r.status).toBe('NEEDS_MORE_EVIDENCE');
  });
});

describe('conflict (ticket #75)', () => {
  it('disagreeing keys from independent sources block readiness', () => {
    const s = session();
    submit(s, { claimType: 'KEY', value: { key: 'C major' }, sourceUrl: 'https://a.example/k', sourceKind: 'MUSIC_ANALYSIS_RESOURCE' });
    submit(s, { claimType: 'KEY', value: { key: 'Ab major' }, sourceUrl: 'https://b.example/k', sourceKind: 'MUSIC_DATABASE' });
    const r = resolveSongResearch(s);
    expect(r.conflicts.some((c) => c.field === 'key')).toBe(true);
    expect(r.status).toBe('NEEDS_MORE_EVIDENCE');
  });
});

describe('readiness + research graph through the compiler (tickets #76/#77)', () => {
  it('full multi-source research resolves, builds a SECTION_ONLY graph, and compiles', () => {
    const s = session();
    // MusicBrainz-style identity
    submit(s, {
      claimType: 'IDENTITY', value: { title: 'Beyaz Skandalım', artist: 'Semicenk', musicBrainzRecordingId: 'mb-1' },
      sourceUrl: 'https://musicbrainz.org/recording/mb-1', sourceKind: 'MUSIC_DATABASE', submittedBy: 'SYSTEM_PROVIDER',
    });
    submit(s, { claimType: 'KEY', value: { key: 'Ab major' }, sourceUrl: 'https://a.example/k', sourceKind: 'MUSIC_ANALYSIS_RESOURCE' });
    submit(s, { claimType: 'TEMPO', value: { bpm: 63 }, sourceUrl: 'https://a.example/t', sourceKind: 'MUSIC_ANALYSIS_RESOURCE' });
    submit(s, { claimType: 'TEMPO', value: { bpm: 126 }, sourceUrl: 'https://b.example/t', sourceKind: 'MUSIC_DATABASE' });
    submit(s, { claimType: 'METER', value: { numerator: 6, denominator: 8 }, sourceUrl: 'https://a.example/m', sourceKind: 'MUSIC_ANALYSIS_RESOURCE' });
    submit(s, {
      claimType: 'CHORD_PROGRESSION', value: { section: 'chorus', chords: ['Ab', 'Fm', 'Db', 'Eb'] },
      sourceUrl: 'https://a.example/c', sourceKind: 'MUSIC_ANALYSIS_RESOURCE', chordRepresentation: 'SOUNDING_HARMONY',
    });
    submit(s, {
      claimType: 'CHORD_PROGRESSION', value: { section: 'chorus', chords: ['G', 'Em', 'C', 'D'] },
      sourceUrl: 'https://chords-hub.example/tab', sourceKind: 'CHORD_RESOURCE',
      chordRepresentation: 'PLAYED_GUITAR_SHAPES', capo: 1,
    });
    submit(s, { claimType: 'SECTION', value: { name: 'chorus' }, sourceUrl: 'https://a.example/s', sourceKind: 'MUSIC_ANALYSIS_RESOURCE' });

    const r = resolveSongResearch(s);
    expect(['READY', 'READY_WITH_WARNINGS']).toContain(r.status);
    expect(r.confidence.harmony).toBeGreaterThan(0.8);
    expect(r.key?.display).toMatch(/^(G#|Ab) major$/);

    const { graph, warnings } = buildResearchSongGraph('research_test', r, { title: 'Beyaz Skandalım', artist: 'Semicenk' });
    expect(graph.timingPrecision).toBe('SECTION_ONLY');
    expect(graph.provenance?.origin).toBe('RESEARCH_FUSION');
    expect(graph.provenance?.fieldProvenance?.harmony?.origin).toBe('WEB_RESEARCH');
    expect(graph.global.key).toMatch(/^(G#|Ab) major$/);
    expect(graph.sections.map((x) => x.type)).toContain('CHORUS');

    // the UNCHANGED compiler accepts it end to end
    const profile = defaultProfile('BEGINNER');
    const base = buildBaseArrangement(graph);
    expect(base.chords.length).toBeGreaterThan(0);
    const candidates = searchArrangements(base, graph, profile, { beamWidth: 4, maxDepth: 2, maxCandidates: 20 });
    expect(candidates.length).toBeGreaterThan(0);
    expect(warnings.length).toBeGreaterThanOrEqual(0);
    // player preset scoring also works on the research graph
    expect(presetProfile('BEGINNER').knownChords).toBeDefined();
    expect(identityKeyOf({ title: 'Beyaz Skandalım', artist: 'Semicenk' })).toBe(
      identityKeyOf({ title: 'beyaz  skandalim', artist: 'SEMICENK' }),
    );
  });
});
