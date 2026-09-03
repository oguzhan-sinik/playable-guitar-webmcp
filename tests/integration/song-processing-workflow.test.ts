import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalSongRepository } from '../../src/repositories/song-repository.js';
import { LocalSongGraphRepository } from '../../src/repositories/song-graph-repository.js';
import type { Song } from '../../src/domain/song/song.js';
import * as analysisAgent from '../../src/agents/analysis/index.js';
import * as feasibilityAgent from '../../src/agents/feasibility/index.js';
import * as analyzeSongModule from '../../src/application/analyze-song.js';
import { setAgentModel, resetAgentModels } from '../../src/providers/llm/model-factory.js';

const songId = 'song_a1b2c3d4e5f6';
const fixturePath = path.join(process.cwd(), 'tests/fixtures/songgraphs/perfect-ed-sheeran.json');

const song: Song = {
  id: songId,
  title: 'Perfect',
  artist: 'Ed Sheeran',
  source: { type: 'local', original: 'test.wav' },
  durationMs: 281832,
  createdAt: '2026-01-01T00:00:00.000Z',
};

let dataDir: string;
let songsDir: string;
let graphs: LocalSongGraphRepository;

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'workflow-test-'));
  songsDir = path.join(dataDir, 'songs');
  process.env.GUITAR_DATA_DIR = dataDir;
  process.env.LLM_DEFAULT_MODEL = 'test-model';
  process.env.ANTHROPIC_API_KEY = 'test-key';

  await mkdir(path.join(songsDir, songId), { recursive: true });
  await writeFile(path.join(songsDir, songId, 'metadata.json'), JSON.stringify(song));

  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  fixture.id = songId;
  await writeFile(path.join(songsDir, songId, 'graph.json'), JSON.stringify(fixture));

  graphs = new LocalSongGraphRepository(songsDir);

  const dummyModel = { modelName: 'test-model' } as unknown as import('@langchain/core/language_models/chat_models').BaseChatModel;
  setAgentModel('analysis', dummyModel);
  setAgentModel('feasibility', dummyModel);

  vi.spyOn(analyzeSongModule, 'analyzeSong').mockImplementation(async (id, deps) => {
    const graph = await deps.graphs.load(id);
    return {
      graph,
      graphPath: path.join(songsDir, id, 'graph.json'),
      artifactsDir: path.join(songsDir, id, 'analysis'),
      cachedProviders: ['fixture'],
      ranProviders: [],
      strategy: {} as analyzeSongModule.AnalyzeResult['strategy'],
      warnings: [],
      timings: { totalMs: 0, perProvider: [], consensusMs: 0 },
      rhythmSummaries: [],
      resolvedRhythm: null,
    };
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  resetAgentModels();
  delete process.env.GUITAR_DATA_DIR;
  delete process.env.LLM_DEFAULT_MODEL;
  delete process.env.ANTHROPIC_API_KEY;
  await rm(dataDir, { recursive: true, force: true });
});

describe('song processing workflow (Test F)', () => {
  it('runs analysis -> feasibility -> arrangement -> simplification -> completed', async () => {
    const analysisSpy = vi.spyOn(analysisAgent, 'runAnalysisAgent').mockResolvedValue({
      decision: {
        status: 'ACCEPT_WITH_WARNINGS',
        confidence: 0.82,
        interpretation: {
          tempoAssessment: 'COHERENT',
          harmonyAssessment: 'COHERENT',
          structureAssessment: 'COHERENT',
        },
        warnings: ['minor section boundary uncertainty'],
        evidence: ['tempo consensus stable'],
        recommendedAction: 'CONTINUE',
      },
      provenance: {
        agent: 'analysis',
        model: 'test-model',
        promptVersion: 'v1',
        toolCalls: [],
        latencyMs: 1,
        retryCount: 0,
      },
      variantRequests: [],
    });

    const feasibilitySpy = vi.spyOn(feasibilityAgent, 'runFeasibilityAgent').mockResolvedValue({
      decision: {
        strategy: 'GENERATE_HARMONY_ARRANGEMENT',
        confidence: 0.88,
        usableSections: ['VERSE', 'CHORUS'],
        riskySections: [],
        limitations: ['Simplified harmonic arrangement, not original guitar transcription'],
        reasons: ['usable chord consensus across sections'],
      },
      provenance: {
        agent: 'feasibility',
        model: 'test-model',
        promptVersion: 'v1',
        toolCalls: [],
        latencyMs: 1,
        retryCount: 0,
      },
    });

    const { runSongProcessing } = await import('../../src/workflows/song-processing/graph.js');
    const deps = {
      songs: new LocalSongRepository(songsDir),
      graphs,
      songsDir,
    };

    const result = await runSongProcessing(songId, { dryRun: true, analysisDeps: deps });

    expect(result.status).toBe('COMPLETED');
    expect(result.analysisDecision?.status).toBe('ACCEPT_WITH_WARNINGS');
    expect(result.feasibilityDecision?.strategy).toBe('GENERATE_HARMONY_ARRANGEMENT');
    expect(result.baseArrangement).toBeDefined();
    expect(result.arrangements.length).toBeGreaterThan(0);
    expect(result.arrangements[0]?.difficulty).toBeDefined();

    const nodes = result.trace.map((e) => e.node);
    expect(nodes).toContain('LOAD_SONG');
    expect(nodes).toContain('ENSURE_ANALYSIS');
    expect(nodes).toContain('ANALYSIS_AGENT');
    expect(nodes).toContain('FEASIBILITY_AGENT');
    expect(nodes).toContain('BUILD_BASE_ARRANGEMENT');
    expect(nodes).toContain('SIMPLIFY_ARRANGEMENT');

    analysisSpy.mockRestore();
    feasibilitySpy.mockRestore();
  });

  it('DEFER feasibility produces no arrangements', async () => {
    vi.spyOn(analysisAgent, 'runAnalysisAgent').mockResolvedValue({
      decision: {
        status: 'ACCEPT',
        confidence: 0.9,
        interpretation: {
          tempoAssessment: 'COHERENT',
          harmonyAssessment: 'COHERENT',
          structureAssessment: 'COHERENT',
        },
        warnings: [],
        evidence: [],
        recommendedAction: 'CONTINUE',
      },
      provenance: {
        agent: 'analysis',
        model: 'test-model',
        promptVersion: 'v1',
        toolCalls: [],
        latencyMs: 1,
        retryCount: 0,
      },
      variantRequests: [],
    });

    vi.spyOn(feasibilityAgent, 'runFeasibilityAgent').mockResolvedValue({
      decision: {
        strategy: 'DEFER_LOW_CONFIDENCE',
        confidence: 0.15,
        usableSections: [],
        riskySections: ['VERSE'],
        limitations: ['harmony too uncertain for a lesson'],
        reasons: [],
      },
      provenance: {
        agent: 'feasibility',
        model: 'test-model',
        promptVersion: 'v1',
        toolCalls: [],
        latencyMs: 1,
        retryCount: 0,
      },
    });

    const { runSongProcessing } = await import('../../src/workflows/song-processing/graph.js');
    const deps = {
      songs: new LocalSongRepository(songsDir),
      graphs,
      songsDir,
    };

    const result = await runSongProcessing(songId, { dryRun: true, analysisDeps: deps });
    expect(result.status).toBe('DEFERRED');
    expect(result.arrangements).toHaveLength(0);
    expect(result.trace.map((e) => e.node)).not.toContain('BUILD_BASE_ARRANGEMENT');
  });
});
