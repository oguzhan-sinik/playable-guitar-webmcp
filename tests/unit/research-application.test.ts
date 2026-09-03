import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beginSongResearch, submitSongEvidence, resolveResearchedSong, getResearchStatus, compactResearchStatus } from '../../src/application/research-song.js';
import { lookupMusicBrainzRecording, clearMusicBrainzCache, identityConfidence } from '../../src/providers/music-metadata/musicbrainz-provider.js';
import { LocalSongGraphRepository } from '../../src/repositories/song-graph-repository.js';
import { AppError } from '../../src/errors/app-error.js';

const MB_RESPONSE = {
  recordings: [
    {
      id: 'mb-rec-1',
      title: 'Test Song',
      length: 183000,
      'artist-credit': [{ name: 'Test Artist' }],
      releases: [{ title: 'Test Album' }],
      isrcs: ['USXXX1234567'],
    },
  ],
};

function okFetch(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
}

describe('MusicBrainz identity provider', () => {
  beforeEach(() => clearMusicBrainzCache());

  it('resolves identity, caches, and flags ambiguity for live vs studio', async () => {
    const fetchFn = vi.fn(okFetch({
      recordings: [
        { id: 'mb-1', title: 'Test Song', 'artist-credit': [{ name: 'A' }] },
        { id: 'mb-2', title: 'Test Song (Live)', 'artist-credit': [{ name: 'A' }] },
      ],
    }));
    const first = await lookupMusicBrainzRecording({ title: 'Test Song', artist: 'A' }, fetchFn as unknown as typeof fetch);
    expect(first?.best?.recordingId).toBe('mb-1');
    expect(first?.ambiguous).toBe(true);
    const second = await lookupMusicBrainzRecording({ title: 'Test Song', artist: 'A' }, fetchFn as unknown as typeof fetch);
    expect(fetchFn).toHaveBeenCalledTimes(1); // cached
  });

  it('computes identity confidence from title/artist/duration', () => {
    const exact = identityConfidence({ title: 'Test Song', artist: 'Test Artist', durationSeconds: 183 }, { title: 'Test Song', artist: 'Test Artist', durationMs: 183000 });
    expect(exact.confidence).toBeGreaterThan(0.9);
    const loose = identityConfidence({ title: 'Test Song', artist: 'Test Artist' }, { title: 'Other Song', artist: 'Other Artist' });
    expect(loose.confidence).toBeLessThan(0.5);
  });
});

describe('research application flow', () => {
  let dir = '';
  beforeEach(async () => {
    clearMusicBrainzCache();
    dir = await mkdtemp(path.join(tmpdir(), 'research-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('begin → submit evidence → status → resolve → SongGraph persisted; sessions persist', async () => {
    const deps = { dataDir: dir, songsDir: path.join(dir, 'songs'), fetchFn: okFetch(MB_RESPONSE) as unknown as typeof fetch };

    const begin = await beginSongResearch({ title: 'Test Song', artist: 'Test Artist' }, deps);
    expect(begin.musicBrainz?.recordingId).toBe('mb-rec-1');
    expect(begin.session.evidence.some((ev) => ev.claimType === 'IDENTITY' && ev.submittedBy === 'SYSTEM_PROVIDER')).toBe(true);
    expect(begin.resolution.status).toBe('NEEDS_MORE_EVIDENCE'); // identity known, no harmony yet
    expect(begin.suggestedQueries.length).toBeGreaterThan(0);

    // duplicate identity submission is dropped
    const dup = await submitSongEvidence({
      claimType: 'IDENTITY',
      value: { title: 'Test Song', artist: 'Test Artist', musicBrainzRecordingId: 'mb-rec-1' },
      sourceUrl: 'https://musicbrainz.org/recording/mb-rec-1',
    }, deps);
    expect(dup.added).toBe(false);

    // not resolvable yet
    await expect(resolveResearchedSong({}, deps)).rejects.toThrow(/NEEDS_MORE_EVIDENCE|RESEARCHING|READY_WITH_WARNINGS/);

    // chord sources: one sounding, one capo'd — agree after normalization
    await submitSongEvidence({
      claimType: 'CHORD_PROGRESSION', value: { section: 'chorus', chords: ['Ab', 'Fm', 'Db', 'Eb'] },
      sourceUrl: 'https://chords-one.example/tab', sourceKind: 'CHORD_RESOURCE', chordRepresentation: 'SOUNDING_HARMONY',
    }, deps);
    await submitSongEvidence({
      claimType: 'CHORD_PROGRESSION', value: { section: 'chorus', chords: ['G', 'Em', 'C', 'D'] },
      sourceUrl: 'https://guitartabs-two.example/song', sourceKind: 'CHORD_RESOURCE',
      chordRepresentation: 'PLAYED_GUITAR_SHAPES', capo: 1,
    }, deps);
    await submitSongEvidence({ claimType: 'TEMPO', value: { bpm: 63 }, sourceUrl: 'https://bpm-three.example/song', sourceKind: 'MUSIC_DATABASE' }, deps);
    await submitSongEvidence({ claimType: 'METER', value: { numerator: 4, denominator: 4 }, sourceUrl: 'https://bpm-three.example/song', sourceKind: 'MUSIC_DATABASE' }, deps);

    // READY_WITH_WARNINGS (tempo single-source): honest resolve requires the labeled flag
    const resolved = await resolveResearchedSong({ allowWarnings: true }, deps);
    expect(resolved.resolved).toBe(true);
    expect(resolved.origin).toBe('RESEARCH_FUSION');
    expect(resolved.warnings.length).toBeGreaterThan(0);

    const graph = await new LocalSongGraphRepository(deps.songsDir).load(resolved.songId);
    expect(graph.provenance?.origin).toBe('RESEARCH_FUSION');
    expect(graph.timingPrecision).toBe('SECTION_ONLY');
    expect(graph.harmony.chords.length).toBeGreaterThan(0);

    // the session persists and reloads research by identity key
    const persisted = JSON.parse(await readFile(path.join(dir, 'research', encodeURIComponent('semicenk::test song') === '' ? 'x' : `${encodeURIComponent(getResearchStatus().session.identityKey)}.json`), 'utf8')) as { evidence: unknown[] };
    expect(persisted.evidence.length).toBeGreaterThanOrEqual(5);

    const status = compactResearchStatus(getResearchStatus().session, getResearchStatus().resolution);
    expect(status.independentDomains).toBeGreaterThanOrEqual(3);
  });

  it('allows a labeled tentative resolve only with allowWarnings', async () => {
    const deps = { dataDir: dir, songsDir: path.join(dir, 'songs'), fetchFn: okFetch(MB_RESPONSE) as unknown as typeof fetch };
    await beginSongResearch({ title: 'Test Song', artist: 'Test Artist' }, deps);
    await submitSongEvidence({
      claimType: 'CHORD_PROGRESSION', value: { section: 'chorus', chords: ['C', 'G', 'Am', 'F'] },
      sourceUrl: 'https://one.example/tab', sourceKind: 'CHORD_RESOURCE',
    }, deps);
    await expect(resolveResearchedSong({}, deps)).rejects.toBeInstanceOf(AppError);
    const tentative = await resolveResearchedSong({ allowWarnings: true }, deps);
    expect(['NEEDS_MORE_EVIDENCE', 'READY_WITH_WARNINGS']).toContain(tentative.status);
    expect(tentative.warnings.length).toBeGreaterThan(0); // labeled, never silent
  });
});
