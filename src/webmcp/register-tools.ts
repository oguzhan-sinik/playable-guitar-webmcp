/// <reference lib="dom" />
/**
 * Native WebMCP registration: exposes the guitar-learning capabilities of this
 * page to any browser agent via `document.modelContext.registerTool`.
 * Gracefully no-ops in browsers without WebMCP.
 */
import {
  state,
  loadInitialState,
  loadSongLink,
  analyzeSong,
  compareGuitarLevels,
  compileVersion,
  explainVersion,
  chooseSection,
  createPlan,
  setPlayerLevel,
  setPlayerProfile,
  getPlayerProfile,
  getArrangementDiagnostics,
  configurePractice,
  preparePracticePreview,
  buildSessionPlan,
  beginSongResearch,
  submitSongEvidence,
  fetchResearchStatus,
  resolveResearchedSong,
  searchLicensedMusic,
  loadLicensedTrack,
  SKILL_LEVELS,
  type SkillLevel,
  type CompileConstraints,
} from './tool-context.js';
import {
  emptySchema,
  analyzeSongSchema,
  compileSchema,
  sectionSchema,
  planSchema,
  levelSchema,
  playerProfileSchema,
  practiceConfigSchema,
  practicePreviewSchema,
} from './schemas.js';
import { recordToolInvocation } from './tool-events.js';

export const TOOL_COUNT = 20;

export interface WebMcpRegistration {
  dispose(): void;
}

function requireLevel(value: unknown, fallback: SkillLevel): SkillLevel {
  const level = typeof value === 'string' ? (value.toUpperCase() as SkillLevel) : fallback;
  if (!SKILL_LEVELS.includes(level)) {
    throw new Error(`Invalid level "${String(value)}". Use BEGINNER, INTERMEDIATE or ADVANCED.`);
  }
  return level;
}

function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${what} is required.`);
  return value;
}

const READ_ONLY = { readOnlyHint: true } as const;

export function webMcpAvailable(): boolean {
  return typeof document !== 'undefined' && 'modelContext' in document && document.modelContext !== undefined;
}

export async function registerWebMcpTools(): Promise<WebMcpRegistration | null> {
  if (!webMcpAvailable()) return null;

  const controller = new AbortController();
  const { signal } = controller;

  const register = (tool: WebMcpTool): Promise<void> | void => {
    const execute = tool.execute.bind(tool);
    tool.execute = async (input) => {
      const startedAt = performance.now();
      try {
        return await execute(input);
      } finally {
        recordToolInvocation(tool.name, startedAt);
      }
    };
    return document.modelContext!.registerTool(tool, { signal });
  };

  await register({
    name: 'load_song_from_link',
    description:
      'Load a song into the guitar-learning application from a web URL. Use this when the user gives a YouTube, Spotify, or direct-audio link and wants to learn that song. The tool determines whether the source can be analyzed or is playback/metadata only, loads the song into the shared UI state, and returns the available next actions.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The song URL supplied by the user.' },
      },
      required: ['url'],
    },
    execute: async (input) => {
      const url = requireString(input.url, 'url');
      let result;
      try {
        result = await loadSongLink(url);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('RIGHTS_ATTESTATION_REQUIRED') || message.includes('permission or other lawful authorization')) {
          return {
            loaded: false,
            requiresHumanRightsConfirmation: true,
            note: 'The HUMAN must confirm rights in the page UI before external media can be processed. Agents may not assert this on their behalf. Point the human to the permission checkbox next to the link field.',
          };
        }
        throw err;
      }
      const analyzable = result.status === 'READY';
      const researchable = result.researchAvailable === true;
      return {
        ...(result.songId !== undefined && { songId: result.songId }),
        provider: result.provider,
        capability: result.capability,
        ...(result.title !== undefined && { title: result.title }),
        analysisReady: analyzable,
        researchAvailable: researchable,
        ...(result.reason !== undefined && { reason: result.reason }),
        nextSuggestedTools: analyzable
          ? ['analyze_song', 'compare_guitar_levels', 'set_player_profile', 'compile_guitar_version']
          : researchable
            ? ['begin_song_research']
            : [],
      };
    },
  });

  await register({
    name: 'get_guitar_app_state',
    description:
      'Get the currently loaded song, selected guitarist level, player profile, current arrangement, practice configuration, and preview readiness. Use this before deciding what guitar-learning action to take.',
    inputSchema: emptySchema,
    annotations: READ_ONLY,
    execute: async () => ({
      song: { id: state.songId, title: state.title },
      selectedLevel: state.level,
      playerProfileSet: state.playerProfile !== null,
      playerProfile: getPlayerProfile(),
      analysisAvailable: state.analysis !== null,
      analysis: state.analysis,
      arrangementAvailable: state.arrangement !== null,
      arrangement: state.arrangement,
      currentSection: state.currentSection?.type ?? null,
      availableSections: [...new Set(state.sections.map((s) => s.type))],
      practice: state.practice,
      practicePreviewReady: state.preview?.ready === true,
    }),
  });

  await register({
    name: 'analyze_song',
    description:
      "Analyze the current song's musical structure for guitar learning. Returns tempo, meter, key, chord summary, song sections, and analysis confidence.",
    inputSchema: analyzeSongSchema,
    execute: async () => analyzeSong(),
  });

  await register({
    name: 'compare_guitar_levels',
    description:
      "Compare playable guitar arrangements of the current song for Beginner, Intermediate, and Advanced players. Use this before selecting a level when the user's ability or preferences are uncertain.",
    inputSchema: emptySchema,
    annotations: READ_ONLY,
    execute: async () => compareGuitarLevels(),
  });

  await register({
    name: 'compile_guitar_version',
    description:
      'Compile the current song into a playable guitar arrangement for a specified skill level, honoring the player profile plus optional constraints. The compiler preserves musical fidelity while reducing physical guitar difficulty using capo selection, chord-shape optimization, rhythm simplification, tempo adaptation, and other deterministic transformations. Returns constraintsSatisfied=false with the closest available version when the constraints cannot be met.',
    inputSchema: compileSchema,
    execute: async (input) => {
      if (typeof input.level !== 'string') throw new Error('level is required.');
      const level = requireLevel(input.level, state.level);
      const avoidBarreChords = input.avoidBarreChords === true || (state.playerProfile?.practicePreferences.avoidBarreChords ?? false);
      const constraints: CompileConstraints = {};
      if (typeof input.maxDifficulty === 'number') constraints.maxDifficulty = input.maxDifficulty;
      if (typeof input.maxCapo === 'number') constraints.maxCapo = Math.round(input.maxCapo);
      if (typeof input.preferredTempoFactor === 'number') constraints.preferredTempoFactor = input.preferredTempoFactor;
      if (input.prioritizeFidelity === true) constraints.prioritizeFidelity = true;
      const compiled = await compileVersion(level, avoidBarreChords, constraints);
      if (typeof input.section === 'string' && input.section.trim().length > 0) {
        chooseSection(input.section);
      }
      return {
        level: compiled.level,
        capo: compiled.capo,
        chords: compiled.chords,
        playerDifficulty: compiled.playerDifficulty,
        absoluteDifficulty: compiled.difficultyAfter,
        fidelity: compiled.fidelity,
        tempoFactor: compiled.tempoFactor,
        constraintsSatisfied: compiled.constraintsSatisfied,
        tradeoffs: compiled.changes.slice(0, 5),
        ladder: compiled.ladder.map((l) => ({ level: l.level, capo: l.capo, difficulty: l.difficulty, playerDifficulty: l.playerDifficulty, fidelity: l.fidelity })),
      };
    },
  });

  await register({
    name: 'explain_guitar_version',
    description:
      'Explain why the currently selected guitar arrangement fits or does not fit this specific guitarist: what was preserved, what was simplified, and which player skills are involved.',
    inputSchema: emptySchema,
    annotations: READ_ONLY,
    execute: async () => explainVersion(),
  });

  await register({
    name: 'get_arrangement_diagnostics',
    description:
      'Inspect why the current arrangement is easy or difficult for this specific guitarist. Returns unfamiliar chords, barre usage, difficult transitions, tempo pressure, and the main contributors to player difficulty. Use after compiling to decide whether to compile again with stronger constraints.',
    inputSchema: emptySchema,
    annotations: READ_ONLY,
    execute: async () => getArrangementDiagnostics(),
  });

  await register({
    name: 'choose_learning_section',
    description:
      'Choose a section of the current song for the guitarist to practice. Use this when the user wants to start with the chorus, verse, bridge, or another recognizable section.',
    inputSchema: sectionSchema,
    execute: async (input) => {
      const name = requireString(input.section, 'section');
      const section = chooseSection(name);
      return {
        section: section.type,
        startSeconds: Math.round(section.startMs / 1000),
        endSeconds: Math.round(section.endMs / 1000),
      };
    },
  });

  await register({
    name: 'create_practice_plan',
    description:
      "Create a short guitar practice plan for the current arrangement and selected song section. Uses the player's skill level, chord difficulty, chord transitions, tempo, and song structure.",
    inputSchema: planSchema,
    execute: async (input) => {
      const minutes =
        typeof input.minutes === 'number' && Number.isInteger(input.minutes) && input.minutes >= 5 && input.minutes <= 60
          ? input.minutes
          : undefined;
      return createPlan(minutes);
    },
  });

  await register({
    name: 'set_player_level',
    description:
      "Set the guitarist's coarse ability level (BEGINNER, INTERMEDIATE, ADVANCED) for future arrangement and lesson decisions. For detail like specific known chords or barre comfort, prefer set_player_profile.",
    inputSchema: levelSchema,
    execute: async (input) => ({ level: setPlayerLevel(requireLevel(input.level, state.level)) }),
  });

  await register({
    name: 'set_player_profile',
    description:
      'Set detailed information about the guitarist’s current abilities and physical/practice preferences. Use this when the player explains which chords they know, whether barre chords are difficult, what tempo feels comfortable, or what guitar techniques they can perform. A detailed profile overrides the coarse skill level.',
    inputSchema: playerProfileSchema,
    execute: async (input) => {
      const profileInput: Record<string, unknown> = {};
      if (typeof input.preset === 'string') profileInput.preset = input.preset.toUpperCase();
      if (Array.isArray(input.knownChords)) {
        const knownChords: Record<string, number> = {};
        for (const label of input.knownChords) {
          if (typeof label === 'string' && label.trim().length > 0) knownChords[label.trim()] = 1;
        }
        profileInput.knownChords = knownChords;
      }
      if (input.barreChordsComfortable !== undefined) {
        profileInput.barreChords = { comfortable: input.barreChordsComfortable === true };
      }
      if (typeof input.comfortableTempoBpm === 'number') profileInput.comfortableTempoBpm = input.comfortableTempoBpm;
      if (typeof input.maxPreferredFretSpan === 'number') profileInput.maxPreferredFretSpan = input.maxPreferredFretSpan;
      if (typeof input.preferredCapoMax === 'number') profileInput.preferredCapoMax = input.preferredCapoMax;
      const preferences: Record<string, boolean> = {};
      if (typeof input.avoidBarreChords === 'boolean') preferences.avoidBarreChords = input.avoidBarreChords;
      if (typeof input.allowSlowerTempo === 'boolean') preferences.allowSlowerTempo = input.allowSlowerTempo;
      if (typeof input.prioritizeRecognizability === 'boolean') preferences.prioritizeRecognizability = input.prioritizeRecognizability;
      if (Object.keys(preferences).length > 0) profileInput.practicePreferences = preferences;

      const profile = setPlayerProfile(profileInput);
      return {
        saved: true,
        knownChords: Object.keys(profile.knownChords),
        barreChordsComfortable: profile.barreChords.comfortable,
        comfortableTempoBpm: profile.comfortableTempoBpm ?? null,
        level: profile.preset ?? state.level,
        note: 'Profile is active. Compile the arrangement to apply it.',
      };
    },
  });

  await register({
    name: 'get_player_profile',
    description: 'Get the current player profile: known chords, barre comfort, techniques, and practice preferences.',
    inputSchema: emptySchema,
    annotations: READ_ONLY,
    execute: async () => getPlayerProfile(),
  });

  await register({
    name: 'configure_practice_session',
    description:
      'Configure the Practice Studio: which section to practice, practice tempo (pitch unchanged), loop, metronome, count-in, and session length. The visible studio controls move with this call.',
    inputSchema: practiceConfigSchema,
    execute: async (input) => {
      const configInput: Record<string, unknown> = {};
      if (typeof input.section === 'string' && input.section.trim().length > 0) configInput.section = input.section;
      if (typeof input.tempoFactor === 'number') configInput.tempoFactor = input.tempoFactor;
      if (typeof input.loop === 'boolean') configInput.loop = input.loop;
      if (typeof input.metronome === 'boolean') configInput.metronome = input.metronome;
      if (typeof input.countInBars === 'number') configInput.countInBars = input.countInBars;
      if (typeof input.minutes === 'number') configInput.minutes = input.minutes;
      const practice = configurePractice(configInput);
      const session = await buildSessionPlan();
      return {
        practice,
        sessionSteps: session.steps.map((s) => ({ instruction: s.instruction, minutes: s.minutes })),
        totalMinutes: session.steps.reduce((sum, s) => sum + s.minutes, 0),
      };
    },
  });

  await register({
    name: 'prepare_practice_preview',
    description:
      'Prepare a synthesized audio preview of EXACTLY the compiled guitar arrangement for the practice section (our generated guitar track + optional metronome — never the original recording). The audio is NOT played automatically; tell the human to press the Play button in the Practice Studio.',
    inputSchema: practicePreviewSchema,
    execute: async (input) => {
      const configInput: Record<string, unknown> = {};
      if (typeof input.section === 'string' && input.section.trim().length > 0) configInput.section = input.section;
      if (typeof input.tempoFactor === 'number') configInput.tempoFactor = input.tempoFactor;
      if (typeof input.metronome === 'boolean') configInput.metronome = input.metronome;
      if (Object.keys(configInput).length > 0) configurePractice(configInput);
      const info = await preparePracticePreview();
      return {
        ready: info.ready,
        section: info.section,
        tempoFactor: info.tempoFactor,
        durationSeconds: info.durationSec,
        chords: info.chords,
        playedByHuman: true,
        note: 'Ready in the Practice Studio. The human presses Play to hear it.',
      };
    },
  });

  // --- agent research: the browser agent is the researcher, the page is the verifier ---

  await register({
    name: 'begin_song_research',
    description:
      'Begin evidence-based musical research for the currently loaded song when analyzable audio is unavailable or incomplete. Returns the song identity, facts already known, evidence gaps, and suggested web research queries. Use your browser/web research capability to investigate the requested facts across multiple independent public sources, then submit only compact musical facts through submit_song_evidence. Use public accessible sources only; do not bypass login gates or paywalls; do not reproduce full tabs, lyrics, or proprietary sheet music.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Song title (defaults to the loaded song).' },
        artist: { type: 'string', description: 'Artist name if known — improves identity resolution.' },
        refresh: { type: 'boolean', description: 'Start a new resolution version, keeping existing evidence.' },
      },
    },
    annotations: READ_ONLY,
    execute: async (input) => {
      const result = await beginSongResearch({
        ...(typeof input.title === 'string' && input.title.trim().length > 0 ? { title: input.title } : state.research?.identity !== undefined ? { title: state.research.identity.title } : {}),
        ...(typeof input.artist === 'string' && input.artist.trim().length > 0 ? { artist: input.artist } : {}),
        ...(input.refresh === true && { refresh: true }),
      });
      return {
        status: result.status,
        identity: result.identity,
        independentDomains: result.independentDomains,
        confidence: result.confidence,
        gaps: result.gaps,
        suggestedQueries: result.suggestedQueries,
        conflicts: result.conflicts,
        musicBrainz: result.musicBrainz,
        nextSuggestedTools: ['submit_song_evidence', 'get_song_research_status'],
      };
    },
  });

  await register({
    name: 'submit_song_evidence',
    description:
      'Submit ONE compact musical fact observed on a public web page, with its source URL. Claim types: IDENTITY, KEY, TEMPO, METER, CHORD_SET, CHORD_PROGRESSION, SECTION, DURATION, CAPO. For chord claims from guitar sites, set chordRepresentation to PLAYED_GUITAR_SHAPES and pass the capo if the page shows one — the app converts played shapes into sounding harmony before comparing sources. Never submit full tabs, lyrics, or page contents — only small structured facts. Do not resubmit a fact/URL pair already submitted. Conflicting evidence is kept, not overwritten.',
    inputSchema: {
      type: 'object',
      properties: {
        claimType: {
          type: 'string',
          enum: ['IDENTITY', 'KEY', 'TEMPO', 'METER', 'CHORD_SET', 'CHORD_PROGRESSION', 'SECTION', 'DURATION', 'CAPO'],
        },
        value: {
          description:
            'Compact fact. Examples: KEY {key:"Ab major"}; TEMPO {bpm:63}; METER {numerator:6,denominator:8}; CHORD_PROGRESSION {chords:["Ab","Fm","Db","Eb"], section:"chorus"}; IDENTITY {title, artist}; SECTION {name:"chorus"}.',
        },
        sourceUrl: { type: 'string', description: 'The public page where the fact was observed (required).' },
        sourceTitle: { type: 'string' },
        sourceKind: {
          type: 'string',
          enum: ['OFFICIAL_METADATA', 'MUSIC_DATABASE', 'CHORD_RESOURCE', 'MUSIC_ANALYSIS_RESOURCE', 'ARTICLE', 'OTHER'],
        },
        section: { type: 'string', description: 'Section the fact refers to, e.g. "chorus".' },
        chordRepresentation: { type: 'string', enum: ['SOUNDING_HARMONY', 'PLAYED_GUITAR_SHAPES', 'UNKNOWN'] },
        capo: { type: 'number', description: 'Capo position if the source shows one (0-11).' },
        confidence: { type: 'number', description: '0-1, how clearly the page states this fact.' },
      },
      required: ['claimType', 'value', 'sourceUrl'],
    },
    execute: async (input) => {
      const result = await submitSongEvidence(input as never);
      return {
        added: result.added,
        status: result.status,
        sources: result.sources,
        independentDomains: result.independentDomains,
        confidence: result.confidence,
        conflicts: result.conflicts,
        gaps: result.gaps,
        suggestedQueries: result.suggestedQueries,
      };
    },
  });

  await register({
    name: 'get_song_research_status',
    description:
      'Get the current research status: readiness state, per-field confidence (identity, key, tempo, meter, harmony, structure), independent source count, open conflicts, and evidence gaps. Use this after submitting evidence to decide whether to research more or resolve.',
    inputSchema: emptySchema,
    annotations: READ_ONLY,
    execute: async () => {
      const result = await fetchResearchStatus();
      return {
        active: result.active,
        status: result.status,
        identity: result.identity,
        sources: result.sources,
        independentDomains: result.independentDomains,
        confidence: result.confidence,
        conflicts: result.conflicts,
        hypotheses: result.hypotheses,
        gaps: result.gaps,
        suggestedQueries: result.suggestedQueries,
        warnings: result.warnings,
      };
    },
  });

  await register({
    name: 'resolve_researched_song',
    description:
      'Resolve the accumulated independent musical evidence into a provenance-rich SongGraph when confidence is sufficient. Do not call this if get_song_research_status still reports a high-priority evidence gap unless the user explicitly accepts a lower-confidence arrangement. On success the song becomes fully analyzable state: compile/practice tools work on it immediately.',
    inputSchema: {
      type: 'object',
      properties: {
        allowWarnings: { type: 'boolean', description: 'Accept a READY_WITH_WARNINGS (lower-confidence) arrangement, clearly labeled.' },
      },
    },
    execute: async (input) => {
      const result = await resolveResearchedSong({ allowWarnings: input.allowWarnings === true });
      return {
        resolved: result.resolved,
        origin: result.origin,
        confidence: result.confidence,
        status: result.status,
        warnings: result.warnings,
        songId: result.songId,
        nextSuggestedTools: ['compare_guitar_levels', 'set_player_profile', 'compile_guitar_version'],
      };
    },
  });

  // --- licensed audio catalog ---

  await register({
    name: 'search_licensed_music',
    description:
      'Search an artist-authorized/open music catalog (Jamendo) for a track whose audio may be analyzed directly. Use this when the user is open to discovering or testing with licensed music rather than a specific mainstream recording.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text search.' },
        title: { type: 'string' },
        artist: { type: 'string' },
      },
    },
    annotations: READ_ONLY,
    execute: async (input) => {
      const result = await searchLicensedMusic({
        ...(typeof input.query === 'string' && input.query.length > 0 && { query: input.query }),
        ...(typeof input.title === 'string' && input.title.length > 0 && { title: input.title }),
        ...(typeof input.artist === 'string' && input.artist.length > 0 && { artist: input.artist }),
      });
      return {
        tracks: result.tracks.map((t) => ({
          trackId: t.trackId,
          title: t.title,
          artist: t.artist,
          durationSeconds: t.durationSeconds,
          analyzable: t.audiodownloadAllowed,
          licenseUrl: t.licenseUrl ?? null,
        })),
      };
    },
  });

  await register({
    name: 'load_licensed_track',
    description:
      'Load a licensed catalog track into the app. Only ingests when the provider explicitly allows audio download (audiodownload_allowed). The track then goes through the same real audio analysis and guitar compilation as any other analyzable song.',
    inputSchema: {
      type: 'object',
      properties: { trackId: { type: 'string', description: 'Track id from search_licensed_music.' } },
      required: ['trackId'],
    },
    execute: async (input) => {
      if (typeof input.trackId !== 'string' || input.trackId.trim().length === 0) throw new Error('trackId is required.');
      const result = await loadLicensedTrack(input.trackId.trim());
      return {
        songId: result.songId,
        analysis: result.analysis,
        note: 'Licensed track loaded and analyzed. Compile/practice tools now work on it.',
      };
    },
  });

  return { dispose: () => controller.abort() };
}

/** Feature-detect + register + load initial state. Never throws. */
export async function initWebMcp(): Promise<'connected' | 'unavailable' | 'error'> {
  try {
    await loadInitialState();
  } catch {
    // page still works; analysis cards stay empty
  }
  if (!webMcpAvailable()) return 'unavailable';
  try {
    await registerWebMcpTools();
    return 'connected';
  } catch {
    return 'error';
  }
}
