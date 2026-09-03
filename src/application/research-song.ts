import { createHash } from 'node:crypto';
import { loadResearchSession, saveResearchSession, createResearchSession, addEvidence, type SongResearchSession, type SongResearchIdentity } from '../domain/song-research/research-session.js';
import { validateEvidence, type MusicalEvidence } from '../domain/song-research/musical-evidence.js';
import type { ResearchResolution } from '../domain/song-research/research-resolution.js';
import { resolveSongResearch } from '../engines/research/research-resolver.js';
import { buildResearchSongGraph } from '../engines/research/research-graph.js';
import { chordLabelForPc } from '../engines/research/evidence-normalizer.js';
import { lookupMusicBrainzRecording, type MusicBrainzLookupResult } from '../providers/music-metadata/musicbrainz-provider.js';
import { LocalSongGraphRepository } from '../repositories/song-graph-repository.js';
import { createSongRequest, type SongRequest } from '../domain/song-request/song-request.js';
import { config } from '../config/env.js';
import { AppError } from '../errors/app-error.js';

/**
 * Research-session orchestration: identity → evidence intake → fusion →
 * research-derived SongGraph. The BROWSER AGENT does the web research and
 * submits facts; this layer verifies, fuses, and never scrapes anything.
 */

export interface BeginResearchResult {
  session: SongResearchSession;
  resolution: ResearchResolution;
  suggestedQueries: string[];
  musicBrainz?: { recordingId: string; title: string; artist: string; ambiguous: boolean } | null;
}

export interface BeginResearchInput {
  title?: string;
  artist?: string;
  spotifyId?: string;
  album?: string;
  durationSeconds?: number;
  /** Manual refresh: keep evidence, start a new resolution version. */
  refresh?: boolean;
}

export interface ResearchDeps {
  dataDir?: string;
  songsDir?: string;
  fetchFn?: typeof fetch;
}

/** Current session pointer (per server process); sessions persist by identity key. */
let current: SongResearchSession | null = null;

export function getCurrentResearchSession(): SongResearchSession | null {
  return current;
}

export async function beginSongResearch(input: BeginResearchInput, deps: ResearchDeps = {}): Promise<BeginResearchResult> {
  const dataDir = deps.dataDir ?? config.dataDir;
  const title = (input.title ?? '').trim();
  const artist = (input.artist ?? '').trim();
  if (title.length === 0 && artist.length === 0) {
    throw new AppError('DOMAIN_VALIDATION', 'Research needs at least a song title (and ideally the artist).');
  }
  const identity: SongResearchIdentity = {
    title: title.length > 0 ? title : artist,
    artist,
    ...(input.album !== undefined && { album: input.album }),
    ...(input.durationSeconds !== undefined && { durationSeconds: input.durationSeconds }),
    ...(input.spotifyId !== undefined && { spotifyId: input.spotifyId }),
  };

  const fresh = createResearchSession(identity);
  const existing = await loadResearchSession(dataDir, fresh.identityKey);
  let active: SongResearchSession;
  if (existing !== null && input.refresh !== true) {
    active = existing;
  } else if (existing !== null && input.refresh === true) {
    // manual refresh: preserve evidence, bump the resolution version
    active = { ...existing, researchVersion: existing.researchVersion + 1, status: 'RESEARCHING' };
    delete active.resolution;
  } else {
    active = fresh;
  }
  current = active;

  // identity resolution via MusicBrainz (identity ONLY — never musical analysis)
  let mb: MusicBrainzLookupResult | null = null;
  if (active.songIdentity.title.length > 0) {
    const artist = active.songIdentity.artist;
    // video-page titles carry junk ("Artist - Song (Official Video) (4K Remaster)") — clean for the query
    let queryTitle = active.songIdentity.title.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
    if (artist.length > 0 && queryTitle.toLowerCase().startsWith(artist.toLowerCase())) {
      queryTitle = queryTitle.slice(artist.length).replace(/^[-–—:\s]+/, '').trim();
    }
    mb = await lookupMusicBrainzRecording(
      { title: queryTitle.length > 0 ? queryTitle : active.songIdentity.title, ...(artist.length > 0 && { artist }) },
      deps.fetchFn ?? fetch,
    );
    if (mb !== null && mb.best !== undefined) {
      const ev = validateEvidence({
        claimType: 'IDENTITY',
        value: {
          title: mb.best.title,
          artist: mb.best.artist,
          musicBrainzRecordingId: mb.best.recordingId,
          ...(mb.best.isrc !== undefined && { isrc: mb.best.isrc }),
          ...(mb.best.durationMs !== undefined && { durationSeconds: Math.round(mb.best.durationMs / 1000) }),
        },
        sourceUrl: `https://musicbrainz.org/recording/${mb.best.recordingId}`,
        sourceTitle: `MusicBrainz: ${mb.best.title}`,
        sourceKind: 'MUSIC_DATABASE',
        submittedBy: 'SYSTEM_PROVIDER',
        confidence: 0.9,
      });
      addEvidence(active, ev);
      active.songIdentity.musicBrainzRecordingId = mb.best.recordingId;
      if (mb.best.isrc !== undefined) active.songIdentity.isrc = mb.best.isrc;
    }
  }

  const resolution = resolveSongResearch(active);
  await saveResearchSession(dataDir, active);
  return {
    session: active,
    resolution,
    suggestedQueries: resolution.gaps.flatMap((g) => g.suggestedQueries).slice(0, 8),
    ...(mb !== null && mb.best !== undefined
      ? {
          musicBrainz: {
            recordingId: mb.best.recordingId,
            title: mb.best.title,
            artist: mb.best.artist,
            ambiguous: mb.ambiguous,
          },
        }
      : { musicBrainz: null }),
  };
}

export async function submitSongEvidence(
  payload: Record<string, unknown>,
  deps: ResearchDeps = {},
): Promise<{ session: SongResearchSession; resolution: ResearchResolution; added: boolean; addedCount: number }> {
  const session = requireCurrent();
  let addedCount = 0;
  if (Array.isArray(payload.claims)) {
    // BATCH: several compact facts observed on ONE source → one call.
    const { claims, ...source } = payload;
    for (const claim of claims as Record<string, unknown>[]) {
      const evidence = validateEvidence({ ...source, ...claim });
      if (addEvidence(session, evidence)) addedCount += 1;
    }
  } else {
    const evidence = validateEvidence(payload);
    if (addEvidence(session, evidence)) addedCount = 1;
  }
  const resolution = resolveSongResearch(session);
  await saveResearchSession(deps.dataDir ?? config.dataDir, session);
  return { session, resolution, added: addedCount > 0, addedCount };
}

export function getResearchStatus(): { session: SongResearchSession; resolution: ResearchResolution } {
  const session = requireCurrent();
  const resolution = session.resolution ?? resolveSongResearch(session);
  return { session, resolution };
}

export interface ResolveResearchResult {
  songId: string;
  resolved: boolean;
  origin: 'RESEARCH_FUSION' | 'HYBRID';
  confidence: ResearchResolution['confidence']['overallUsability'];
  status: ResearchResolution['status'];
  warnings: string[];
}

/**
 * Fuse the evidence into a research-derived SongGraph and persist it. From
 * here the graph feeds the UNCHANGED guitar compiler (PlayerProfile, beam
 * search, Practice Studio).
 */
export async function resolveResearchedSong(
  options: { allowWarnings?: boolean } = {},
  deps: ResearchDeps = {},
): Promise<ResolveResearchResult> {
  const { session, resolution } = getResearchStatus();
  if (resolution.status === 'FAILED') {
    throw new AppError('DOMAIN_VALIDATION', 'Research FAILED: identity unresolved — a trustworthy arrangement is impossible.');
  }
  if (resolution.status !== 'READY' && options.allowWarnings !== true) {
    throw new AppError(
      'DOMAIN_VALIDATION',
      `Research is ${resolution.status} — resolve is not honest yet. See get_song_research_status gaps, or pass allowWarnings: true if the user accepts a clearly-labeled lower-confidence arrangement.`,
    );
  }

  const dataDir = deps.dataDir ?? config.dataDir;
  const songsDir = deps.songsDir ?? config.songsDir;
  const songId = `research_${createHash('sha256').update(session.identityKey).digest('hex').slice(0, 12)}`;
  const { graph, warnings } = buildResearchSongGraph(songId, resolution, {
    ...(session.songIdentity.title.length > 0 && { title: session.songIdentity.title }),
    ...(session.songIdentity.artist.length > 0 && { artist: session.songIdentity.artist }),
  });
  await new LocalSongGraphRepository(songsDir).save(songId, graph);
  await saveResearchSession(dataDir, session);

  return {
    songId,
    resolved: true,
    origin: 'RESEARCH_FUSION',
    confidence: resolution.confidence.overallUsability,
    status: resolution.status,
    warnings,
  };
}

function requireCurrent(): SongResearchSession {
  if (current === null) {
    throw new AppError('FILE_NOT_FOUND', 'No active research session — call begin_song_research first.');
  }
  return current;
}

// --- song request by NAME (the no-link hero path) ---

export interface RequestSongResult {
  request: SongRequest;
  reused: boolean;
  brief: Record<string, unknown>;
  musicBrainz?: { recordingId: string; title: string; artist: string; ambiguous: boolean } | null;
}

/**
 * Establish song identity intent from a NAME (no link, no audio) and start/reuse
 * the compatible research session. Reuses the persisted session for the same
 * recording — resubmitting the same song never restarts research.
 */
export async function requestSong(
  input: { query?: unknown; title?: unknown; artist?: unknown; version?: unknown },
  deps: ResearchDeps = {},
): Promise<RequestSongResult> {
  const request = createSongRequest(input);
  const before = current;
  const began = await beginSongResearch(
    {
      title: request.identity.title,
      artist: request.identity.artist,
    },
    deps,
  );
  // same recording requested twice → the persisted research session is reused
  const reused = before !== null && before.id === began.session.id;
  return {
    request,
    reused,
    brief: researchBrief(began.session, began.resolution),
    musicBrainz: began.musicBrainz ?? null,
  };
}

// --- research brief + song blueprint (read-only projections) ---

/**
 * The agent-facing orchestration view: what is known, what is missing, and what
 * to research next. Deterministic — derived only from stored evidence.
 */
export function researchBrief(session: SongResearchSession, resolution: ResearchResolution): Record<string, unknown> {
  const compact = compactResearchStatus(session, resolution);
  const gaps = [...(resolution.gaps ?? [])].sort((a, b) => {
    const rank = (p: string): number => (p === 'HIGH' ? 0 : p === 'MEDIUM' ? 1 : 2);
    return rank(a.priority) - rank(b.priority);
  });
  return {
    song: {
      title: session.songIdentity.title,
      ...(session.songIdentity.artist.length > 0 && { artist: session.songIdentity.artist }),
    },
    status: resolution.status,
    understanding: {
      identity: resolution.confidence.identity,
      harmony: resolution.confidence.harmony,
      key: resolution.confidence.key,
      tempo: resolution.confidence.tempo,
      meter: resolution.confidence.meter,
      structure: resolution.confidence.structure,
      overall: resolution.confidence.overallUsability,
    },
    independentSources: compact.independentDomains,
    sources: compact.sources,
    conflicts: resolution.conflicts.map((c) => ({
      field: c.field,
      readings: c.hypotheses.map((h) => h.value),
      suggestedQueries: c.suggestedResolutionQueries.slice(0, 4),
    })),
    priorityGaps: gaps.slice(0, 4),
    suggestedQueries: gaps.flatMap((g) => g.suggestedQueries).slice(0, 8),
    ...(resolution.warnings.length > 0 && { warnings: resolution.warnings }),
    hypotheses: (session.hypotheses as Array<{ explanation?: string }>)
      .map((h) => h.explanation ?? '')
      .filter((s) => s.length > 0)
      .slice(0, 4),
  };
}

export function getResearchBrief(): Record<string, unknown> {
  const session = requireCurrent();
  const resolution = session.resolution ?? resolveSongResearch(session);
  return researchBrief(session, resolution);
}

/**
 * Compact research blueprint: the resolved musical facts without the evidence
 * database. Timing stays SECTION_RELATIVE — research never invents recording
 * timestamps.
 */
export function songBlueprint(session: SongResearchSession, resolution: ResearchResolution): Record<string, unknown> {
  return {
    identity: {
      title: resolution.identity.title ?? session.songIdentity.title,
      artist: resolution.identity.artist || session.songIdentity.artist,
      ...(resolution.identity.musicBrainzRecordingId !== undefined && { musicBrainzRecordingId: resolution.identity.musicBrainzRecordingId }),
      ...(resolution.identity.isrc !== undefined && { isrc: resolution.identity.isrc }),
    },
    ...(resolution.key !== undefined && { key: resolution.key.display }),
    ...(resolution.tempo !== undefined && { tempo: { bpm: resolution.tempo.practiceOrMetricBpm, explanation: resolution.tempo.explanation } }),
    ...(resolution.meter !== undefined && { meter: `${resolution.meter.numerator}/${resolution.meter.denominator}` }),
    mainHarmony: resolution.harmony.mainChords,
    sectionHarmony: resolution.harmony.sections.map((s) => ({
      section: s.section,
      chords: s.chords.map((c) => chordLabelForPc(c.rootPc, c.family, resolution.harmony.preferFlats)),
      confidence: Math.round(s.confidence * 100) / 100,
    })),
    form: resolution.structure.sectionOrder,
    timingPrecision: 'SECTION_RELATIVE',
    status: resolution.status,
    confidence: resolution.confidence,
    warnings: resolution.warnings,
    origin: 'WEB_RESEARCH',
    resolverVersion: resolution.resolverVersion,
    researchVersion: resolution.researchVersion,
  };
}

export function getSongBlueprint(): Record<string, unknown> {
  const session = requireCurrent();
  const resolution = session.resolution ?? resolveSongResearch(session);
  return songBlueprint(session, resolution);
}

/** Read-only readiness check with concrete issues — never mutates anything. */
export function validateSongBlueprint(): Record<string, unknown> {
  const session = requireCurrent();
  const resolution = session.resolution ?? resolveSongResearch(session);
  const issues: string[] = [...resolution.warnings];
  if (resolution.identity.ambiguous === true) {
    issues.push(`Identity ambiguous — candidates: ${(resolution.identity.candidateSummaries ?? []).join(', ')}`);
  }
  if (resolution.confidence.harmony < 0.6) issues.push('Harmony has weak or single-source support — resolve would be TENTATIVE.');
  if (resolution.tempo === undefined) issues.push('No tempo evidence yet — practice would use a neutral default.');
  if (resolution.meter === undefined) issues.push('No meter evidence yet — practice display assumes 4/4.');
  if (resolution.status === 'READY') issues.push('No blocking issues — the blueprint resolves honestly.');
  return {
    status: resolution.status === 'RESEARCHING' || resolution.status === 'NEEDS_MORE_EVIDENCE' ? 'NOT_READY' : resolution.status,
    canResolve: resolution.status === 'READY' || resolution.status === 'READY_WITH_WARNINGS',
    issues,
    confidence: resolution.confidence,
    openConflicts: resolution.conflicts.map((c) => c.field),
    gaps: resolution.gaps.slice(0, 4),
  };
}

/** Retract a source entirely (e.g. it described an acoustic version). */
export async function retractEvidenceByUrl(urlPrefix: string, deps: ResearchDeps = {}): Promise<{ removed: number }> {
  const session = requireCurrent();
  const before = session.evidence.length;
  session.evidence = session.evidence.filter((ev: MusicalEvidence) => !ev.source.url.startsWith(urlPrefix));
  const removed = before - session.evidence.length;
  if (removed > 0) {
    resolveSongResearch(session);
    await saveResearchSession(deps.dataDir ?? config.dataDir, session);
  }
  return { removed };
}

/** Compact shape for the WebMCP status tool + UI board. */
export function compactResearchStatus(session: SongResearchSession, resolution: ResearchResolution): Record<string, unknown> {
  const domains = new Set(session.evidence.map((ev) => ev.source.domain));
  const valueSummary = (ev: MusicalEvidence): string => {
    const v = ev.value as Record<string, unknown>;
    switch (ev.claimType) {
      case 'CHORD_SET':
      case 'CHORD_PROGRESSION':
        return `${(v.chords as string[]).join(' ')}${ev.context?.capo ? ` (capo ${ev.context.capo})` : ''}`;
      case 'TEMPO':
        return `${v.bpm} BPM`;
      case 'METER':
        return `${v.numerator}/${v.denominator}`;
      case 'KEY':
        return String(v.key);
      case 'SECTION':
        return String(v.name);
      case 'FORM':
      case 'SECTION_STRUCTURE':
        return (v.sections as string[]).join(' · ');
      case 'SHORT_MOTIF':
        return `${(v.notes as unknown[]).length}-note motif`;
      case 'IDENTITY':
        return [v.artist, v.title].filter(Boolean).join(' — ');
      case 'DURATION':
        return `${v.durationSeconds}s`;
      case 'CAPO':
        return `capo ${v.capo}`;
    }
  };
  return {
    status: resolution.status,
    identity: {
      title: session.songIdentity.title,
      artist: session.songIdentity.artist || resolution.identity.artist,
      ambiguous: resolution.identity.ambiguous === true,
    },
    resolved: {
      key: resolution.key?.display,
      tempoBpm: resolution.tempo?.practiceOrMetricBpm,
      tempoExplanation: resolution.tempo?.explanation,
      meter: resolution.meter !== undefined ? `${resolution.meter.numerator}/${resolution.meter.denominator}` : undefined,
      meterAlternatives: resolution.meter?.alternatives.map((m) => `${m.numerator}/${m.denominator}`),
      harmony: resolution.harmony.sections.map((s) => ({
        section: s.section,
        chords: s.chords.map((c) => chordLabelForPc(c.rootPc, c.family, resolution.harmony.preferFlats)),
        confidence: s.confidence,
      })),
      mainChords: resolution.harmony.mainChords,
      sectionOrder: resolution.structure.sectionOrder,
    },
    sources: session.evidence.length,
    independentDomains: domains.size,
    confidence: resolution.confidence,
    conflicts: resolution.conflicts.map((c) => ({
      field: c.field,
      readings: c.hypotheses.map((h) => h.value),
      families: Math.max(...c.hypotheses.map((h) => h.families.length)),
    })),
    hypotheses: (session.hypotheses as Array<{ explanation?: string }>).map((h) => h.explanation ?? '').filter((s) => s.length > 0),
    gaps: resolution.gaps,
    suggestedQueries: resolution.gaps.flatMap((g) => g.suggestedQueries).slice(0, 8),
    warnings: resolution.warnings,
    evidence: session.evidence.map((ev) => ({
      claimType: ev.claimType,
      value: valueSummary(ev),
      domain: ev.source.domain,
      url: ev.source.url,
      kind: ev.source.kind,
      submittedBy: ev.submittedBy,
      section: ev.context?.section,
    })),
  };
}
