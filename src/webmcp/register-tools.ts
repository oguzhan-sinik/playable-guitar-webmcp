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
  requestSong,
  fetchResearchBrief,
  fetchSongBlueprint,
  validateBlueprint,
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

export const TOOL_COUNT = 24;

export interface WebMcpRegistration {
  dispose(): void;
}

/**
 * Name → executor for the SAME actions the browser agent reaches through
 * document.modelContext. The ?debug=webmcp manual invoker calls these — never
 * a parallel implementation.
 */
export const toolRegistry = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
/** Compact specs for the debug table. */
export interface ToolSpec {
  name: string;
  readOnly: boolean;
  description: string;
}
export const toolSpecs = new Map<string, ToolSpec>();

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
  const controller = new AbortController();
  const { signal } = controller;

  const register = (tool: WebMcpTool): Promise<void> | void => {
    const execute = tool.execute.bind(tool);
    tool.execute = async (input) => {
      const startedAt = performance.now();
      try {
        const result = await execute(input);
        recordToolInvocation(tool.name, startedAt, JSON.stringify(result).slice(0, 80));
        return result;
      } catch (err) {
        recordToolInvocation(tool.name, startedAt, `ERROR: ${(err as Error).message.slice(0, 60)}`);
        throw err;
      }
    };
    toolRegistry.set(tool.name, tool.execute as (input: Record<string, unknown>) => Promise<unknown>);
    toolSpecs.set(tool.name, {
      name: tool.name,
      readOnly: tool.annotations?.readOnlyHint === true,
      description: tool.description,
    });
    if (!webMcpAvailable()) return; // debug registry still fills; no agent surface
    return document.modelContext!.registerTool(tool, { signal });
  };

  await register({
    name: 'request_song',
    description:
      'START HERE when the user asks to learn a song by name (title/artist), e.g. "Teach me Perfect by Ed Sheeran". This selects the requested recording and begins the song-understanding workflow. No Spotify, YouTube or audio link is needed — do not ask the user for one. After this call, follow nextSuggestedTools: usually get_song_research_brief next, because a named song must be researched and verified from independent public sources before it can be compiled into a guitar arrangement.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Song title, e.g. "Perfect".' },
        artist: { type: 'string', description: 'Artist name, e.g. "Ed Sheeran". Strongly recommended — a title-only request is ambiguous and returns IDENTITY_NEEDS_CONFIRMATION.' },
        query: { type: 'string', description: 'Free text like "Perfect by Ed Sheeran" when title/artist are not separated.' },
        version: { type: 'string', description: 'Optional: studio, live, acoustic, remix — prevents mixing recordings.' },
      },
    },
    execute: async (input) => {
      const result = await requestSong({
        ...(typeof input.title === 'string' && input.title.trim().length > 0 && { title: input.title.trim() }),
        ...(typeof input.artist === 'string' && input.artist.trim().length > 0 && { artist: input.artist.trim() }),
        ...(typeof input.query === 'string' && input.query.trim().length > 0 && { query: input.query.trim() }),
        ...(typeof input.version === 'string' && input.version.trim().length > 0 && { version: input.version.trim() }),
      });
      // ambiguous title-only request — the agent should identify the recording
      // (web search) or ask one concise question, then call request_song again
      if (result.status === 'IDENTITY_NEEDS_CONFIRMATION') {
        return {
          status: result.status,
          query: result.title,
          message: `Several recordings may match "${result.title}".`,
          researchNeeded: true,
          nextSuggestedTools: [
            {
              name: 'request_song',
              reason: 'Call again with the artist filled in once you have identified the intended recording (use web search on "<title> song artist" or ask the user one concise question).',
              priority: 'HIGH',
            },
          ],
        };
      }
      return {
        requested: true,
        reusedExistingResearch: result.reused,
        song: { title: result.title, artist: result.artist },
        status: result.research?.status,
        nextSuggestedTools: [
          {
            name: 'get_song_research_brief',
            reason: 'The recording is selected but no verified musical structure exists yet — inspect what musical facts are missing before compiling.',
            priority: 'HIGH',
          },
        ],
      };
    },
  });

  await register({
    name: 'load_song_from_link',
    description:
      'Use ONLY when the user actually provides a Spotify, YouTube, or direct-audio URL. Do not ask the user for a link if they have merely NAMED a song — use request_song instead. Determines whether the source can be analyzed or is metadata/playback only, loads it into shared UI state, and returns the next actions.',
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
      "Snapshot of the whole application: current song, player profile, research status, arrangement, and practice readiness. Useful for orienting at any point. WORKFLOW this app is designed for (the tools guide you step by step via nextSuggestedTools — prefer them over this list): (1) request_song for a named song, (2) get_song_research_brief, (3) research the missing facts on the public web, (4) submit_song_evidence per independent source, (5) resolve_researched_song, (6) set_player_profile if the user's ability is known, (7) compile_guitar_version, (8) get_arrangement_diagnostics, (9) choose_learning_section, (10) configure_practice_session, (11) prepare_practice_preview — a human then presses Play.",
    inputSchema: emptySchema,
    annotations: READ_ONLY,
    execute: async () => ({
      song: { id: state.songId, title: state.title },
      selectedLevel: state.level,
      learningGoal: state.learningGoal,
      playerProfileSet: state.playerProfile !== null,
      playerProfile: getPlayerProfile(),
      researchActive: state.research !== null,
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
      'Run audio analysis on the current song. Use ONLY when the app already holds analyzable audio (a loaded YouTube/direct-audio/licensed track). Do NOT use this to research a song the user merely named — for a title-only request use request_song, which starts evidence-based research instead.',
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
      'Compile the current song into a playable guitar arrangement for a skill level, honoring the player profile plus optional constraints. Requires a RESOLVED song — on a named-but-unresearched song, request_song + evidence + resolve_researched_song come first. level is optional: it defaults to the selected level (BEGINNER when nothing else is known). The compiler preserves musical fidelity while reducing physical difficulty via capo selection, chord-shape optimization, rhythm simplification and tempo adaptation; constraintsSatisfied=false means the closest available version was returned honestly.',
    inputSchema: compileSchema,
    execute: async (input) => {
      if (state.songId.length === 0) {
        return {
          error: 'SONG_NOT_COMPILABLE',
          message: 'No song is loaded. A named song must be requested and resolved before it can be compiled.',
          nextSuggestedTools: [
            { name: 'request_song', reason: 'Select the song the user wants to learn.', priority: 'HIGH' },
            { name: 'get_song_research_brief', reason: 'If a song was already requested, continue its research.', priority: 'HIGH' },
          ],
        };
      }
      const levelGiven = typeof input.level === 'string' && input.level.trim().length > 0;
      const level = requireLevel(levelGiven ? input.level : state.level, state.level);
      const avoidBarreChords = input.avoidBarreChords === true || (state.playerProfile?.practicePreferences.avoidBarreChords ?? false);
      const constraints: CompileConstraints = {};
      if (typeof input.maxDifficulty === 'number') constraints.maxDifficulty = input.maxDifficulty;
      if (typeof input.maxCapo === 'number') constraints.maxCapo = Math.round(input.maxCapo);
      if (typeof input.preferredTempoFactor === 'number') constraints.preferredTempoFactor = input.preferredTempoFactor;
      if (input.prioritizeFidelity === true) constraints.prioritizeFidelity = true;
      let compiled;
      try {
        compiled = await compileVersion(level, avoidBarreChords, constraints);
      } catch (err) {
        // state-aware error: never dead-end the agent
        return {
          error: 'SONG_NOT_COMPILABLE',
          message: `The current song cannot be compiled yet: ${err instanceof Error ? err.message : String(err)}`,
          nextSuggestedTools: [
            { name: 'get_guitar_app_state', reason: 'Check whether a song is loaded and whether it is resolved.', priority: 'HIGH' },
            { name: 'get_song_research_brief', reason: 'If the song was requested by name, inspect the remaining research work.', priority: 'HIGH' },
          ],
        };
      }
      if (typeof input.section === 'string' && input.section.trim().length > 0) {
        chooseSection(input.section);
      }
      return {
        compiled: true,
        level: compiled.level,
        capo: compiled.capo,
        chords: compiled.chords,
        playerDifficulty: compiled.playerDifficulty,
        absoluteDifficulty: compiled.difficultyAfter,
        fidelity: compiled.fidelity,
        tempoFactor: compiled.tempoFactor,
        constraintsSatisfied: compiled.constraintsSatisfied,
        ...(state.playerProfile === null && {
          assumption: `No detailed player profile was provided — compiled for a safe ${level} default. Call set_player_profile (even just {"preset":"BEGINNER"}) for a personalized version.`,
        }),
        tradeoffs: compiled.changes.slice(0, 5),
        ladder: compiled.ladder.map((l) => ({ level: l.level, capo: l.capo, difficulty: l.difficulty, playerDifficulty: l.playerDifficulty, fidelity: l.fidelity })),
        reporting: 'When summarizing for the user, report ONLY facts returned by Playable tools (blueprint, arrangement, diagnostics, practice session). Do not invent bar-by-bar structure, strumming patterns, fingerpicking instructions, or extra chord progressions.',
        nextSuggestedTools: [
          { name: 'get_arrangement_diagnostics', reason: 'Check whether this version still contains difficult elements for this player.', priority: 'MEDIUM' },
          { name: 'choose_learning_section', reason: 'Select the most recognizable section for the player to start with.', priority: 'MEDIUM' },
          ...(state.playerProfile === null
            ? [{ name: 'set_player_profile', reason: 'The player profile is unknown — a preset like {"preset":"BEGINNER"} personalizes difficulty.', priority: 'MEDIUM' }]
            : []),
        ],
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
      'Inspect why the current arrangement is easy or difficult for THIS guitarist: unfamiliar chords, barre usage, tempo pressure, difficulty contributors. Call after compile_guitar_version — if a recompile would help, the result says so with concrete recommended constraints.',
    inputSchema: emptySchema,
    annotations: READ_ONLY,
    execute: async () => {
      const result = await getArrangementDiagnostics();
      const barrePenalty = result.barreChords.length > 0 ? Math.round(1.4 * result.barreChords.length * 10) / 10 : 0;
      const avoidBarre = state.playerProfile?.practicePreferences.avoidBarreChords === true;
      const recompile = (avoidBarre && result.barreChords.length > 0) || result.playerDifficulty > 5;
      const constraints: Record<string, unknown> = {
        ...(result.barreChords.length > 0 ? { avoidBarreChords: true } : {}),
        ...(result.effectiveBpm > 90 ? { preferredTempoFactor: 0.7 } : {}),
      };
      return {
        ...result,
        barrePenalty,
        constraintsSatisfied: !recompile,
        recommendation: { recompile, ...(recompile && { constraints }) },
        nextSuggestedTools: recompile
          ? [
              {
                name: 'compile_guitar_version',
                reason: `Recompile with the recommended constraints (${Object.entries(constraints)
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .join(', ')}) for an easier faithful version.`,
                priority: 'HIGH' as const,
              },
            ]
          : [
              { name: 'choose_learning_section', reason: 'Difficulty looks comfortable — pick the best section to start with.', priority: 'MEDIUM' as const },
            ],
        reporting: 'Explain "why easier" using THIS diagnostics data and the compiled arrangement tradeoffs only. Do not add teaching content (strumming patterns, bar-by-bar breakdowns, theory claims) that Playable did not return.',
      };
    },
  });

  await register({
    name: 'choose_learning_section',
    description:
      'Choose the song section to practice first — the chorus is usually the most recognizable. Requires a compiled arrangement. Continue the chain afterwards with create_practice_plan.',
    inputSchema: sectionSchema,
    execute: async (input) => {
      const name = requireString(input.section, 'section');
      const section = chooseSection(name);
      return {
        section: section.type,
        startSeconds: Math.round(section.startMs / 1000),
        endSeconds: Math.round(section.endMs / 1000),
        nextSuggestedTools: [
          { name: 'create_practice_plan', reason: `Build a practice plan around the ${section.type.toLowerCase()}.`, priority: 'HIGH' },
        ],
      };
    },
  });

  await register({
    name: 'create_practice_plan',
    description:
      "Create a short practice plan for the current arrangement and selected section, sized to the player's available minutes (defaults to 20 when unspecified — flagged as defaultApplied). Continue the chain afterwards with configure_practice_session.",
    inputSchema: planSchema,
    execute: async (input) => {
      const minutes =
        typeof input.minutes === 'number' && Number.isInteger(input.minutes) && input.minutes >= 5 && input.minutes <= 60
          ? input.minutes
          : undefined;
      const plan = await createPlan(minutes);
      return {
        ...plan,
        ...(minutes === undefined && { defaultApplied: true, assumedMinutes: 20 }),
        nextSuggestedTools: [
          { name: 'configure_practice_session', reason: 'Configure the Practice Studio (section, tempo, loop, metronome) for this plan.', priority: 'HIGH' },
        ],
      };
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
      'Set who is playing, any time before or during the workflow. Minimal form: {"preset":"BEGINNER"} — sensible defaults (barre chords uncomfortable, slower tempo allowed) are applied, so "complete beginner" or "never played" maps to preset BEGINNER without 15 fields. Richer form: knownChords ["G","C","D"], barreChordsComfortable false, comfortableTempoBpm, practicePreferences. Works whether or not a song is loaded; the profile survives song changes.',
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
      'Configure the Practice Studio: section, practice tempo (pitch unchanged), loop, metronome, count-in, and session length. All fields optional — session length defaults to 20 minutes (defaultApplied marks the assumption). The visible studio controls move with this call. Afterwards, prepare_practice_preview renders the audio (a human presses Play).',
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
        defaultApplied: practice.defaultApplied === true,
        reporting: 'Summarize the practice setup from these fields only (section, tempo factor, metronome, count-in, minutes). The practice tempo is a session setting — the song\'s original BPM is unchanged.',
        nextSuggestedTools: [
          { name: 'prepare_practice_preview', reason: 'Render the synthesized preview of exactly this arrangement — then tell the human to press Play.', priority: 'HIGH' },
        ],
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
        note: 'READY. The preview never autoplays — tell the human to press the Play button in the Practice Studio.',
      };
    },
  });

  // --- agent research: the browser agent is the researcher, the page is the verifier ---

  await register({
    name: 'begin_song_research',
    description:
      'Legacy research entry point — for a named song prefer request_song, then get_song_research_brief. This only (re)starts the research session itself. Rules for all research: use public accessible sources only; do not bypass login gates or paywalls; do not reproduce full tabs, lyrics, or proprietary sheet music; submit compact facts via submit_song_evidence.',
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
        nextSuggestedTools: [
          { name: 'submit_song_evidence', reason: 'Submit compact facts from each independent public source you research.', priority: 'HIGH' },
          { name: 'get_song_research_brief', reason: 'Inspect ranked gaps and suggested queries.', priority: 'MEDIUM' },
        ],
      };
    },
  });

  await register({
    name: 'submit_song_evidence',
    description:
      'Submit compact musical evidence found on ONE public source, with its source URL. Batch multiple compact facts from the same source in one call via claims: [...] — use a separate call for each independent source. Claim types: IDENTITY, KEY, TEMPO, METER, CHORD_SET, CHORD_PROGRESSION, SECTION, FORM (ordered section outline), DURATION, CAPO, SHORT_MOTIF (max 16 notes). For chord claims from guitar sites, set chordRepresentation to PLAYED_GUITAR_SHAPES and pass the capo if the page shows one — the app converts played shapes into sounding harmony before comparing sources. Never submit full tabs, lyrics, complete sheet music, or large copied text — only small structured facts; oversized payloads are rejected. Duplicate fact/URL pairs do not increase confidence. Conflicting evidence is kept, not overwritten. After submitting, call get_song_research_brief to inspect remaining uncertainty.',
    inputSchema: {
      type: 'object',
      properties: {
        claims: {
          type: 'array',
          description: 'BATCH form: several compact facts observed on the SAME page. Each item: { claimType, value, section?, chordRepresentation?, capo?, confidence? }.',
          items: {
            type: 'object',
            properties: {
              claimType: {
                type: 'string',
                enum: ['IDENTITY', 'KEY', 'TEMPO', 'METER', 'CHORD_SET', 'CHORD_PROGRESSION', 'SECTION', 'FORM', 'DURATION', 'CAPO', 'SHORT_MOTIF'],
              },
              value: {
                description:
                  'Compact fact. Examples: KEY {key:"Ab major"}; TEMPO {bpm:63}; METER {numerator:6,denominator:8}; CHORD_PROGRESSION {chords:["Ab","Fm","Db","Eb"], section:"chorus"}; FORM {sections:["intro","verse","chorus"]}; IDENTITY {title, artist}.',
              },
              section: { type: 'string' },
              chordRepresentation: { type: 'string', enum: ['SOUNDING_HARMONY', 'PLAYED_GUITAR_SHAPES', 'UNKNOWN'] },
              capo: { type: 'number' },
              confidence: { type: 'number' },
            },
            required: ['claimType', 'value'],
          },
        },
        claimType: {
          type: 'string',
          enum: ['IDENTITY', 'KEY', 'TEMPO', 'METER', 'CHORD_SET', 'CHORD_PROGRESSION', 'SECTION', 'FORM', 'DURATION', 'CAPO', 'SHORT_MOTIF'],
          description: 'SINGLE-claim form (use claims[] instead when the page states several facts).',
        },
        value: {
          description:
            'Compact fact. Examples: KEY {key:"Ab major"}; TEMPO {bpm:63}; METER {numerator:6,denominator:8}; CHORD_PROGRESSION {chords:["Ab","Fm","Db","Eb"], section:"chorus"}; IDENTITY {title, artist}; SECTION {name:"chorus"}.',
        },
        sourceUrl: { type: 'string', description: 'The public page where the fact(s) were observed (required).' },
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
    },
    execute: async (input) => {
      const result = await submitSongEvidence(input as never);
      const ready = result.status === 'READY' || result.status === 'READY_WITH_WARNINGS';
      return {
        accepted: result.added,
        addedCount: result.addedCount,
        researchStatus: result.status,
        independentSources: result.independentDomains,
        confidence: result.confidence,
        newConflicts: result.conflicts ?? [],
        gaps: result.gaps,
        suggestedQueries: result.suggestedQueries,
        nextSuggestedTools: ready
          ? [
              { name: 'validate_song_blueprint', reason: 'Evidence is now sufficient to test whether the song can be resolved.', priority: 'HIGH' },
            ]
          : [
              { name: 'get_song_research_brief', reason: 'Re-check what is still missing or conflicting before resolving.', priority: 'HIGH' },
            ],
      };
    },
  });

  await register({
    name: 'get_song_research_status',
    description:
      'Raw research snapshot: readiness state, per-field confidence, independent source count, open conflicts, and the evidence list with domains. For deciding WHAT TO DO NEXT prefer get_song_research_brief — it ranks the missing facts and provides search queries.',
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
    name: 'get_song_research_brief',
    description:
      'The work queue for the current song: what musical facts are still missing, with ready-made public-web search queries (priorityTasks), unresolved conflicts, and per-field confidence. Call it after request_song and again after every submit_song_evidence. Do the web research it asks for, then submit what you find with submit_song_evidence. Do not invent missing facts.',
    inputSchema: emptySchema,
    annotations: READ_ONLY,
    execute: async () => {
      const payload = await fetchResearchBrief();
      const brief = (payload as { brief?: Record<string, unknown> }).brief ?? payload;
      if ((payload as { active?: boolean }).active === false || brief === null || brief === undefined) {
        return {
          error: 'NO_SONG_REQUESTED',
          message: 'No song is selected yet — nothing to research.',
          nextSuggestedTools: [
            { name: 'request_song', reason: 'Request the song by title and artist to start the research workflow.', priority: 'HIGH' },
          ],
        };
      }
      const ready = brief.readyToCompile === true;
      return {
        ...brief,
        nextSuggestedTools: ready
          ? [
              { name: 'validate_song_blueprint', reason: 'Evidence is sufficient — confirm the blueprint resolves honestly.', priority: 'HIGH' },
            ]
          : [
              {
                name: 'submit_song_evidence',
                reason:
                  (brief as { priorityTasks?: Array<{ instruction?: string }> }).priorityTasks?.[0]?.instruction ??
                  'Research the priorityTasks on the public web and submit compact facts, one call per independent source.',
                priority: 'HIGH',
              },
            ],
      };
    },
  });

  await register({
    name: 'validate_song_blueprint',
    description:
      'Read-only readiness check of the researched song blueprint: whether it is READY, READY_WITH_WARNINGS, TENTATIVE, or NOT_READY, plus the concrete issues. Use before resolve_song_blueprint — do not resolve while a HIGH-priority gap remains unless the user accepts lower confidence.',
    inputSchema: emptySchema,
    annotations: READ_ONLY,
    execute: async () => validateBlueprint(),
  });

  await register({
    name: 'get_song_blueprint',
    description:
      'Get the resolved song blueprint: identity, key, tempo, meter, section harmony, form, confidence, warnings, and timing precision. Read-only and compact — evidence provenance stays in get_song_research_status. Available meaningfully once research has evidence.',
    inputSchema: emptySchema,
    annotations: READ_ONLY,
    execute: async () => fetchSongBlueprint(),
  });

  await register({
    name: 'resolve_researched_song',
    description:
      'Resolve the accumulated independent musical evidence (the Song Blueprint) into a playable SongGraph. Operates ONLY on already-submitted evidence — it cannot invent musical structure. Call it once evidence is sufficient (submit_song_evidence points here when ready); on failure it tells you exactly what is missing. On success, move to personalization: check the player profile, then compile_guitar_version.',
    inputSchema: {
      type: 'object',
      properties: {
        allowWarnings: { type: 'boolean', description: 'Accept a READY_WITH_WARNINGS (lower-confidence) arrangement, clearly labeled.' },
      },
    },
    execute: async (input) => {
      let result;
      try {
        result = await resolveResearchedSong({ allowWarnings: input.allowWarnings === true });
      } catch (err) {
        return {
          resolved: false,
          error: 'BLUEPRINT_NOT_READY',
          message: err instanceof Error ? err.message : String(err),
          nextSuggestedTools: [
            { name: 'get_song_research_brief', reason: 'Inspect the remaining evidence gaps or conflicts blocking resolution.', priority: 'HIGH' },
          ],
        };
      }
      const hasProfile = state.playerProfile !== null;
      return {
        resolved: result.resolved,
        origin: result.origin,
        confidence: result.confidence,
        status: result.status,
        warnings: result.warnings,
        songId: result.songId,
        nextSuggestedTools: hasProfile
          ? [
              { name: 'compare_guitar_levels', reason: 'The player profile is known — compare Beginner/Intermediate/Advanced before compiling.', priority: 'HIGH' },
              { name: 'compile_guitar_version', reason: 'Compile the personalized arrangement.', priority: 'HIGH' },
            ]
          : [
              { name: 'get_player_profile', reason: 'Check whether the player’s ability is already known.', priority: 'HIGH' },
              { name: 'set_player_profile', reason: 'If unknown, a preset like {"preset":"BEGINNER"} is enough for a safe personalized compile.', priority: 'HIGH' },
              { name: 'compile_guitar_version', reason: 'Or compile now with the safe default level.', priority: 'MEDIUM' },
            ],
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
  if (!webMcpAvailable()) {
    try {
      await registerWebMcpTools(); // fills the debug registry even without WebMCP
    } catch {
      // ignore — manual UI still works
    }
    return 'unavailable';
  }
  try {
    await registerWebMcpTools();
    return 'connected';
  } catch {
    return 'error';
  }
}
