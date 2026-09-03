import { AppError } from '../errors/app-error.js';
import { config } from '../config/env.js';
import { LocalSongGraphRepository } from '../repositories/song-graph-repository.js';
import type { SongGraph } from '../domain/music/song-graph.js';
import { findShape } from '../domain/guitar/chord-shape.js';
import { SKILL_PRESETS, parseSkillLevel, type SkillLevel } from '../domain/skill/skill-preset.js';
import { buildBaseArrangement } from '../engines/arrangement/build-base-arrangement.js';
import { computeDifficulty } from '../engines/difficulty/arrangement-difficulty.js';
import { computeFidelity } from '../engines/fidelity/arrangement-fidelity.js';
import {
  computePlayerDifficulty,
  arrangementDiagnostics,
  type PlayerDifficultyScore,
} from '../engines/difficulty/player-difficulty.js';
import {
  searchArrangements,
  selectForPlayer,
  buildPlayerLadder,
  candidateKey,
  type SearchOptions,
} from '../engines/arrangement/candidate-search.js';
import { explainArrangement } from '../engines/arrangement/explain-arrangement.js';
import { buildLessonPlan } from '../engines/arrangement/lesson-plan.js';
import { buildPracticeSession, type PracticeSession } from '../domain/practice/practice-session.js';
import type { GuitarArrangement } from '../domain/arrangement/arrangement.js';
import { defaultProfile, mergeProfile, presetProfile, type PlayerProfile, type PlayerProfileInput } from '../domain/player/player-profile.js';

/**
 * Deterministic song → playable-arrangement pipeline shared by the CLI, the
 * web API, and WebMCP tool callbacks. No LLM agents: the browser agent (or
 * the human) supplies the decisions this pipeline would otherwise ask Gemini.
 * Selection is player-aware: maximize fidelity subject to the player's
 * difficulty target.
 */
export interface PrepareOptions {
  level: SkillLevel;
  /** Prefer candidates with no barre chords (falls back if none exist). */
  avoidBarreChords?: boolean;
  /** Detailed player profile; overrides coarse preset assumptions. */
  profile?: PlayerProfileInput;
  /** Extra compile constraints (all optional). */
  maxDifficulty?: number;
  maxCapo?: number;
  preferredTempoFactor?: number;
  prioritizeFidelity?: boolean;
}

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
  /** Present for research-derived graphs: how exact section timing is. */
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

export interface PlayedSoundingPair {
  /** What the player grips, e.g. "D". */
  played: string;
  /** What it sounds like, e.g. "Ab". */
  sounding: string;
}

export interface CompiledVersion {
  level: SkillLevel;
  capo: number;
  chords: string[];
  /** Played shape vs sounding harmony — proves capo optimization preserves the song. */
  mapping: PlayedSoundingPair[];
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
  /** Two confidence axes (#70): fidelity is fidelity to the INPUT graph; this
   * is how much we trust the graph itself. Present for research/hybrid songs. */
  sourceConfidence?: {
    origin: 'RESEARCH_FUSION' | 'HYBRID';
    harmonyConfidence: number;
    timingPrecision: string;
  };
}

const chordLabel = (chord: { root: string; quality: string }): string =>
  `${chord.root}${chord.quality === 'minor' ? 'm' : ''}`;

/** Unique played→sounding pairs in first-appearance order. */
function playedSoundingMapping(arrangement: GuitarArrangement): PlayedSoundingPair[] {
  const seen = new Set<string>();
  const mapping: PlayedSoundingPair[] = [];
  for (const event of arrangement.chords) {
    if (seen.has(event.shapeName)) continue;
    seen.add(event.shapeName);
    mapping.push({ played: event.shapeName, sounding: chordLabel(event.chord) });
  }
  return mapping;
}

export interface PracticePlanStep {
  step: number;
  instruction: string;
}

const graphRepo = new LocalSongGraphRepository(config.songsDir);

const beatToMs = (graph: SongGraph, beat: number): number => {
  const hit = graph.beats.find((b) => b.beat === beat);
  if (hit !== undefined) return hit.timeMs;
  return Math.round((beat / graph.global.bpm) * 60_000);
};

export async function loadGraph(songId: string): Promise<SongGraph> {
  try {
    return await graphRepo.load(songId);
  } catch {
    throw new AppError('FILE_NOT_FOUND', `No analysis for song ${songId}`);
  }
}

const barreCount = (arr: GuitarArrangement): number =>
  arr.chords.filter((c) => findShape(c.shapeName)?.barre !== undefined).length;

const uniqueShapes = (arr: GuitarArrangement): string[] => [...new Set(arr.chords.map((c) => c.shapeName))];

export function listSections(graph: SongGraph): SectionTime[] {
  return graph.sections
    .filter((s) => s.type !== 'UNKNOWN')
    .map((s, i) => ({
      type: s.type,
      index: i,
      startMs: beatToMs(graph, s.startBeat),
      endMs: beatToMs(graph, s.endBeat),
    }));
}

export function summarizeAnalysis(graph: SongGraph): AnalysisSummary {
  const chordCounts = new Map<string, number>();
  for (const c of graph.harmony.chords) {
    const label = `${c.root}${c.quality === 'minor' ? 'm' : ''}`;
    chordCounts.set(label, (chordCounts.get(label) ?? 0) + 1);
  }
  // full harmonic vocabulary of the resolved graph (most-used first) — the UI
  // truncates visually with "+N", the data itself stays complete
  const mainChords = [...chordCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label]) => label);
  const avgConfidence =
    graph.harmony.chords.reduce((sum, c) => sum + c.confidence, 0) / (graph.harmony.chords.length || 1);
  return {
    tempoBpm: Math.round(graph.global.bpm * 10) / 10,
    meter: `${graph.global.timeSignature.numerator}/${graph.global.timeSignature.denominator}`,
    ...(graph.global.key !== undefined && { key: graph.global.key }),
    sections: [...new Set(listSections(graph).map((s) => s.type))],
    confidence: Math.round(graph.confidence.overall * 100) / 100,
    ...(graph.timingPrecision !== undefined && { timingPrecision: graph.timingPrecision }),
    ...(graph.provenance?.origin !== undefined && { origin: graph.provenance.origin }),
    harmony: { coverage: Math.round(avgConfidence * 100) / 100, mainChords },
  };
}

interface Prepared {
  graph: SongGraph;
  base: GuitarArrangement;
  /** Resolved profile: detailed when the caller supplied one, else BEGINNER default. */
  profile: PlayerProfile;
  /** True when the caller supplied profile detail beyond the preset. */
  detailed: boolean;
  candidates: GuitarArrangement[];
  ladder: Array<{ level: SkillLevel; arrangement: GuitarArrangement; constraintsSatisfied: boolean }>;
}

const preparedCache = new Map<string, Prepared>();

const profileCacheKey = (profile: PlayerProfile): string =>
  `${profile.preset ?? '-'}|${Object.entries(profile.knownChords).map(([k, v]) => `${k}${Math.round(v.mastery * 9)}`).sort().join(',')}|${profile.barreChords.comfortable ? 1 : 0}${Math.round(profile.barreChords.mastery * 9)}|${profile.comfortableTempoBpm ?? '-'}|${profile.practicePreferences.avoidBarreChords ? 1 : 0}`;

const SEARCH_OPTIONS: SearchOptions = { beamWidth: 12, maxDepth: 3, maxCandidates: 50 };

/**
 * Search + per-level ladder, cached per song+profile (player changes must
 * never invalidate the music-analysis cache — see the layered cache design).
 */
async function prepare(songId: string, profileInput?: PlayerProfileInput): Promise<Prepared> {
  const baseProfile = defaultProfile('BEGINNER');
  const profile = profileInput !== undefined ? mergeProfile(profileInput, baseProfile) : baseProfile;
  const key = `${songId}:${profileCacheKey(profile)}`;
  const hit = preparedCache.get(key);
  if (hit) return hit;

  const graph = await loadGraph(songId);
  const base = buildBaseArrangement(graph);
  base.difficulty = computeDifficulty({ arrangement: base, song: graph });
  base.fidelity = computeFidelity({ arrangement: base, original: graph });

  const candidates = searchArrangements(base, graph, profile, SEARCH_OPTIONS);
  const ladder = buildPlayerLadder(candidates, base, graph, profileInput !== undefined ? profile : undefined);

  const prepared: Prepared = { graph, base, profile, detailed: profileInput !== undefined, candidates, ladder };
  preparedCache.set(key, prepared);
  return prepared;
}

/** Profile for scoring a rung: the detailed one if given, else that level's preset. */
const rungProfile = (prepared: Prepared, level: SkillLevel): PlayerProfile =>
  prepared.detailed ? prepared.profile : presetProfile(level);

/** Resolve the rung for a level, then apply extra explicit constraints. */
function selectRung(prepared: Prepared, options: PrepareOptions): {
  selected: GuitarArrangement;
  constraintsSatisfied: boolean;
} {
  const { graph, candidates } = prepared;
  const profile = rungProfile(prepared, options.level);
  let target = SKILL_PRESETS[options.level].targetDifficulty;

  const eligible = candidates.filter((c) => {
    const cost = computePlayerDifficulty(c, profile, graph).playerDifficulty;
    if (cost > target) return false;
    if (options.maxDifficulty !== undefined && c.difficulty !== undefined && c.difficulty.total > options.maxDifficulty) return false;
    if (options.maxCapo !== undefined && c.tuning.capo > options.maxCapo) return false;
    if (options.preferredTempoFactor !== undefined && c.tempoFactor < options.preferredTempoFactor - 0.001) return false;
    if (options.avoidBarreChords === true && barreCount(c) > 0 && candidates.some((x) => barreCount(x) === 0)) return false;
    return true;
  });

  if (eligible.length === 0) {
    // nothing meets the constraints — closest available, honestly reported
    const easiest = [...candidates].sort(
      (a, b) =>
        computePlayerDifficulty(a, profile, graph).playerDifficulty -
          computePlayerDifficulty(b, profile, graph).playerDifficulty || a.id.localeCompare(b.id),
    )[0]!;
    return { selected: easiest, constraintsSatisfied: false };
  }

  const mode = options.level === 'BEGINNER' ? 'easiest' : 'faithful';
  const objective = (c: GuitarArrangement): number =>
    (options.prioritizeFidelity === true ? 0 : computePlayerDifficulty(c, profile, graph).playerDifficulty * 0.08) -
    (c.fidelity?.total ?? 0);
  const tempoFirst = [...eligible].sort((a, b) => {
    if (mode === 'faithful' && Math.abs(b.tempoFactor - a.tempoFactor) > 0.001) return b.tempoFactor - a.tempoFactor;
    const obj = objective(a) - objective(b);
    return Math.abs(obj) > 0.001 ? obj : a.id.localeCompare(b.id);
  });
  const selected = tempoFirst[0]!;
  const satisfied = computePlayerDifficulty(selected, profile, graph).playerDifficulty <= target;
  return { selected, constraintsSatisfied: satisfied };
}

const toComparison = (
  entry: { level: SkillLevel; arrangement: GuitarArrangement; constraintsSatisfied?: boolean },
  graph: SongGraph,
  profile: PlayerProfile | undefined,
): LevelComparison => ({
  level: entry.level,
  difficulty: round(entry.arrangement.difficulty?.total ?? 0),
  playerDifficulty: round(
    computePlayerDifficulty(entry.arrangement, profile ?? presetProfile(entry.level), graph).playerDifficulty,
  ),
  fidelity: round(entry.arrangement.fidelity?.total ?? 1),
  capo: entry.arrangement.tuning.capo,
  chords: uniqueShapes(entry.arrangement),
  barreChords: barreCount(entry.arrangement),
  tempoFactor: entry.arrangement.tempoFactor,
});

/** Player-specific "why this fits you" lines, all from deterministic data. */
function playerReasons(prepared: Prepared, level: SkillLevel, selected: GuitarArrangement): string[] {
  return computePlayerDifficulty(selected, rungProfile(prepared, level), prepared.graph).reasons;
}

export async function compileGuitarVersion(songId: string, options: PrepareOptions): Promise<CompiledVersion> {
  const level = parseSkillLevel(options.level);
  const prepared = await prepare(songId, options.profile);
  const { selected, constraintsSatisfied } = selectRung(prepared, { ...options, level });
  const explanation = explainArrangement(prepared.base, selected);
  const origin = prepared.graph.provenance?.origin;
  const sourceConfidence =
    origin === 'RESEARCH_FUSION' || origin === 'HYBRID'
      ? {
          origin,
          harmonyConfidence: prepared.graph.confidence.chord ?? prepared.graph.confidence.overall,
          timingPrecision: prepared.graph.timingPrecision ?? 'UNKNOWN',
        }
      : undefined;

  return {
    level,
    capo: selected.tuning.capo,
    chords: uniqueShapes(selected),
    mapping: playedSoundingMapping(selected),
    difficultyBefore: round(prepared.base.difficulty?.total ?? 0),
    difficultyAfter: round(selected.difficulty?.total ?? 0),
    playerDifficulty: round(computePlayerDifficulty(selected, rungProfile(prepared, level), prepared.graph).playerDifficulty),
    fidelity: round(selected.fidelity?.total ?? 1),
    tempoFactor: selected.tempoFactor,
    tempoBpm: Math.round(prepared.graph.global.bpm * selected.tempoFactor * 10) / 10,
    barreChordCount: barreCount(selected),
    changes: [...explanation.changes.map((c) => c.description), ...playerReasons(prepared, level, selected)],
    constraintsSatisfied,
    ladder: prepared.ladder.map((e) => toComparison(e, prepared.graph, prepared.detailed ? prepared.profile : undefined)),
    ...(sourceConfidence !== undefined && { sourceConfidence }),
  };
}

export async function compareGuitarLevels(songId: string, profileInput?: PlayerProfileInput): Promise<LevelComparison[]> {
  const prepared = await prepare(songId, profileInput);
  return prepared.ladder.map((e) => toComparison(e, prepared.graph, prepared.detailed ? prepared.profile : undefined));
}

/** Full arrangement objects (for practice audio rendering etc.), not summaries. */
export async function loadArrangements(
  songId: string,
  profileInput?: PlayerProfileInput,
): Promise<{
  graph: SongGraph;
  base: GuitarArrangement;
  profile: PlayerProfile;
  ladder: Array<{ level: SkillLevel; arrangement: GuitarArrangement; constraintsSatisfied: boolean }>;
}> {
  const prepared = await prepare(songId, profileInput);
  return { graph: prepared.graph, base: prepared.base, profile: prepared.profile, ladder: prepared.ladder };
}

/** Why is this arrangement easy/hard for this specific player? */
export async function diagnoseArrangement(
  songId: string,
  options: PrepareOptions,
): Promise<PlayerDifficultyScore & { capo: number; chords: string[]; effectiveBpm: number; knownChords: string[]; unfamiliarChords: string[]; barreChords: string[] }> {
  const level = parseSkillLevel(options.level);
  const prepared = await prepare(songId, options.profile);
  const { selected } = selectRung(prepared, { ...options, level });
  return {
    ...arrangementDiagnostics(selected, rungProfile(prepared, level), prepared.graph),
    capo: selected.tuning.capo,
    chords: uniqueShapes(selected),
  };
}

export async function explainGuitarVersion(songId: string, options: PrepareOptions): Promise<{
  difficultyBefore: number;
  difficultyAfter: number;
  playerDifficulty: number;
  fidelity: number;
  changes: string[];
}> {
  const level = parseSkillLevel(options.level);
  const prepared = await prepare(songId, options.profile);
  const { selected } = selectRung(prepared, { ...options, level });
  const explanation = explainArrangement(prepared.base, selected);
  return {
    difficultyBefore: round(prepared.base.difficulty?.total ?? 0),
    difficultyAfter: round(selected.difficulty?.total ?? 0),
    playerDifficulty: round(computePlayerDifficulty(selected, rungProfile(prepared, level), prepared.graph).playerDifficulty),
    fidelity: round(selected.fidelity?.total ?? 1),
    changes: [...explanation.changes.map((c) => c.description), ...playerReasons(prepared, level, selected)],
  };
}

export async function createPracticePlan(
  songId: string,
  options: PrepareOptions & { minutes?: number },
): Promise<{ steps: PracticePlanStep[] }> {
  const level = parseSkillLevel(options.level);
  const prepared = await prepare(songId, options.profile);
  const { selected } = selectRung(prepared, { ...options, level });
  const steps = buildLessonPlan(selected).map((s) => ({ step: s.step, instruction: s.instruction }));
  return { steps };
}

const round = (n: number): number => Math.round(n * 100) / 100;
export { candidateKey };

// --- practice studio: full arrangement detail (exact shapes for synth) ---
// --- practice studio: full arrangement detail (exact shapes for synth) ---

export interface ArrangementChordDetail {
  shape: string;
  sounding: string;
  startBeat: number;
  durationBeats: number;
}

export interface SectionBeats {
  type: string;
  index: number;
  startBeat: number;
  endBeat: number;
}

export interface ArrangementDetail {
  songId: string;
  level: SkillLevel;
  capo: number;
  tempoFactor: number;
  tempoBpm: number;
  /** Seconds per graph beat at tempoFactor 1 (client scales by its tempo). */
  beatSec: number;
  meterNumerator: number;
  /** Open-string MIDI tunings, string 1 (high E) first. */
  openStrings: number[];
  sections: SectionBeats[];
  chords: ArrangementChordDetail[];
}

/**
 * Exact playable positions for the Practice Studio: real shape events with
 * beat timing. The browser synthesizes from THESE pitches — never from
 * chord labels.
 */
export async function loadArrangementDetail(songId: string, options: PrepareOptions): Promise<ArrangementDetail> {
  const level = parseSkillLevel(options.level);
  const prepared = await prepare(songId, options.profile);
  const { selected } = selectRung(prepared, { ...options, level });
  const beats = prepared.graph.beats;
  const last = beats[beats.length - 1];
  const beatSec = last !== undefined && last.beat > 0 ? last.timeMs / 1000 / last.beat : 60 / prepared.graph.global.bpm;
  return {
    songId,
    level,
    capo: selected.tuning.capo,
    tempoFactor: selected.tempoFactor,
    tempoBpm: Math.round(prepared.graph.global.bpm * selected.tempoFactor * 10) / 10,
    beatSec: Math.round(beatSec * 10000) / 10000,
    meterNumerator: prepared.graph.global.timeSignature.numerator,
    openStrings: [...selected.tuning.tuning],
    sections: prepared.graph.sections
      .filter((s) => s.type !== 'UNKNOWN')
      .map((s, i) => ({ type: s.type, index: i, startBeat: s.startBeat, endBeat: s.endBeat })),
    chords: selected.chords.map((c) => ({
      shape: c.shapeName,
      sounding: chordLabel(c.chord),
      startBeat: c.startBeat,
      durationBeats: c.durationBeats,
    })),
  };
}

/** Deterministic practice session for a section and requested minutes. */
export async function buildSession(
  songId: string,
  options: PrepareOptions & {
    section?: string;
    minutes?: number;
    tempoFactor?: number;
    loop?: boolean;
    metronome?: boolean;
    countInBars?: number;
  },
): Promise<PracticeSession> {
  const level = parseSkillLevel(options.level);
  const prepared = await prepare(songId, options.profile);
  const { selected } = selectRung(prepared, { ...options, level });
  const sections = listSections(prepared.graph);
  const wanted = (options.section ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  const section =
    sections.find((s) => s.type === wanted) ??
    sections.find((s) => s.type === 'CHORUS') ??
    sections[0];
  if (section === undefined) throw new AppError('FILE_NOT_FOUND', 'Song has no practice sections');
  return buildPracticeSession({
    song: prepared.graph,
    arrangement: selected,
    profile: rungProfile(prepared, level),
    section: { type: section.type, index: section.index },
    ...(options.minutes !== undefined && { minutes: options.minutes }),
    ...(options.tempoFactor !== undefined && { tempoFactor: options.tempoFactor }),
    ...(options.loop !== undefined && { loopEnabled: options.loop }),
    ...(options.metronome !== undefined && { metronomeEnabled: options.metronome }),
    ...(options.countInBars !== undefined && { countInBars: options.countInBars }),
  });
}
