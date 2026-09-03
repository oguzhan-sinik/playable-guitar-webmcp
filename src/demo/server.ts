import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, access, writeFile, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/env.js';
import { runSongProcessing } from '../workflows/song-processing/graph.js';
import { parseSkillLevel } from '../domain/skill/skill-preset.js';
import type { SongProcessingResult } from '../workflows/song-processing/result.js';
import {
  loadGraph,
  listSections,
  summarizeAnalysis,
  compileGuitarVersion,
  compareGuitarLevels,
  explainGuitarVersion,
  createPracticePlan,
  diagnoseArrangement,
  loadArrangementDetail,
  buildSession,
  type PrepareOptions,
} from '../application/prepare-arrangement.js';
import { mergeProfile, type PlayerProfileInput } from '../domain/player/player-profile.js';
import { clampTempoFactor } from '../domain/practice/practice-tempo.js';
import { loadSongFromLink } from '../application/load-song-from-link.js';
import {
  beginSongResearch,
  submitSongEvidence,
  getResearchStatus,
  compactResearchStatus,
  resolveResearchedSong,
  getCurrentResearchSession,
} from '../application/research-song.js';
import { searchLicensedTracks, loadLicensedTrack } from '../providers/licensed-audio/licensed-audio-provider.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../..');
const DEMO_DIR = path.join(ROOT, '.demo');
const DEMO_RESULT = path.join(DEMO_DIR, 'perfect-result.json');
const HTML = path.join(ROOT, 'demo', 'index.html');
const APP_JS = path.join(ROOT, 'demo', 'app.js');
/** Committed graph-only fixture; seeded into the data dir when absent (no MIR needed). */
const SEED_DIR = path.join(ROOT, 'seed', 'demo-song');
const PORT = Number(process.env.PORT ?? process.env.DEMO_PORT ?? 3847);
const HOST = process.env.HOST ?? '0.0.0.0';
/** Hosted default: our original generated fixture (see scripts/gen-demo-song.ts). */
const DEFAULT_SONG = process.env.DEMO_SONG_ID ?? 'song_5c0d7b45538b';

/** Fresh instance (empty/ephemeral data dir): seed the committed demo song graph. */
async function seedDemoSong(): Promise<void> {
  await mkdir(config.dataDir, { recursive: true });
  const dest = path.join(config.songsDir, DEFAULT_SONG);
  try {
    await access(path.join(dest, 'graph.json'));
    return;
  } catch {
    await cp(SEED_DIR, dest, { recursive: true });
  }
}

async function loadDemoFallback(): Promise<SongProcessingResult | null> {
  try {
    await access(DEMO_RESULT);
    return JSON.parse(await readFile(DEMO_RESULT, 'utf8')) as SongProcessingResult;
  } catch {
    return null;
  }
}

function json(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const MAX_BODY_BYTES = 1_000_000;

async function readBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks);
  if (raw.length > MAX_BODY_BYTES) throw new Error('Request body too large');
  const text = raw.toString('utf8');
  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const optNum = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const opts = (body: Record<string, unknown>): PrepareOptions => {
  const profile = body.profile;
  const maxDifficulty = optNum(body.maxDifficulty);
  const maxCapo = optNum(body.maxCapo);
  const tempoFactor = optNum(body.preferredTempoFactor);
  return {
    level: parseSkillLevel(typeof body.level === 'string' ? body.level : undefined),
    avoidBarreChords: body.avoidBarreChords === true,
    ...(profile !== undefined && typeof profile === 'object' && profile !== null
      ? { profile: profile as PlayerProfileInput }
      : {}),
    ...(maxDifficulty !== undefined ? { maxDifficulty } : {}),
    ...(maxCapo !== undefined ? { maxCapo } : {}),
    ...(tempoFactor !== undefined ? { preferredTempoFactor: clampTempoFactor(tempoFactor) } : {}),
    ...(body.prioritizeFidelity === true ? { prioritizeFidelity: true } : {}),
  };
};

/** Song id from body or query; falls back to the hosted demo song. */
function songIdOf(req: IncomingMessage, body: Record<string, unknown>): string {
  if (typeof body.songId === 'string' && body.songId.length > 0) return body.songId;
  return new URL(req.url ?? '/', 'http://x').searchParams.get('songId') ?? DEFAULT_SONG;
}

export function createDemoServer(): Server {
  return createServer(handler);
}

const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const url = (req.url ?? '/').split('?')[0]!;
  try {
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(await readFile(HTML, 'utf8'));
      return;
    }
    if (url === '/app.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(await readFile(APP_JS, 'utf8'));
      return;
    }

    if (url === '/health' && req.method === 'GET') {
      json(res, 200, { ok: true, service: 'guitar-webmcp' });
      return;
    }

    if (url === '/api/demo' && req.method === 'GET') {
      const demo = await loadDemoFallback();
      json(res, demo ? 200 : 404, demo ?? { error: 'No demo artifact' });
      return;
    }

    // --- deterministic WebMCP-backed API (no Gemini agents) ---

    if (url === '/api/state' && req.method === 'GET') {
      const songId = new URL(req.url ?? '/', 'http://x').searchParams.get('songId') ?? DEFAULT_SONG;
      const graph = await loadGraph(songId);
      json(res, 200, {
        songId,
        title: graph.metadata.title ?? songId,
        artist: graph.metadata.artist,
        analysisAvailable: true,
        analysis: summarizeAnalysis(graph),
        availableSections: listSections(graph),
      });
      return;
    }

    if (url === '/api/song/load-link' && req.method === 'POST') {
      const body = await readBody(req);
      if (typeof body.url !== 'string' || body.url.trim().length === 0) {
        json(res, 400, { error: 'url is required' });
        return;
      }
      const result = await loadSongFromLink(body.url, {
        analyze: body.analyze !== false,
        rightsConfirmed: body.rightsConfirmed === true,
      });
      json(res, 200, result);
      return;
    }

    // --- agent research (evidence fusion) ---

    if (url === '/api/research/begin' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await beginSongResearch({
        ...(typeof body.title === 'string' && body.title.length > 0 && { title: body.title }),
        ...(typeof body.artist === 'string' && body.artist.length > 0 && { artist: body.artist }),
        ...(typeof body.spotifyId === 'string' && body.spotifyId.length > 0 && { spotifyId: body.spotifyId }),
        ...(typeof body.album === 'string' && body.album.length > 0 && { album: body.album }),
        ...(typeof body.durationSeconds === 'number' && { durationSeconds: body.durationSeconds }),
        ...(body.refresh === true && { refresh: true }),
      });
      json(res, 200, { ...compactResearchStatus(result.session, result.resolution), suggestedQueries: result.suggestedQueries, musicBrainz: result.musicBrainz ?? null });
      return;
    }

    if (url === '/api/research/evidence' && req.method === 'POST') {
      const body = await readBody(req);
      const result = await submitSongEvidence(body);
      json(res, 200, { added: result.added, ...compactResearchStatus(result.session, result.resolution) });
      return;
    }

    if (url === '/api/research/status' && req.method === 'GET') {
      const session = getCurrentResearchSession();
      if (session === null) {
        json(res, 200, { active: false });
        return;
      }
      const { session: s, resolution } = getResearchStatus();
      json(res, 200, { active: true, ...compactResearchStatus(s, resolution) });
      return;
    }

    if (url === '/api/research/resolve' && req.method === 'POST') {
      const body = await readBody(req);
      json(res, 200, await resolveResearchedSong({ allowWarnings: body.allowWarnings === true }));
      return;
    }

    // --- licensed (Jamendo) catalog ---

    if (url === '/api/licensed/search' && req.method === 'POST') {
      const body = await readBody(req);
      const tracks = await searchLicensedTracks({
        ...(typeof body.title === 'string' && body.title.length > 0 && { title: body.title }),
        ...(typeof body.artist === 'string' && body.artist.length > 0 && { artist: body.artist }),
        ...(typeof body.query === 'string' && body.query.length > 0 && { query: body.query }),
      });
      json(res, 200, { tracks });
      return;
    }

    if (url === '/api/licensed/load' && req.method === 'POST') {
      const body = await readBody(req);
      if (typeof body.trackId !== 'string' || body.trackId.length === 0) {
        json(res, 400, { error: 'trackId is required' });
        return;
      }
      const result = await loadLicensedTrack(body.trackId);
      json(res, 200, result);
      return;
    }

    if (url === '/api/analyze' && req.method === 'POST') {
      const body = await readBody(req);
      const songId = songIdOf(req, body);
      const graph = await loadGraph(songId);
      json(res, 200, { songId, ...summarizeAnalysis(graph), sections: listSections(graph) });
      return;
    }

    if (url === '/api/arrangement' && req.method === 'POST') {
      const body = await readBody(req);
      const songId = songIdOf(req, body);
      const o = opts(body);
      if (body.explain === true) {
        json(res, 200, await explainGuitarVersion(songId, o));
        return;
      }
      if (body.diagnose === true) {
        json(res, 200, await diagnoseArrangement(songId, o));
        return;
      }
      if (body.detail === true) {
        json(res, 200, await loadArrangementDetail(songId, o));
        return;
      }
      if (body.practiceSession === true) {
        const minutes = optNum(body.minutes);
        json(
          res,
          200,
          await buildSession(songId, {
            ...o,
            ...(typeof body.section === 'string' && body.section.trim().length > 0 && { section: body.section }),
            ...(minutes !== undefined && minutes > 0 && { minutes }),
            ...(optNum(body.tempoFactor) !== undefined && { tempoFactor: clampTempoFactor(optNum(body.tempoFactor)) }),
            ...(typeof body.loop === 'boolean' && { loop: body.loop }),
            ...(typeof body.metronome === 'boolean' && { metronome: body.metronome }),
            ...(optNum(body.countInBars) !== undefined && { countInBars: Math.min(2, Math.max(0, Math.round(optNum(body.countInBars)!))) }),
          }),
        );
        return;
      }
      if (body.lesson === true) {
        const minutes = optNum(body.minutes);
        json(res, 200, await createPracticePlan(songId, { ...o, ...(minutes !== undefined && minutes > 0 ? { minutes } : {}) }));
        return;
      }
      json(res, 200, await compileGuitarVersion(songId, o));
      return;
    }

    // validate/normalize a player profile without compiling (stateless server)
    if (url === '/api/player/profile' && req.method === 'POST') {
      const body = await readBody(req);
      const profile = mergeProfile(body, undefined);
      json(res, 200, {
        profile,
        knownChordCount: Object.keys(profile.knownChords).length,
        hasDetail: Object.keys(profile.knownChords).length > 0 || !profile.barreChords.comfortable,
      });
      return;
    }

    if (url === '/api/levels' && (req.method === 'GET' || req.method === 'POST')) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const profile = body.profile;
      json(res, 200, {
        levels: await compareGuitarLevels(
          songIdOf(req, body),
          typeof profile === 'string' ? (JSON.parse(profile) as PlayerProfileInput) : (profile as PlayerProfileInput | undefined),
        ),
      });
      return;
    }

    if (url === '/api/process' && req.method === 'POST') {
      // Legacy autonomous-agent path (Gemini + LangGraph). Kept for the CLI
      // workflow; the WebMCP path uses the deterministic endpoints above.
      const body = await readBody(req);
      const songId = typeof body.songId === 'string' ? body.songId : DEFAULT_SONG;
      const skillLevel = parseSkillLevel(typeof body.level === 'string' ? body.level : undefined);
      try {
        const result = await runSongProcessing(songId, { skillLevel });
        if (songId === DEFAULT_SONG && result.status === 'COMPLETED') {
          await mkdir(DEMO_DIR, { recursive: true });
          await writeFile(DEMO_RESULT, JSON.stringify(result, null, 2) + '\n');
        }
        json(res, 200, result);
      } catch (err) {
        const fallback = await loadDemoFallback();
        if (fallback !== null) {
          res.writeHead(200, { 'Content-Type': 'application/json', 'X-Demo-Fallback': 'true' });
          res.end(JSON.stringify({ ...fallback, _demoFallback: true }));
          return;
        }
        json(res, 500, { error: (err as Error).message });
      }
      return;
    }

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    json(res, 500, { error: (err as Error).message });
  }
};

// Only listen when run directly (not under test imports).
const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  await seedDemoSong();
  createDemoServer().listen(PORT, HOST, () => {
    console.error(`Demo UI: http://localhost:${PORT} (listening on ${HOST})`);
  });
}
