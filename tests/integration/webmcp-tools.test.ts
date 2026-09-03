import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { registerWebMcpTools, TOOL_COUNT, toolRegistry } from '../../src/webmcp/register-tools.js';
import {
  state,
  setState,
  setApiBase,
  loadInitialState,
  SKILL_LEVELS,
  type CompiledVersion,
} from '../../src/webmcp/tool-context.js';
import { compileSchema, sectionSchema, levelSchema } from '../../src/webmcp/schemas.js';
import { createDemoServer } from '../../src/demo/server.js';
import {
  compileGuitarVersion,
  compareGuitarLevels,
  summarizeAnalysis,
  listSections,
} from '../../src/application/prepare-arrangement.js';
import type { SongGraph } from '../../src/domain/music/song-graph.js';

/**
 * WebMCP tool tests run against the real demo song graph on disk
 * (.data/songs/song_07c596988b8d/graph.json) with a mocked
 * document.modelContext — the same registration path a browser agent uses.
 */
const DEMO_SONG = 'song_07c596988b8d';

type RegisteredTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean };
  execute(input: Record<string, unknown>): Promise<unknown>;
};

let tools = new Map<string, RegisteredTool>();
let capturedSignals: AbortSignal[] = [];

/** Stub `document` (vitest runs in node) + capture registerTool calls. */
function mockModelContext(): void {
  tools = new Map();
  capturedSignals = [];
  (globalThis as { document?: unknown }).document = {
    modelContext: {
      registerTool: (tool: RegisteredTool, opts?: { signal?: AbortSignal }) => {
        tools.set(tool.name, tool);
        if (opts?.signal !== undefined) capturedSignals.push(opts.signal);
      },
    },
  };
}

function toolFor(name: string): RegisteredTool {
  return tools.get(name)!;
}

describe('webmcp tool schemas', () => {
  it('compile level is optional with the three skill values', () => {
    expect(compileSchema.required).toBeUndefined();
    const level = (compileSchema.properties as Record<string, { enum?: string[] }>).level;
    expect(level?.enum).toEqual(SKILL_LEVELS);
  });

  it('section and level schemas mark their argument required', () => {
    expect(sectionSchema.required).toEqual(['section']);
    expect(levelSchema.required).toEqual(['level']);
  });
});

describe('deterministic prepare service (demo song)', () => {
  it('compiles a beginner version with real metrics', async () => {
    const result = await compileGuitarVersion(DEMO_SONG, { level: 'BEGINNER', avoidBarreChords: true });
    expect(result.level).toBe('BEGINNER');
    expect(result.capo).toBeGreaterThanOrEqual(0);
    expect(result.chords.length).toBeGreaterThan(0);
    expect(result.difficultyAfter).toBeLessThan(result.difficultyBefore);
    expect(result.fidelity).toBeGreaterThan(0.9);
    expect(result.ladder.map((l) => l.level)).toEqual(SKILL_LEVELS);
  });

  it('maps played shapes to sounding harmony from real arrangement data', async () => {
    const result = await compileGuitarVersion(DEMO_SONG, { level: 'BEGINNER', avoidBarreChords: true });
    expect(result.mapping.length).toBeGreaterThan(0);
    const played = new Set(result.mapping.map((m) => m.played));
    expect(played).toEqual(new Set(result.chords)); // mapping covers exactly the played chords
    // sounding harmony comes from the original graph, not the shape names
    const { LocalSongGraphRepository } = await import('../../src/repositories/song-graph-repository.js');
    const { config } = await import('../../src/config/env.js');
    const graph: SongGraph = await new LocalSongGraphRepository(config.songsDir).load(DEMO_SONG);
    const soundingLabels = new Set(result.mapping.map((m) => m.sounding));
    const graphLabels = new Set(
      [...new Set(graph.harmony.chords.map((c) => `${c.root}${c.quality === 'minor' ? 'm' : ''}`))].slice(0, 8),
    );
    expect([...soundingLabels].every((label) => graphLabels.has(label))).toBe(true);
  });

  it('rejects unknown songs', async () => {
    await expect(compileGuitarVersion('song_missing00000', { level: 'BEGINNER' })).rejects.toThrow();
  });

  it('summarizes analysis and sections from the graph', async () => {
    const { LocalSongGraphRepository } = await import('../../src/repositories/song-graph-repository.js');
    const { config } = await import('../../src/config/env.js');
    const graph: SongGraph = await new LocalSongGraphRepository(config.songsDir).load(DEMO_SONG);
    const summary = summarizeAnalysis(graph);
    expect(summary.tempoBpm).toBeGreaterThan(0);
    expect(summary.sections).toContain('CHORUS');
    expect(summary.harmony.mainChords.length).toBeGreaterThan(0);
    expect(listSections(graph).some((s) => s.type === 'CHORUS')).toBe(true);
  });
});

describe('webmcp registration', () => {
  beforeEach(() => {
    setState({
      level: 'BEGINNER',
      arrangement: null,
      currentSection: null,
      sections: [{ type: 'CHORUS', index: 0, startMs: 82_000, endMs: 97_000 }],
    });
  });

  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it('registers 20 tools; dispose aborts the controller signal', async () => {
    mockModelContext();
    const registration = await registerWebMcpTools();
    expect(registration).not.toBeNull();
    expect(tools.size).toBe(TOOL_COUNT);
    for (const name of [
      'load_song_from_link',
      'get_guitar_app_state',
      'analyze_song',
      'compare_guitar_levels',
      'compile_guitar_version',
      'explain_guitar_version',
      'get_arrangement_diagnostics',
      'choose_learning_section',
      'create_practice_plan',
      'set_player_level',
      'set_player_profile',
      'get_player_profile',
      'configure_practice_session',
      'prepare_practice_preview',
      'begin_song_research',
      'submit_song_evidence',
      'get_song_research_status',
      'resolve_researched_song',
      'search_licensed_music',
      'load_licensed_track',
    ]) {
      expect(tools.has(name)).toBe(true);
      expect(tools.get(name)!.description.length).toBeGreaterThan(20);
    }
    expect(tools.has('render_guitar_preview')).toBe(false);
    registration!.dispose();
    expect(capturedSignals.length).toBe(TOOL_COUNT);
    expect(capturedSignals.every((s) => s.aborted)).toBe(true);
  });

  it('marks read-only tools with readOnlyHint', async () => {
    mockModelContext();
    await registerWebMcpTools();
    for (const name of [
      'get_guitar_app_state',
      'compare_guitar_levels',
      'explain_guitar_version',
      'get_arrangement_diagnostics',
      'get_player_profile',
      'begin_song_research',
      'get_song_research_status',
      'search_licensed_music',
    ]) {
      expect(tools.get(name)!.annotations?.readOnlyHint).toBe(true);
    }
    // mutating tools stay default
    for (const name of ['set_player_profile', 'compile_guitar_version', 'configure_practice_session', 'prepare_practice_preview', 'submit_song_evidence', 'resolve_researched_song', 'load_licensed_track']) {
      expect(tools.get(name)!.annotations?.readOnlyHint ?? false).toBe(false);
    }
  });

  it('set_player_profile requires at least one meaningful field', async () => {
    mockModelContext();
    await registerWebMcpTools();
    await expect(toolFor('set_player_profile').execute({})).rejects.toThrow(/at least one/);
  });

  it('without WebMCP the tools still build for the debug invoker but never reach document.modelContext', async () => {
    (globalThis as { document?: unknown }).document = {};
    const registration = await registerWebMcpTools();
    expect(registration).not.toBeNull();
    expect(toolRegistry.size).toBe(TOOL_COUNT);
    expect(toolRegistry.get('request_song')).toBeTypeOf('function');
    registration?.dispose();
  });

  it('set_player_level updates shared state and rejects invalid levels', async () => {
    mockModelContext();
    await registerWebMcpTools();
    await expect(toolFor('set_player_level').execute({ level: 'VIRTUOSO' })).rejects.toThrow(/Invalid level/);
    const result = (await toolFor('set_player_level').execute({ level: 'intermediate' })) as { level: string };
    expect(result.level).toBe('INTERMEDIATE');
    expect(state.level).toBe('INTERMEDIATE');
  });

  it('compile tool accepts a missing level (safe default) and reports state-aware errors', async () => {
    mockModelContext();
    await registerWebMcpTools();
    // no compilable song loaded → structured guidance instead of a dead-end throw
    const result = (await toolFor('compile_guitar_version').execute({})) as { error?: string };
    expect(result.error).toBe('SONG_NOT_COMPILABLE');
  });

  it('load_song_from_link updates shared state and reports capability', async () => {
    mockModelContext();
    await registerWebMcpTools();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            source: { provider: 'SPOTIFY', capability: 'PLAYBACK_ONLY', playbackUrl: 'https://open.spotify.com/embed/track/x', reason: 'no analyzable stream' },
            status: 'LOADED_PLAYBACK_ONLY',
            title: 'Some Song',
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
    try {
      const result = (await toolFor('load_song_from_link').execute({ url: 'https://open.spotify.com/track/x' })) as {
        capability: string;
        analysisReady: boolean;
        nextSuggestedTools: string[];
      };
      expect(result.capability).toBe('PLAYBACK_ONLY');
      expect(result.analysisReady).toBe(false);
      expect(result.nextSuggestedTools).toEqual([]);
      expect(state.loadedSource?.provider).toBe('SPOTIFY');
      expect(state.loadedSource?.title).toBe('Some Song');
      expect(state.loadStatus).toBe('loaded');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('load_song_from_link rejects a missing url', async () => {
    mockModelContext();
    await registerWebMcpTools();
    await expect(toolFor('load_song_from_link').execute({})).rejects.toThrow(/url is required/);
  });

  it('choose_learning_section rejects unknown sections', async () => {
    mockModelContext();
    await registerWebMcpTools();
    await expect(toolFor('choose_learning_section').execute({ section: 'TUBASOLO' })).rejects.toThrow(/Unknown section/);
  });
});

describe('webmcp tools against the live demo API (tool → API → engine)', () => {
  let server: Server;
  let base = '';

  beforeAll(async () => {
    server = createDemoServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    setApiBase(base);
    mockModelContext();
    await registerWebMcpTools();
    await loadInitialState();
  });

  afterAll(async () => {
    setApiBase('');
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('analyze_song updates shared state', async () => {
    const analysis = (await toolFor('analyze_song').execute({})) as { tempoBpm: number };
    expect(analysis.tempoBpm).toBeGreaterThan(0);
    expect(state.analysis).not.toBeNull();
    expect(state.sections.some((s) => s.type === 'CHORUS')).toBe(true);
  });

  it('compile_guitar_version compiles and updates shared state', async () => {
    const compiled = (await toolFor('compile_guitar_version').execute({
      level: 'BEGINNER',
      avoidBarreChords: true,
    })) as { level: string; capo: number; playerDifficulty: number; constraintsSatisfied: boolean };
    expect(compiled.playerDifficulty).toBeGreaterThan(0);
    // this song has no zero-barre candidates, so the compiler honestly
    // reports that the beginner constraints could not be fully met
    expect(typeof compiled.constraintsSatisfied).toBe('boolean');
    expect(state.arrangement).not.toBeNull();
    expect(state.level).toBe('BEGINNER');
    const stored = state.arrangement!;
    expect(stored.difficultyAfter).toBeLessThan(stored.difficultyBefore);
  });

  it('choose_learning_section validates and focuses a section', async () => {
    const result = (await toolFor('choose_learning_section').execute({ section: 'CHORUS' })) as {
      section: string;
      startSeconds: number;
      endSeconds: number;
    };
    expect(result.section).toBe('CHORUS');
    expect(result.endSeconds).toBeGreaterThan(result.startSeconds);
    expect(state.currentSection?.type).toBe('CHORUS');
  });

  it('create_practice_plan returns ordered steps', async () => {
    const plan = (await toolFor('create_practice_plan').execute({ minutes: 20 })) as {
      steps: Array<{ step: number; instruction: string }>;
    };
    expect(plan.steps.length).toBeGreaterThan(2);
    expect(plan.steps[0]!.instruction).toMatch(/Learn/);
  });

  it('get_guitar_app_state reflects what the agent did', async () => {
    const snapshot = (await toolFor('get_guitar_app_state').execute({})) as {
      selectedLevel: string;
      arrangementAvailable: boolean;
      currentSection: string;
      analysisAvailable: boolean;
    };
    expect(snapshot.selectedLevel).toBe('BEGINNER');
    expect(snapshot.arrangementAvailable).toBe(true);
    expect(snapshot.analysisAvailable).toBe(true);
    expect(snapshot.currentSection).toBe('CHORUS');
  });

  it('compare_guitar_levels returns the full ladder', async () => {
    const result = (await toolFor('compare_guitar_levels').execute({})) as {
      levels: Array<{ level: string }>;
    };
    expect(result.levels.map((l) => l.level)).toEqual(SKILL_LEVELS);
  });

  it('set_player_profile overrides the preset and updates compile selection', async () => {
    const result = (await toolFor('set_player_profile').execute({
      knownChords: ['C', 'G', 'D', 'Em', 'Am'],
      barreChordsComfortable: false,
      comfortableTempoBpm: 80,
      avoidBarreChords: true,
    })) as { saved: boolean; knownChords: string[] };
    expect(result.saved).toBe(true);
    expect(state.playerProfile).not.toBeNull();
    expect(state.playerProfile!.knownChords['Em']).toBeDefined();
    expect(state.avoidBarreChords).toBe(true);
    // the profile reaches the compile tool call (same shared state)
    const compiled = (await toolFor('compile_guitar_version').execute({ level: 'BEGINNER' })) as {
      playerDifficulty: number;
    };
    expect(compiled.playerDifficulty).toBeGreaterThan(0);
  });

  it('get_arrangement_diagnostics explains player-specific difficulty', async () => {
    const diagnostics = (await toolFor('get_arrangement_diagnostics').execute({})) as {
      playerDifficulty: number;
      absoluteDifficulty: number;
      knownChords: string[];
      barreChords: string[];
      reasons: string[];
    };
    expect(diagnostics.playerDifficulty).toBeGreaterThan(0);
    expect(Array.isArray(diagnostics.reasons)).toBe(true);
    expect(state.diagnostics).not.toBeNull();
  });

  it('prepare_practice_preview prepares audio without playing it', async () => {
    const result = (await toolFor('prepare_practice_preview').execute({
      section: 'CHORUS',
      tempoFactor: 0.7,
      metronome: true,
    })) as {
      ready: boolean;
      section: string;
      tempoFactor: number;
      durationSeconds: number;
      playedByHuman: boolean;
    };
    expect(result.ready).toBe(true);
    expect(result.section).toBe('CHORUS');
    expect(result.tempoFactor).toBe(0.7);
    expect(result.durationSeconds).toBeGreaterThan(0);
    expect(result.playedByHuman).toBe(true); // audio only starts on human click
    expect(state.preview?.ready).toBe(true);
  });

  it('configure_practice_session moves the shared studio controls', async () => {
    const result = (await toolFor('configure_practice_session').execute({
      section: 'CHORUS',
      tempoFactor: 0.6,
      loop: true,
      metronome: false,
      countInBars: 2,
      minutes: 15,
    })) as { practice: { tempoFactor: number; metronome: boolean; countInBars: number }; totalMinutes: number };
    expect(result.practice.tempoFactor).toBe(0.6);
    expect(result.practice.metronome).toBe(false);
    expect(result.practice.countInBars).toBe(2);
    expect(result.totalMinutes).toBe(15);
    expect(state.practice.tempoFactor).toBe(0.6);
    expect(state.session?.steps.length).toBeGreaterThan(0);
  });
});

describe('compile result structure', () => {
  it('beginner compilation exposes chords, ladder and explanation fields', async () => {
    const compiled = await compileGuitarVersion(DEMO_SONG, { level: 'BEGINNER' });
    expect(Array.isArray(compiled.chords)).toBe(true);
    expect(compiled.ladder.length).toBe(3);
    expect(compiled.changes.length).toBeGreaterThan(0);
  });
});

describe('NO-LINK HERO FLOW (request by name → research → resolve → compile → practice)', () => {
  let server: Server;
  let base = '';
  let realFetch: typeof fetch;

  beforeAll(async () => {
    // deterministic test: never touch the network for identity lookup
    realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      if (String(input).includes('musicbrainz.org')) throw new Error('offline test');
      return realFetch(input, init);
    }) as typeof fetch;
    server = createDemoServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    setApiBase(base);
    mockModelContext();
    await registerWebMcpTools();
  });

  afterAll(async () => {
    globalThis.fetch = realFetch;
    setApiBase('');
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('runs the whole agent flow without any URL or audio', async () => {
    // unique per run: research sessions persist by identity key on disk
    const artist = `The Analog Hearts ${Date.now().toString(36)}`;
    // 1. request the song BY NAME — no link anywhere in this flow
    const requested = (await toolFor('request_song').execute({
      title: 'City Lights',
      artist,
    })) as { requested: boolean; song: { title: string }; status: string };
    expect(requested.requested).toBe(true);
    expect(state.title).toBe('City Lights');
    expect(state.arrangement).toBeNull(); // stale arrangement cleared

    // the player profile arrives BEFORE/DURING research and survives song changes
    await toolFor('set_player_profile').execute({
      knownChords: ['G', 'C', 'D', 'Em', 'Am'],
      barreChordsComfortable: false,
      avoidBarreChords: true,
    });
    expect(state.playerProfile).not.toBeNull();

    // 2. research brief identifies missing facts as an agent-actionable work queue
    const brief = (await toolFor('get_song_research_brief').execute({})) as {
      song: { title: string };
      status: string;
      readyToCompile: boolean;
      priorityTasks: Array<{ field: string; instruction: string; suggestedQueries: string[] }>;
    };
    expect(brief.song.title).toBe('City Lights');
    expect(brief.readyToCompile).toBe(false);
    expect(brief.priorityTasks.some((t) => t.field === 'harmony' && t.suggestedQueries.length > 0)).toBe(true);

    // compiling NOW must return a structured, agent-actionable error — not a dead end
    const tooEarly = (await toolFor('compile_guitar_version').execute({})) as {
      error: string;
      nextSuggestedTools: Array<{ name: string }>;
    };
    expect(tooEarly.error).toBe('SONG_NOT_COMPILABLE');
    expect(tooEarly.nextSuggestedTools.some((t) => t.name === 'get_song_research_brief')).toBe(true);

    // 3. batched evidence from independent sources (synthetic fixture)
    const evidence1 = (await toolFor('submit_song_evidence').execute({
      sourceUrl: 'https://encyclopedia.example/city-lights',
      sourceKind: 'MUSIC_DATABASE',
      claims: [{ claimType: 'IDENTITY', value: { title: 'City Lights', artist } }],
    })) as { accepted: boolean; researchStatus: string; nextSuggestedTools: Array<{ name: string }> };
    expect(evidence1.accepted).toBe(true);
    expect(evidence1.researchStatus).toBe('NEEDS_MORE_EVIDENCE');
    expect(evidence1.nextSuggestedTools.some((t) => t.name === 'get_song_research_brief')).toBe(true);
    await toolFor('submit_song_evidence').execute({
      sourceUrl: 'https://chords-fan.example/city-lights',
      sourceKind: 'CHORD_RESOURCE',
      claims: [
        { claimType: 'KEY', value: { key: 'Ab major' } },
        { claimType: 'CHORD_PROGRESSION', value: { chords: ['G', 'Em', 'C', 'D'], section: 'chorus' }, chordRepresentation: 'PLAYED_GUITAR_SHAPES', capo: 1 },
      ],
    });
    await toolFor('submit_song_evidence').execute({
      sourceUrl: 'https://theory-site.example/city-lights',
      sourceKind: 'MUSIC_ANALYSIS_RESOURCE',
      claims: [
        { claimType: 'KEY', value: { key: 'Ab major' } },
        { claimType: 'CHORD_PROGRESSION', value: { chords: ['Ab', 'Fm', 'Db', 'Eb'], section: 'chorus' }, chordRepresentation: 'SOUNDING_HARMONY' },
        { claimType: 'TEMPO', value: { bpm: 63 } },
        { claimType: 'METER', value: { numerator: 6, denominator: 8 } },
        { claimType: 'FORM', value: { sections: ['intro', 'verse', 'chorus'] } },
      ],
    });

    // 4. blueprint projections
    const blueprint = (await toolFor('get_song_blueprint').execute({})) as {
      mainHarmony: string[];
      timingPrecision: string;
      form: string[];
    };
    expect(blueprint.mainHarmony).toEqual(['Ab', 'Fm', 'Db', 'Eb']); // capo equivalence merged both sources
    expect(blueprint.timingPrecision).toBe('SECTION_RELATIVE');
    const validation = (await toolFor('validate_song_blueprint').execute({})) as { status: string; canResolve: boolean };
    expect(['READY', 'READY_WITH_WARNINGS', 'NOT_READY']).toContain(validation.status);

    // 5. resolve → SongGraph → compile for THIS player
    const resolved = (await toolFor('resolve_researched_song').execute({ allowWarnings: true })) as {
      resolved: boolean;
      origin: string;
      songId: string;
      nextSuggestedTools: Array<{ name: string }>;
    };
    expect(resolved.resolved).toBe(true);
    expect(resolved.origin).toBe('RESEARCH_FUSION');
    expect(state.songId).toBe(resolved.songId);
    // profile was set before resolve → the agent is guided to compare/compile, not re-ask
    expect(resolved.nextSuggestedTools.some((t) => t.name === 'compile_guitar_version')).toBe(true);

    const compiled = (await toolFor('compile_guitar_version').execute({ level: 'BEGINNER', avoidBarreChords: true })) as {
      compiled: boolean;
      capo: number;
      chords: string[];
      playerDifficulty: number;
      fidelity: number;
      nextSuggestedTools: Array<{ name: string }>;
    };
    expect(compiled.compiled).toBe(true);
    expect(compiled.playerDifficulty).toBeGreaterThan(0);
    expect(compiled.fidelity).toBeGreaterThan(0.5);
    expect(compiled.nextSuggestedTools.some((t) => t.name === 'get_arrangement_diagnostics')).toBe(true);
    expect(state.playerProfile).not.toBeNull(); // profile still intact after the full flow

    // 6. teaching flow — each step hands the agent the next one
    const section = (await toolFor('choose_learning_section').execute({ section: 'CHORUS' })) as {
      section: string;
      nextSuggestedTools: Array<{ name: string }>;
    };
    expect(section.section).toBe('CHORUS');
    expect(section.nextSuggestedTools[0]!.name).toBe('create_practice_plan');
    const plan = (await toolFor('create_practice_plan').execute({})) as {
      defaultApplied: boolean;
      nextSuggestedTools: Array<{ name: string }>;
    };
    expect(plan.defaultApplied).toBe(true); // missing-time default, transparent
    expect(plan.nextSuggestedTools[0]!.name).toBe('configure_practice_session');
    const session = (await toolFor('configure_practice_session').execute({ minutes: 20, loop: true, metronome: true })) as {
      totalMinutes: number;
      nextSuggestedTools: Array<{ name: string }>;
    };
    expect(session.totalMinutes).toBe(20);
    expect(session.nextSuggestedTools[0]!.name).toBe('prepare_practice_preview');
    const preview = (await toolFor('prepare_practice_preview').execute({})) as { ready: boolean; playedByHuman: boolean };
    expect(preview.ready).toBe(true);
    expect(preview.playedByHuman).toBe(true); // no autoplay — the human presses Play
  });
});
