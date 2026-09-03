import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, access, readdir } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/env.js';
import type { SongGraph } from '../domain/music/song-graph.js';
import type { AnalysisAgentDecision } from '../domain/agent/analysis-decision.js';
import type { GuitarFeasibilityDecision } from '../domain/agent/feasibility-decision.js';
import type { AgentRunProvenance } from '../domain/agent/workflow-trace.js';

export type AgentCacheKind = 'analysis' | 'feasibility';

export interface CachedAgentResult<T> {
  decision: T;
  provenance: AgentRunProvenance;
  cachedAt: string;
  cacheKey: string;
}

/** Stable hash of musically relevant graph fields (ignores volatile metadata). */
export function hashSongGraphStable(graph: SongGraph): string {
  const payload = {
    global: {
      bpm: graph.global.bpm,
      timeSignature: graph.global.timeSignature,
      key: graph.global.key,
    },
    sections: graph.sections.map((s) => ({ type: s.type, startBeat: s.startBeat, endBeat: s.endBeat })),
    harmony: {
      chords: graph.harmony.chords.map((c) => ({
        startBeat: c.startBeat,
        durationBeats: c.durationBeats,
        root: c.root,
        quality: c.quality,
      })),
    },
    confidence: {
      overall: graph.confidence.overall,
      ...(graph.confidence.chord !== undefined && { chord: graph.confidence.chord }),
      ...(graph.confidence.rhythm !== undefined && { rhythm: graph.confidence.rhythm }),
      ...(graph.confidence.key !== undefined && { key: graph.confidence.key }),
    },
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

/** @deprecated use hashSongGraphStable */
export function hashSongGraph(graph: SongGraph): string {
  return hashSongGraphStable(graph);
}

export function hashAnalysisDecision(decision: AnalysisAgentDecision): string {
  // Stable subset — evidence prose may vary between runs with the same verdict.
  const stable = {
    status: decision.status,
    recommendedAction: decision.recommendedAction,
    interpretation: decision.interpretation,
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex').slice(0, 12);
}

export function buildAgentCacheKey(parts: {
  agent: AgentCacheKind;
  graphHash: string;
  model: string;
  promptVersion: string;
  analysisHash?: string;
}): string {
  const raw = [parts.agent, parts.graphHash, parts.model, parts.promptVersion, parts.analysisHash ?? ''].join(':');
  return createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

function cachePath(songsDir: string, songId: string, agent: AgentCacheKind, cacheKey: string): string {
  return path.join(songsDir, songId, 'agents', agent, `${cacheKey}.json`);
}

export async function loadCachedAgentResult<T>(
  songId: string,
  agent: AgentCacheKind,
  cacheKey: string,
  songsDir: string = config.songsDir,
): Promise<CachedAgentResult<T> | null> {
  const file = cachePath(songsDir, songId, agent, cacheKey);
  try {
    await access(file);
    const raw = JSON.parse(await readFile(file, 'utf8')) as CachedAgentResult<T>;
    if (raw.cacheKey !== cacheKey) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Fallback: find any cached file whose stored cacheKey matches (handles hash drift). */
export async function findCachedAgentByKey<T>(
  songId: string,
  agent: AgentCacheKind,
  cacheKey: string,
  songsDir: string = config.songsDir,
): Promise<CachedAgentResult<T> | null> {
  const direct = await loadCachedAgentResult<T>(songId, agent, cacheKey, songsDir);
  if (direct !== null) return direct;

  const dir = path.join(songsDir, songId, 'agents', agent);
  try {
    const files = await readdir(dir);
    for (const file of files) {
      if (!file.endsWith('.json') || file === 'latest.json') continue;
      try {
        const raw = JSON.parse(await readFile(path.join(dir, file), 'utf8')) as CachedAgentResult<T>;
        if (raw.cacheKey === cacheKey) return raw;
      } catch {
        // skip corrupt files
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Hash from persisted graph.json so keys match across in-memory reordering. */
export async function hashSongGraphFromDisk(songId: string, songsDir: string = config.songsDir): Promise<string> {
  const file = path.join(songsDir, songId, 'graph.json');
  const graph = JSON.parse(await readFile(file, 'utf8')) as SongGraph;
  return hashSongGraphStable(graph);
}

export async function saveCachedAgentResult<T>(
  songId: string,
  agent: AgentCacheKind,
  cacheKey: string,
  decision: T,
  provenance: AgentRunProvenance,
  songsDir: string = config.songsDir,
): Promise<void> {
  const file = cachePath(songsDir, songId, agent, cacheKey);
  await mkdir(path.dirname(file), { recursive: true });
  const payload: CachedAgentResult<T> = {
    decision,
    provenance: { ...provenance, cached: true },
    cachedAt: new Date().toISOString(),
    cacheKey,
  };
  await writeFile(file, JSON.stringify(payload, null, 2) + '\n');
}
