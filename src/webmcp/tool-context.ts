/// <reference lib="dom" />
/**
 * Shared application state + actions. The SAME state and functions power the
 * manual UI (buttons) and the WebMCP tool callbacks — one system, so every
 * agent action is visible to the human and vice versa.
 */
import { logActivity } from './tool-events.js';
import { mergeProfile, type PlayerProfile, type PlayerProfileInput } from '../domain/player/player-profile.js';
import { clampTempoFactor, TEMPO_STEPS } from '../domain/practice/practice-tempo.js';
import type { PracticeSession } from '../domain/practice/practice-session.js';
import type { PlayerDifficultyScore } from '../engines/difficulty/player-difficulty.js';

export { TEMPO_STEPS };

export type SkillLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export const SKILL_LEVELS: SkillLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];

export interface SectionTime {
  type: string;
  index: number;
  startMs: number;
  endMs: number;
}

export interface AnalysisSummary {
  tempoBpm: number;
  meter: string;
  key?: string;
  sections: string[];
  harmony: { coverage: number; mainChords: string[] };
  confidence: number;
  timingPrecision?: string;
  origin?: string;
}

export interface LevelComparison {
  level: SkillLevel;
  difficulty: number;
  playerDifficulty: number;
  fidelity: number;
  capo: number;
  chords: string[];
  barreChords: number;
  tempoFactor: number;
}

export interface CompiledVersion {
  level: SkillLevel;
  capo: number;
  chords: string[];
  /** Played shape vs sounding harmony — proves capo optimization preserves the song. */
  mapping: Array<{ played: string; sounding: string }>;
  difficultyBefore: number;
  difficultyAfter: number;
  playerDifficulty: number;
  fidelity: number;
  tempoFactor: number;
  tempoBpm: number;
  barreChordCount: number;
  changes: string[];
  constraintsSatisfied: boolean;
  ladder: LevelComparison[];
  /** Research-derived songs: trust in the SongGraph itself (two confidence axes). */
  sourceConfidence?: { origin: string; harmonyConfidence: number; timingPrecision: string };
}

export interface CompileConstraints {
  maxDifficulty?: number;
  maxCapo?: number;
  preferredTempoFactor?: number;
  prioritizeFidelity?: boolean;
}

export interface PracticeConfig {
  section: string | null;
  tempoFactor: number;
  loop: boolean;
  metronome: boolean;
  countInBars: number;
  minutes: number;
  /** True when the caller did not specify minutes and a sensible default was applied. */
  defaultApplied?: boolean;
}

/** What the studio needs to synthesize + display the practice preview. */
export interface ArrangementDetail {
  songId: string;
  level: SkillLevel;
  capo: number;
  tempoFactor: number;
  tempoBpm: number;
  beatSec: number;
  meterNumerator: number;
  openStrings: number[];
  sections: Array<{ type: string; index: number; startBeat: number; endBeat: number }>;
  chords: Array<{ shape: string; sounding: string; startBeat: number; durationBeats: number }>;
}

export interface PreviewInfo {
  ready: boolean;
  section: string | null;
  tempoFactor: number;
  durationSec: number;
  chords: string[];
  preparedAtMs: number;
  level: SkillLevel;
  capo: number;
  tempoBpm: number;
}

export interface LoadedSource {
  provider: 'YOUTUBE' | 'SPOTIFY' | 'DIRECT_AUDIO' | 'UNKNOWN';
  capability: 'ANALYZABLE' | 'RESEARCHABLE' | 'IDENTITY_ONLY' | 'PLAYBACK_ONLY' | 'UNSUPPORTED';
  title?: string;
  artworkUrl?: string;
  reason?: string;
  cached?: boolean;
}

/** Live agent-research board state (compact server payload). */
export interface ResearchStatus {
  active: boolean;
  status?: string;
  identity?: { title: string; artist: string; ambiguous?: boolean };
  resolved?: {
    key?: string;
    tempoBpm?: number;
    tempoExplanation?: string;
    meter?: string;
    meterAlternatives?: string[];
    harmony: Array<{ section: string; chords: string[]; confidence: number }>;
    mainChords: string[];
    sectionOrder: string[];
  };
  sources?: number;
  independentDomains?: number;
  confidence?: {
    identity: number;
    key: number;
    tempo: number;
    meter: number;
    harmony: number;
    structure: number;
    overallUsability: number;
  };
  conflicts?: Array<{ field: string; readings: unknown[]; families: number }>;
  hypotheses?: string[];
  gaps?: Array<{ field: string; reason: string; priority: string; suggestedQueries: string[] }>;
  suggestedQueries?: string[];
  warnings?: string[];
  evidence?: Array<{
    claimType: string;
    value: string;
    domain: string;
    url: string;
    kind: string;
    submittedBy: string;
    section?: string;
  }>;
  musicBrainz?: { recordingId: string; title: string; artist: string; ambiguous: boolean } | null;
}

export interface AppState {
  songId: string;
  title: string;
  level: SkillLevel;
  avoidBarreChords: boolean;
  analysis: AnalysisSummary | null;
  sections: SectionTime[];
  currentSection: SectionTime | null;
  arrangement: CompiledVersion | null;
  explanation: { difficultyBefore: number; difficultyAfter: number; fidelity: number; changes: string[] } | null;
  plan: { steps: Array<{ step: number; instruction: string }> } | null;
  loadedSource: LoadedSource | null;
  loadStatus: 'idle' | 'loading' | 'loaded';
  webmcp: 'unavailable' | 'connected' | 'error';
  /** Detailed player profile; null = coarse preset only. */
  playerProfile: PlayerProfile | null;
  practice: PracticeConfig;
  session: PracticeSession | null;
  /** Set once a preview has been rendered and is waiting for a human click. */
  preview: PreviewInfo | null;
  diagnostics: (PlayerDifficultyScore & { capo: number; chords: string[]; effectiveBpm: number; knownChords: string[]; unfamiliarChords: string[]; barreChords: string[] }) | null;
  research: ResearchStatus | null;
  /** High-level learning intent captured from profile/practice tool calls. */
  learningGoal: LearningGoalContext;
}

export interface LearningGoalContext {
  skillPreset?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  avoidBarreChords?: boolean;
  practiceMinutes?: number;
  prioritizeRecognizability?: boolean;
  preferredSection?: string;
}

export const state: AppState = {
  /** Empty until the server tells us the default song (DEMO_SONG_ID). */
  songId: '',
  title: '',
  level: 'BEGINNER',
  avoidBarreChords: false,
  analysis: null,
  sections: [],
  currentSection: null,
  arrangement: null,
  explanation: null,
  plan: null,
  loadedSource: null,
  loadStatus: 'idle',
  webmcp: 'unavailable',
  playerProfile: null,
  practice: { section: null, tempoFactor: 0.7, loop: true, metronome: true, countInBars: 1, minutes: 20 },
  session: null,
  preview: null,
  diagnostics: null,
  research: null,
  learningGoal: {},
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function onStateChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setState(patch: Partial<AppState>): void {
  Object.assign(state, patch);
  for (const listener of listeners) listener();
}

let apiBase = '';

/** Test/deploy hook: absolute origin for API calls (empty = same origin). */
export function setApiBase(base: string): void {
  apiBase = base;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok || data.error !== undefined) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// --- shared actions (UI buttons and WebMCP tools both call these) ---

export async function loadInitialState(): Promise<void> {
  const data = await api<{
    songId: string;
    title: string;
    analysis: AnalysisSummary;
    availableSections: SectionTime[];
  }>(`/api/state${state.songId.length > 0 ? `?songId=${encodeURIComponent(state.songId)}` : ''}`);
  setState({ songId: data.songId, title: data.title, analysis: data.analysis, sections: data.availableSections });
}

export async function loadSongLink(
  url: string,
  options: { rightsConfirmed?: boolean } = {},
): Promise<LoadedSource & { songId?: string; status: string; researchAvailable?: boolean; artist?: string }> {
  setState({ loadStatus: 'loading' });
  try {
    const data = await api<{
      songId?: string;
      source: { provider: LoadedSource['provider']; capability: LoadedSource['capability']; artworkUrl?: string; reason?: string };
      status: string;
      analysis?: AnalysisSummary;
      title?: string;
      artist?: string;
      cached?: boolean;
      researchAvailable?: boolean;
    }>('/api/song/load-link', { url, ...(options.rightsConfirmed === true && { rightsConfirmed: true }) });

    const loadedSource: LoadedSource = {
      provider: data.source.provider,
      capability: data.source.capability,
      ...(data.title !== undefined && { title: data.title }),
      ...(data.source.artworkUrl !== undefined && { artworkUrl: data.source.artworkUrl }),
      ...(data.source.reason !== undefined && { reason: data.source.reason }),
      ...(data.cached === true && { cached: true }),
    };
    setState({
      loadedSource,
      loadStatus: 'loaded',
      ...(data.songId !== undefined
        ? {
            songId: data.songId,
            title: data.title ?? data.songId,
            analysis: data.analysis ?? state.analysis,
            sections: [],
            arrangement: null,
            explanation: null,
            plan: null,
            currentSection: null,
          }
        : {
            // recognized but not analyzable (e.g. Spotify): the page now
            // presents THIS song — no stale analysis/arrangement from the
            // previous song may remain visible
            title: data.title ?? state.title,
            analysis: null,
            sections: [],
            arrangement: null,
            explanation: null,
            plan: null,
            currentSection: null,
            session: null,
            preview: null,
            diagnostics: null,
            research: null,
          }),
    });
    if (data.songId !== undefined && data.status === 'READY') {
      await loadInitialState(); // fill sections + full analysis for the new song
    }
    logActivity(
      data.status === 'READY'
        ? `Agent loaded a new song from a ${data.source.provider.toLowerCase()} link`
        : data.status === 'RESEARCHABLE'
          ? `Agent recognized "${data.title ?? 'the song'}" — starting agent research`
          : `Agent loaded ${data.source.provider.toLowerCase()} song info`,
    );
    return {
      ...loadedSource,
      ...(data.songId !== undefined && { songId: data.songId }),
      ...(data.researchAvailable === true && { researchAvailable: true }),
      ...(data.artist !== undefined && { artist: data.artist }),
      status: data.status,
    };
  } finally {
    if (state.loadStatus === 'loading') setState({ loadStatus: 'idle' });
  }
}

export async function analyzeSong(): Promise<AnalysisSummary> {
  const data = await api<AnalysisSummary>('/api/analyze', { songId: state.songId });
  setState({ analysis: data, sections: mergeSections(data) });
  logActivity('Agent analyzed the song');
  return data;
}

function mergeSections(analysis: AnalysisSummary): SectionTime[] {
  // Keep the timed instances we already have; only refresh when empty.
  return state.sections.length > 0
    ? state.sections
    : analysis.sections.map((type, index) => ({ type, index, startMs: 0, endMs: 0 }));
}

export async function compareGuitarLevels(): Promise<{ levels: LevelComparison[] }> {
  const data = await api<{ levels: LevelComparison[] }>(`/api/levels?songId=${encodeURIComponent(state.songId)}`, {
    songId: state.songId,
    ...(state.playerProfile !== null && { profile: profileToInput(state.playerProfile) }),
  });
  logActivity('Agent compared 3 arrangements');
  return data;
}

export async function compileVersion(
  level: SkillLevel,
  avoidBarreChords: boolean = state.avoidBarreChords,
  constraints?: CompileConstraints,
): Promise<CompiledVersion> {
  const data = await api<CompiledVersion>('/api/arrangement', {
    songId: state.songId,
    level,
    avoidBarreChords,
    ...(state.playerProfile !== null && { profile: profileToInput(state.playerProfile) }),
    ...(constraints?.maxDifficulty !== undefined && { maxDifficulty: constraints.maxDifficulty }),
    ...(constraints?.maxCapo !== undefined && { maxCapo: constraints.maxCapo }),
    ...(constraints?.preferredTempoFactor !== undefined && {
      preferredTempoFactor: constraints.preferredTempoFactor,
    }),
    ...(constraints?.prioritizeFidelity === true && { prioritizeFidelity: true }),
  });
  setState({
    arrangement: data,
    level: data.level,
    avoidBarreChords,
    explanation: {
      difficultyBefore: data.difficultyBefore,
      difficultyAfter: data.difficultyAfter,
      fidelity: data.fidelity,
      changes: data.changes,
    },
    // constraints changed the arrangement — a prepared preview is stale
    preview: null,
  });
  logActivity(
    data.constraintsSatisfied
      ? `Agent compiled a ${data.level.toLowerCase()} version (capo ${data.capo}, difficulty for you ${data.playerDifficulty})`
      : `Agent compiled the closest available ${data.level.toLowerCase()} version (constraints not fully met)`,
  );
  return data;
}

export async function explainVersion(): Promise<AppState['explanation']> {
  const data = await api<NonNullable<AppState['explanation']>>('/api/arrangement', {
    explain: true,
    songId: state.songId,
    level: state.level,
    avoidBarreChords: state.avoidBarreChords,
  });
  setState({ explanation: data });
  logActivity('Agent explained the arrangement');
  return data;
}

export function findSection(name: string): SectionTime | undefined {
  const wanted = name.trim().toUpperCase().replace(/\s+/g, '_');
  return state.sections.find((s) => s.type === wanted);
}

export function chooseSection(name: string): SectionTime {
  const section = findSection(name);
  if (section === undefined) {
    throw new Error(`Unknown section "${name}". Available: ${[...new Set(state.sections.map((s) => s.type))].join(', ')}`);
  }
  setState({ currentSection: section });
  logActivity(`Agent focused the ${section.type.toLowerCase()}`);
  return section;
}

export async function createPlan(minutes?: number): Promise<AppState['plan']> {
  const data = await api<NonNullable<AppState['plan']>>('/api/arrangement', {
    lesson: true,
    songId: state.songId,
    level: state.level,
    avoidBarreChords: state.avoidBarreChords,
    minutes,
  });
  setState({ plan: data });
  logActivity('Agent built a practice plan');
  return data;
}

export function setPlayerLevel(level: SkillLevel): SkillLevel {
  if (!SKILL_LEVELS.includes(level)) {
    throw new Error(`Invalid level "${level}". Use BEGINNER, INTERMEDIATE or ADVANCED.`);
  }
  // a coarse preset replaces any detailed profile: the agent made a new call
  setState({ level, playerProfile: null });
  logActivity(`Agent selected ${level.toLowerCase()} player level`);
  return level;
}

// --- player profile (detailed path) ---

export function profileToInput(profile: PlayerProfile): PlayerProfileInput {
  return {
    ...(profile.preset !== undefined ? { preset: profile.preset } : {}),
    knownChords: Object.fromEntries(Object.entries(profile.knownChords).map(([k, v]) => [k, v.mastery])),
    barreChords: { comfortable: profile.barreChords.comfortable, mastery: profile.barreChords.mastery },
    techniques: profile.techniques,
    practicePreferences: profile.practicePreferences,
    ...(profile.comfortableTempoBpm !== undefined ? { comfortableTempoBpm: profile.comfortableTempoBpm } : {}),
    ...(profile.maxPreferredFretSpan !== undefined ? { maxPreferredFretSpan: profile.maxPreferredFretSpan } : {}),
    ...(profile.preferredCapoMax !== undefined ? { preferredCapoMax: profile.preferredCapoMax } : {}),
  };
}

/** Set/merge the detailed player profile. Overrides the coarse preset. */
export function setPlayerProfile(input: PlayerProfileInput): PlayerProfile {
  const hasAny =
    (input.knownChords !== undefined && Object.keys(input.knownChords).length > 0) ||
    input.barreChords !== undefined ||
    input.techniques !== undefined ||
    input.practicePreferences !== undefined ||
    input.comfortableTempoBpm !== undefined ||
    input.maxPreferredFretSpan !== undefined ||
    input.preferredCapoMax !== undefined ||
    input.preset !== undefined;
  if (!hasAny) {
    throw new Error('Provide at least one profile field (knownChords, barreChords, comfortableTempoBpm, ...).');
  }
  const merged = mergeProfile(input, state.playerProfile ?? undefined);
  setState({
    playerProfile: merged,
    // a detailed profile overrides the coarse preset assumptions
    ...(merged.preset !== undefined && { level: merged.preset }),
    ...(merged.practicePreferences.avoidBarreChords !== state.avoidBarreChords && {
      avoidBarreChords: merged.practicePreferences.avoidBarreChords,
    }),
  });
  const known = Object.keys(merged.knownChords);
  logActivity(
    known.length > 0
      ? `Agent learned your skills: knows ${known.slice(0, 5).join(', ')}${!merged.barreChords.comfortable ? ', no barre chords yet' : ''}`
      : `Agent updated your player profile`,
  );
  // remember the goal context so later tools can act on it
  setState({
    learningGoal: {
      ...state.learningGoal,
      ...(merged.preset !== undefined && { skillPreset: merged.preset }),
      ...(merged.practicePreferences.avoidBarreChords && { avoidBarreChords: true }),
      ...(merged.practicePreferences.prioritizeRecognizability === true && { prioritizeRecognizability: true }),
    },
  });
  return merged;
}

export function getPlayerProfile(): PlayerProfile | { level: SkillLevel; note: string } {
  if (state.playerProfile !== null) return state.playerProfile;
  return { level: state.level, note: 'Only the coarse level is set; use set_player_profile for detail.' };
}

/** Diagnostics: why is this arrangement easy/hard for THIS player? */
export async function getArrangementDiagnostics(): Promise<NonNullable<AppState['diagnostics']>> {
  const data = await api<NonNullable<AppState['diagnostics']>>('/api/arrangement', {
    diagnose: true,
    songId: state.songId,
    level: state.level,
    avoidBarreChords: state.avoidBarreChords,
    ...(state.playerProfile !== null && { profile: profileToInput(state.playerProfile) }),
  });
  setState({ diagnostics: data });
  logActivity('Agent checked why this version fits your hands');
  return data;
}

// --- practice studio ---

export interface PracticeConfigInput {
  section?: string;
  tempoFactor?: number;
  loop?: boolean;
  metronome?: boolean;
  countInBars?: number;
  minutes?: number;
}

export function configurePractice(input: PracticeConfigInput): PracticeConfig {
  const patch: Partial<PracticeConfig> = {};
  if (input.section !== undefined) {
    const section = findSection(input.section);
    if (section === undefined) {
      throw new Error(`Unknown section "${input.section}". Available: ${[...new Set(state.sections.map((s) => s.type))].join(', ')}`);
    }
    patch.section = section.type;
    setState({ currentSection: section });
  }
  if (input.tempoFactor !== undefined) patch.tempoFactor = clampTempoFactor(input.tempoFactor);
  if (input.loop !== undefined) patch.loop = input.loop;
  if (input.metronome !== undefined) patch.metronome = input.metronome;
  if (input.countInBars !== undefined) patch.countInBars = Math.min(2, Math.max(0, Math.round(input.countInBars)));
  if (input.minutes !== undefined) patch.minutes = Math.min(60, Math.max(5, Math.round(input.minutes)));
  setState({ practice: { ...state.practice, ...patch }, preview: null });
  // track goal context + whether the session length was an assumed default
  setState({
    learningGoal: {
      ...state.learningGoal,
      ...(patch.minutes !== undefined && { practiceMinutes: patch.minutes }),
      ...(patch.section !== undefined && patch.section !== null && { preferredSection: patch.section }),
    },
  });
  logActivity(practiceActivityLine(patch));
  return { ...state.practice, defaultApplied: input.minutes === undefined };
}

function practiceActivityLine(patch: Partial<PracticeConfig>): string {
  if (patch.tempoFactor !== undefined) return `Agent slowed practice tempo to ${Math.round(patch.tempoFactor * 100)}%`;
  if (patch.section !== undefined && patch.section !== null)
    return `Agent set practice to the ${patch.section.toLowerCase().replace(/_/g, ' ')}`;
  if (patch.metronome !== undefined) return patch.metronome ? 'Agent turned the metronome on' : 'Agent turned the metronome off';
  if (patch.loop !== undefined) return patch.loop ? 'Agent turned looping on' : 'Agent turned looping off';
  if (patch.minutes !== undefined) return `Agent planned a ${patch.minutes}-minute session`;
  return 'Agent adjusted the practice session';
}

/** Build the deterministic session (steps sized to state.practice.minutes). */
export async function buildSessionPlan(): Promise<PracticeSession> {
  const p = state.practice;
  const data = await api<PracticeSession>('/api/arrangement', {
    practiceSession: true,
    songId: state.songId,
    level: state.level,
    avoidBarreChords: state.avoidBarreChords,
    ...(state.playerProfile !== null && { profile: profileToInput(state.playerProfile) }),
    ...(p.section !== null && { section: p.section }),
    minutes: p.minutes,
    tempoFactor: p.tempoFactor,
    loop: p.loop,
    metronome: p.metronome,
    countInBars: p.countInBars,
  });
  setState({ session: data });
  return data;
}

/** Full arrangement positions for the studio (exact shapes for synthesis). */
export async function fetchArrangementDetail(): Promise<ArrangementDetail> {
  return api<ArrangementDetail>('/api/arrangement', {
    detail: true,
    songId: state.songId,
    level: state.level,
    avoidBarreChords: state.avoidBarreChords,
    ...(state.playerProfile !== null && { profile: profileToInput(state.playerProfile) }),
  });
}

/**
 * Render the practice preview for the configured section + tempo. Prepared
 * audio is NOT played — the human clicks ▶ in the studio.
 */
export async function preparePracticePreview(): Promise<PreviewInfo> {
  const detail = await fetchArrangementDetail();
  const { renderStudioPreview } = await import('./studio-playback.js');
  const info = await renderStudioPreview(detail, state.practice);
  setState({ preview: info });
  logActivity(
    `Practice preview ready: ${info.section ?? 'song'} at ${Math.round(info.tempoFactor * 100)}% tempo (${info.durationSec.toFixed(0)}s)`,
  );
  return info;
}



// --- agent research (evidence fusion) ---

/**
 * NO-LINK HERO PATH: request a song by NAME. Establishes identity intent,
 * clears every stale song artifact, KEEPS the player profile, and starts (or
 * reuses) the compatible research session.
 */
export async function requestSong(input: {
  query?: string;
  title?: string;
  artist?: string;
  version?: string;
}): Promise<{ title: string; artist: string; reused: boolean; status?: string; research: ResearchStatus | null }> {
  const data = await api<{
    request: { identity: { title: string; artist: string } };
    reused?: boolean;
    status?: string;
    message?: string;
    brief?: Record<string, unknown>;
    musicBrainz?: { recordingId: string; title: string; artist: string; ambiguous: boolean } | null;
  }>('/api/song/request', input);

  // ambiguous title-only request: present it, start nothing
  if (data.status === 'IDENTITY_NEEDS_CONFIRMATION') {
    setState({ title: data.request.identity.title, analysis: null, sections: [], currentSection: null, arrangement: null, explanation: null, plan: null, session: null, preview: null, diagnostics: null, loadedSource: null, research: null });
    logActivity(`Agent asked about “${data.request.identity.title}” — recording identity needs confirmation`);
    return { title: data.request.identity.title, artist: '', reused: false, status: data.status, research: null };
  }

  const brief = (data.brief ?? {}) as {
    status?: string | undefined;
    understanding?: Record<string, number> | undefined;
    independentSources?: number | undefined;
    sources?: number | undefined;
    conflicts?: Array<{ field: string; readings: unknown[] }> | undefined;
    priorityGaps?: Array<{ field: string; reason: string; priority: string; suggestedQueries: string[] }> | undefined;
    suggestedQueries?: string[] | undefined;
    warnings?: string[] | undefined;
    hypotheses?: string[] | undefined;
  };
  const research: ResearchStatus = {
    active: true,
    identity: { title: data.request.identity.title, artist: data.request.identity.artist },
    musicBrainz: data.musicBrainz ?? null,
    ...(brief.status !== undefined && { status: brief.status }),
    ...(brief.sources !== undefined && { sources: brief.sources }),
    ...(brief.independentSources !== undefined && { independentDomains: brief.independentSources }),
    ...(brief.understanding !== undefined && {
      confidence: brief.understanding as NonNullable<ResearchStatus['confidence']>,
    }),
    ...(brief.conflicts !== undefined && {
      conflicts: brief.conflicts.map((c) => ({ field: c.field, readings: c.readings, families: 1 })),
    }),
    ...(brief.hypotheses !== undefined && { hypotheses: brief.hypotheses }),
    ...(brief.priorityGaps !== undefined && { gaps: brief.priorityGaps }),
    ...(brief.suggestedQueries !== undefined && { suggestedQueries: brief.suggestedQueries }),
    ...(brief.warnings !== undefined && { warnings: brief.warnings }),
  };
  setState({
    // identity intent is set — every artifact of the PREVIOUS song is stale
    songId: '',
    title: data.request.identity.title,
    analysis: null,
    sections: [],
    currentSection: null,
    arrangement: null,
    explanation: null,
    plan: null,
    session: null,
    preview: null,
    diagnostics: null,
    loadedSource: null,
    // the player profile deliberately SURVIVES the song change
    research,
  });
  logActivity(
    data.reused
      ? `Agent requested “${data.request.identity.title}” — existing research reused`
      : `Agent requested “${data.request.identity.title}” by name — research started, no link needed`,
  );
  return {
    title: data.request.identity.title,
    artist: data.request.identity.artist,
    reused: data.reused === true,
    research: state.research,
  };
}

export async function fetchResearchBrief(): Promise<Record<string, unknown>> {
  return api<Record<string, unknown>>('/api/research/brief');
}

export async function fetchSongBlueprint(): Promise<Record<string, unknown>> {
  return api<Record<string, unknown>>('/api/research/blueprint');
}

export async function validateBlueprint(): Promise<Record<string, unknown>> {
  return api<Record<string, unknown>>('/api/research/blueprint/validate');
}

export interface BeginResearchInput {
  title?: string;
  artist?: string;
  spotifyId?: string;
  refresh?: boolean;
}

export async function beginSongResearch(input: BeginResearchInput = {}): Promise<ResearchStatus> {
  const data = await api<ResearchStatus>('/api/research/begin', {
    ...(input.title !== undefined && input.title.length > 0 && { title: input.title }),
    ...(input.artist !== undefined && input.artist.length > 0 && { artist: input.artist }),
    ...(input.spotifyId !== undefined && input.spotifyId.length > 0 && { spotifyId: input.spotifyId }),
    ...(input.refresh === true && { refresh: true }),
  });
  setState({ research: data });
  const mb = data.musicBrainz;
  logActivity(
    mb !== undefined && mb !== null
      ? 'Agent began research — MusicBrainz identified the recording'
      : 'Agent began evidence-based research for this song',
  );
  return data;
}

export interface SongEvidenceInput {
  claimType?: string;
  value?: unknown;
  claims?: Array<Record<string, unknown>>;
  sourceUrl: string;
  sourceTitle?: string;
  sourceKind?: string;
  submittedBy?: 'WEBMCP_AGENT' | 'USER' | 'SYSTEM_PROVIDER';
  section?: string;
  chordRepresentation?: string;
  capo?: number;
  confidence?: number;
}

export async function submitSongEvidence(evidence: SongEvidenceInput): Promise<ResearchStatus & { added: boolean; addedCount: number }> {
  const data = await api<ResearchStatus & { added: boolean; addedCount: number }>('/api/research/evidence', evidence as unknown as Record<string, unknown>);
  setState({ research: data });
  const hostname = new URL(evidence.sourceUrl).hostname;
  if (data.added === false) logActivity(`Agent re-confirmed a known source (${hostname}) — no confidence change`);
  else if (Array.isArray(evidence.claims)) logActivity(`Agent submitted ${evidence.claims.length} facts from ${hostname}`);
  else if (typeof evidence.claimType === 'string') logActivity(`Agent submitted ${evidence.claimType.toLowerCase()} evidence from ${hostname}`);
  return data;
}

export async function fetchResearchStatus(): Promise<ResearchStatus> {
  const data = await api<ResearchStatus>('/api/research/status');
  setState({ research: data });
  return data;
}

export interface ResolveResearchResultClient {
  songId: string;
  resolved: boolean;
  origin: string;
  confidence: number;
  status: string;
  warnings: string[];
}

/** Fuse evidence into a SongGraph; from here the normal compile flow works. */
export async function resolveResearchedSong(options: { allowWarnings?: boolean } = {}): Promise<ResolveResearchResultClient> {
  const data = await api<ResolveResearchResultClient>('/api/research/resolve', {
    ...(options.allowWarnings === true && { allowWarnings: true }),
  });
  setState({
    songId: data.songId,
    loadedSource: null,
    research: state.research,
    arrangement: null,
    explanation: null,
    plan: null,
    session: null,
    preview: null,
    diagnostics: null,
    sections: [],
  });
  await loadInitialState();
  logActivity(`Research resolved into a playable song (song understanding ${Math.round(data.confidence * 100)}%)`);
  return data;
}

// --- licensed catalog (Jamendo) ---

export interface LicensedTrack {
  trackId: string;
  title: string;
  artist: string;
  durationSeconds: number;
  audiodownloadAllowed: boolean;
  licenseUrl?: string;
  sourceUrl: string;
}

export async function searchLicensedMusic(query: { title?: string; artist?: string; query?: string }): Promise<{ tracks: LicensedTrack[] }> {
  return api<{ tracks: LicensedTrack[] }>('/api/licensed/search', query);
}

export async function loadLicensedTrack(trackId: string): Promise<{ songId: string; analysis: AnalysisSummary }> {
  const data = await api<{ songId: string; status: string; analysis: AnalysisSummary }>('/api/licensed/load', { trackId });
  setState({
    songId: data.songId,
    loadedSource: null,
    analysis: null,
    sections: [],
    arrangement: null,
    explanation: null,
    plan: null,
    session: null,
    preview: null,
    diagnostics: null,
    research: null,
  });
  await loadInitialState();
  logActivity('Agent loaded a licensed track — full audio analysis available');
  return data;
}
