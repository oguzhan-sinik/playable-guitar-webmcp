import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSongRequest } from '../../src/domain/song-request/song-request.js';
import { validateEvidence, isDuplicate, type MusicalEvidence } from '../../src/domain/song-research/musical-evidence.js';
import { createResearchSession, addEvidence } from '../../src/domain/song-research/research-session.js';
import { resolveSongResearch } from '../../src/engines/research/research-resolver.js';
import { buildResearchSongGraph } from '../../src/engines/research/research-graph.js';
import {
  requestSong,
  submitSongEvidence,
  getResearchBrief,
  getSongBlueprint,
  validateSongBlueprint,
} from '../../src/application/research-song.js';

function session(): ReturnType<typeof createResearchSession> {
  return createResearchSession({ title: 'Test Song', artist: 'The Fixtures' });
}

function submit(s: ReturnType<typeof createResearchSession>, raw: Parameters<typeof validateEvidence>[0]): boolean {
  return addEvidence(s, validateEvidence(raw));
}

describe('song request domain', () => {
  it('parses "Song by Artist" free-text queries', () => {
    const request = createSongRequest({ query: 'Night Drive by The Analog Hearts' });
    expect(request.identity.title).toBe('Night Drive');
    expect(request.identity.artist).toBe('The Analog Hearts');
  });

  it('rejects an empty request', () => {
    expect(() => createSongRequest({})).toThrow(/at least a song title/);
  });
});

describe('batch evidence (one source, one call)', () => {
  it('stores key, tempo and harmony claims from a single source', async () => {
    await requestSong(
      { title: 'Test Song', artist: 'The Fixtures' },
      { dataDir: path.join(await mkdtemp(path.join(tmpdir(), 'req-')), 'data'), fetchFn: (async (): Promise<Response> => { throw new Error('offline'); }) as typeof fetch },
    );
    const result = await submitSongEvidence(
      {
        sourceUrl: 'https://chords.example/song',
        sourceKind: 'CHORD_RESOURCE',
        claims: [
          { claimType: 'KEY', value: { key: 'Ab major' } },
          { claimType: 'TEMPO', value: { bpm: 63 } },
          { claimType: 'CHORD_PROGRESSION', value: { chords: ['Ab', 'Fm', 'Db', 'Eb'], section: 'chorus' } },
        ],
      },
      { dataDir: path.join(await mkdtemp(path.join(tmpdir(), 'req-')), 'data') },
    );
    expect(result.addedCount).toBe(3);
    const types = result.session.evidence.map((ev: MusicalEvidence) => ev.claimType).sort();
    expect(types).toEqual(['CHORD_PROGRESSION', 'KEY', 'TEMPO']);
  });

  it('a duplicate claim inside a batch does not increase support', () => {
    const s = session();
    const raw = {
      sourceUrl: 'https://chords.example/song',
      claimType: 'TEMPO' as const,
      value: { bpm: 63 },
    };
    expect(submit(s, raw)).toBe(true);
    expect(submit(s, raw)).toBe(false);
    expect(s.evidence.filter((ev) => ev.claimType === 'TEMPO').length).toBe(1);
    expect(isDuplicate(s.evidence, validateEvidence(raw))).toBe(true);
  });
});

describe('copyright limits', () => {
  it('rejects a motif longer than 16 notes or 4 bars', () => {
    expect(() =>
      validateEvidence({
        claimType: 'SHORT_MOTIF',
        sourceUrl: 'https://analysis.example/motif',
        value: { notes: Array.from({ length: 17 }, (_, i) => ({ pitchClass: i % 12, relativeBeat: i * 0.5, durationBeats: 0.5 })) },
      }),
    ).toThrow(/16 notes/);

    expect(() =>
      validateEvidence({
        claimType: 'SHORT_MOTIF',
        sourceUrl: 'https://analysis.example/motif',
        value: { notes: Array.from({ length: 16 }, (_, i) => ({ pitchClass: i % 12, relativeBeat: i, durationBeats: 1.5 })) },
      }),
    ).toThrow(/4 bars/);

    // a legitimate 4-note hook is fine
    const motif = validateEvidence({
      claimType: 'SHORT_MOTIF',
      sourceUrl: 'https://analysis.example/motif',
      value: { notes: [{ pitchClass: 8 }, { pitchClass: 3 }, { pitchClass: 1 }, { pitchClass: 3, durationBeats: 2 }] },
    });
    expect((motif.value as { notes: unknown[] }).notes.length).toBe(4);
  });
});

describe('FORM + capo-context consensus', () => {
  it('FORM evidence fixes the section order', () => {
    const s = session();
    submit(s, {
      claimType: 'CHORD_SET',
      sourceUrl: 'https://a.example/chords',
      sourceKind: 'CHORD_RESOURCE',
      value: { chords: ['C', 'G', 'Am', 'F'], section: 'chorus' },
    });
    submit(s, {
      claimType: 'FORM',
      sourceUrl: 'https://b.example/form',
      sourceKind: 'MUSIC_ANALYSIS_RESOURCE',
      value: { sections: ['intro', 'verse', 'chorus'] },
    });
    const resolution = resolveSongResearch(s);
    expect(resolution.structure.sectionOrder).toEqual(['INTRO', 'VERSE', 'CHORUS']);
    expect(resolution.confidence.structure).toBeGreaterThan(0.5);
  });

  it('a standalone CAPO claim gives played-shape claims their sounding context', () => {
    const s = session();
    submit(s, { claimType: 'CAPO', sourceUrl: 'https://a.example/capo', sourceKind: 'CHORD_RESOURCE', value: { capo: 1 } });
    submit(s, {
      claimType: 'CHORD_PROGRESSION',
      sourceUrl: 'https://a.example/chords',
      sourceKind: 'CHORD_RESOURCE',
      value: { chords: ['G', 'Em', 'C', 'D'], section: 'chorus' },
      chordRepresentation: 'PLAYED_GUITAR_SHAPES',
      // no per-claim capo — the CAPO claim above supplies the context
    });
    submit(s, {
      claimType: 'CHORD_PROGRESSION',
      sourceUrl: 'https://b.example/chords',
      sourceKind: 'MUSIC_ANALYSIS_RESOURCE',
      value: { chords: ['Ab', 'Fm', 'Db', 'Eb'], section: 'chorus' },
      chordRepresentation: 'SOUNDING_HARMONY',
    });
    const resolution = resolveSongResearch(s);
    expect(resolution.harmony.sections.length).toBe(1);
    expect(resolution.harmony.sections[0]!.chords.map((c) => c.rootPc)).toEqual([8, 5, 1, 3]); // Ab Fm Db Eb
  });
});

describe('no-link research projections', () => {
  it('requestSong reuses the session for the same recording and exposes a brief', async () => {
    const dataDir = path.join(await mkdtemp(path.join(tmpdir(), 'req-')), 'data');
    const deps = { dataDir, fetchFn: (async (): Promise<Response> => { throw new Error('offline'); }) as typeof fetch };
    const first = await requestSong({ query: 'Night Drive by The Analog Hearts' }, deps);
    expect(first.brief.status).toBe('RESEARCHING');
    expect((first.brief.understanding as { identity: number }).identity).toBeGreaterThan(0);

    const again = await requestSong({ title: 'Night Drive', artist: 'The Analog Hearts' }, deps);
    expect(again.reused).toBe(true);
    expect(again.request.identity.title).toBe('Night Drive');

    await submitSongEvidence(
      {
        sourceUrl: 'https://a.example/chords',
        sourceKind: 'CHORD_RESOURCE',
        claims: [
          { claimType: 'KEY', value: { key: 'C major' } },
          { claimType: 'CHORD_PROGRESSION', value: { chords: ['C', 'G', 'Am', 'F'], section: 'chorus' } },
        ],
      },
      deps,
    );
    const brief = getResearchBrief() as { song: { title: string }; understanding: Record<string, number>; priorityGaps: unknown[] };
    expect(brief.song.title).toBe('Night Drive');
    expect(brief.understanding.harmony).toBeGreaterThan(0);
  });

  it('blueprint + validator expose compact readiness without evidence dumps', async () => {
    const dataDir = path.join(await mkdtemp(path.join(tmpdir(), 'req-')), 'data');
    await requestSong({ title: 'Slow Dawn', artist: 'The Fixtures' }, { dataDir, fetchFn: (async (): Promise<Response> => { throw new Error('offline'); }) as typeof fetch });
    await submitSongEvidence(
      {
        sourceUrl: 'https://a.example/chords',
        sourceKind: 'CHORD_RESOURCE',
        claims: [
          { claimType: 'KEY', value: { key: 'Ab major' } },
          { claimType: 'TEMPO', value: { bpm: 63 } },
          { claimType: 'METER', value: { numerator: 6, denominator: 8 } },
          { claimType: 'CHORD_PROGRESSION', value: { chords: ['Ab', 'Fm', 'Db', 'Eb'], section: 'chorus' } },
          { claimType: 'FORM', value: { sections: ['intro', 'verse', 'chorus'] } },
        ],
      },
      { dataDir },
    );

    const validation = validateSongBlueprint() as { status: string; canResolve: boolean; issues: string[] };
    expect(validation.status).toBe('NOT_READY'); // single harmony source → tentative, not resolvable as READY
    expect(Array.isArray(validation.issues)).toBe(true);

    const blueprint = getSongBlueprint() as Record<string, unknown>;
    expect(blueprint.mainHarmony).toEqual(['Ab', 'Fm', 'Db', 'Eb']);
    expect(blueprint.timingPrecision).toBe('SECTION_RELATIVE');
    expect(JSON.stringify(blueprint)).not.toContain('evidence'); // compact: no evidence dump
  });

  it('a research-only blueprint builds a compilable SongGraph without any audio', () => {
    const s = session();
    submit(s, { claimType: 'IDENTITY', sourceUrl: 'https://a.example/i', sourceKind: 'MUSIC_DATABASE', value: { title: 'Test Song', artist: 'The Fixtures' } });
    submit(s, { claimType: 'KEY', sourceUrl: 'https://a.example/k', sourceKind: 'CHORD_RESOURCE', value: { key: 'Ab major' } });
    submit(s, { claimType: 'TEMPO', sourceUrl: 'https://a.example/t', sourceKind: 'ARTICLE', value: { bpm: 63 } });
    submit(s, { claimType: 'METER', sourceUrl: 'https://a.example/m', sourceKind: 'MUSIC_ANALYSIS_RESOURCE', value: { numerator: 6, denominator: 8 } });
    submit(s, {
      claimType: 'CHORD_PROGRESSION',
      sourceUrl: 'https://a.example/chords',
      sourceKind: 'CHORD_RESOURCE',
      value: { chords: ['Ab', 'Fm', 'Db', 'Eb'], section: 'chorus' },
    });
    submit(s, {
      claimType: 'CHORD_PROGRESSION',
      sourceUrl: 'https://b.example/chords',
      sourceKind: 'MUSIC_ANALYSIS_RESOURCE',
      value: { chords: ['Ab', 'Fm', 'Db', 'Eb'], section: 'chorus' },
    });
    const resolution = resolveSongResearch(s);
    expect(['READY', 'READY_WITH_WARNINGS']).toContain(resolution.status);
    const { graph } = buildResearchSongGraph('research_test', resolution, { title: 'Test Song', artist: 'The Fixtures' });
    expect(graph.harmony.chords.length).toBeGreaterThan(0);
    expect(graph.timingPrecision).toBe('SECTION_ONLY');
  });
});
