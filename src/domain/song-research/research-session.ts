import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../../errors/app-error.js';
import { isDuplicate, newEvidenceId, type MusicalEvidence } from './musical-evidence.js';
import type { ResearchResolution } from './research-resolution.js';
import { RESEARCH_SCHEMA_VERSION } from './research-confidence.js';

/**
 * Evidence-based research for one canonical recording. Persisted per identity
 * key so research survives reloads and is reusable across Spotify / MusicBrainz
 * / manual title-artist entry of the SAME recording.
 */
export type SongResearchStatus =
  | 'IDENTIFYING'
  | 'RESEARCHING'
  | 'NEEDS_MORE_EVIDENCE'
  | 'READY_WITH_WARNINGS'
  | 'READY'
  | 'FAILED';

export interface SongResearchIdentity {
  title: string;
  artist: string;
  album?: string;
  durationSeconds?: number;
  spotifyId?: string;
  musicBrainzRecordingId?: string;
  isrc?: string;
}

export interface SongResearchSession {
  schemaVersion: number;
  id: string;
  /** Canonical identity key — the persistence + cache key. */
  identityKey: string;
  songIdentity: SongResearchIdentity;
  status: SongResearchStatus;
  evidence: MusicalEvidence[];
  hypotheses: unknown[];
  resolution?: ResearchResolution;
  /** Bumped on manual refresh; old evidence is kept, resolution restarts. */
  researchVersion: number;
  createdAt: string;
  updatedAt: string;
}

export function identityKeyOf(identity: SongResearchIdentity): string {
  // transliterate Turkish ı/İ so the same song always maps to one key
  const norm = (s: string): string =>
    s.replace(/ı/g, 'i').replace(/İ/g, 'I').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return `${norm(identity.artist) || '?'}::${norm(identity.title) || '?'}`;
}

export function createResearchSession(identity: SongResearchIdentity): SongResearchSession {
  const now = new Date().toISOString();
  return {
    schemaVersion: RESEARCH_SCHEMA_VERSION,
    id: `research_${newEvidenceId().slice(3)}`,
    identityKey: identityKeyOf(identity),
    songIdentity: identity,
    status: 'RESEARCHING',
    evidence: [],
    hypotheses: [],
    researchVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/** Add evidence with dedup; returns false when the exact fact+URL already exists. */
export function addEvidence(session: SongResearchSession, evidence: MusicalEvidence): boolean {
  if (isDuplicate(session.evidence, evidence)) return false;
  session.evidence.push(evidence);
  session.updatedAt = new Date().toISOString();
  return true;
}

export function sessionDir(dataDir: string): string {
  return path.join(dataDir, 'research');
}

function sessionPath(dataDir: string, identityKey: string): string {
  return path.join(sessionDir(dataDir), `${encodeURIComponent(identityKey)}.json`);
}

export async function saveResearchSession(dataDir: string, session: SongResearchSession): Promise<void> {
  const file = sessionPath(dataDir, session.identityKey);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(session, null, 2) + '\n');
}

export async function loadResearchSession(dataDir: string, identityKey: string): Promise<SongResearchSession | null> {
  try {
    const raw = JSON.parse(await readFile(sessionPath(dataDir, identityKey), 'utf8')) as SongResearchSession;
    if (raw.schemaVersion !== RESEARCH_SCHEMA_VERSION) return null; // stale schema → research fresh
    return raw;
  } catch {
    return null;
  }
}

export function requireSession(session: SongResearchSession | null, dataDir: string): SongResearchSession {
  if (session === null) {
    throw new AppError('FILE_NOT_FOUND', 'No active research session — call begin_song_research first.');
  }
  return session;
}
