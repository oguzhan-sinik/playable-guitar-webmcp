import { END, START, StateGraph } from '@langchain/langgraph';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { config } from '../../config/env.js';
import { AgentError } from '../../errors/agent-errors.js';
import { getAgentModel } from '../../providers/llm/model-factory.js';
import { resolveAgentModelConfig } from '../../providers/llm/config.js';
import { runAnalysisAgent, buildAnalysisEvidenceSummary, ANALYSIS_PROMPT_VERSION } from '../../agents/analysis/index.js';
import { runFeasibilityAgent, FEASIBILITY_PROMPT_VERSION, type FeasibilityEvidence } from '../../agents/feasibility/index.js';
import {
  buildAgentCacheKey,
  hashAnalysisDecision,
  hashSongGraphStable,
  hashSongGraphFromDisk,
  findCachedAgentByKey,
  loadCachedAgentResult,
  saveCachedAgentResult,
} from '../../agents/cache.js';
import type { SongProcessingResult } from './result.js';
import { SongProcessingState, SONG_PROCESSING_GRAPH_VERSION, MAX_ANALYSIS_RETRIES, type SongProcessingState as State } from './state.js';
import { routeAnalysis, routeFeasibility } from './routing.js';
import { createTraceRecorder, type TraceRecorder } from './trace.js';
import {
  buildArrangementNode,
  ensureAnalysisNode,
  feasibilityAgentNode,
  loadSongNode,
  simplifyArrangementNode,
  targetedAnalysisNode,
  analysisAgentNode,
} from './nodes.js';
import type { AnalyzeSongDeps } from '../../application/analyze-song.js';
import { SKILL_PRESETS, type SkillLevel } from '../../domain/skill/skill-preset.js';
import { buildArrangementLadder, selectForSkill } from '../../engines/arrangement/skill-selection.js';
import { explainArrangement } from '../../engines/arrangement/explain-arrangement.js';
import { recommendFirstSection } from '../../engines/arrangement/recommend-section.js';
import { buildLessonPlan } from '../../engines/arrangement/lesson-plan.js';
import type { AnalysisAgentDecision } from '../../domain/agent/analysis-decision.js';
import type { GuitarFeasibilityDecision } from '../../domain/agent/feasibility-decision.js';

export interface SongProcessingWorkflowOptions {
  dryRun?: boolean;
  analysisDeps?: AnalyzeSongDeps;
  forceAgents?: boolean;
  skillLevel?: SkillLevel;
}

export async function runSongProcessing(
  songId: string,
  options: SongProcessingWorkflowOptions = {},
): Promise<SongProcessingResult> {
  const jobId = `job_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const recorder: TraceRecorder = createTraceRecorder();
  const skillLevel = options.skillLevel ?? 'BEGINNER';
  const agentCacheHits = { analysis: false, feasibility: false };

  const analysisDeps = options.analysisDeps ?? {
    songs: new (await import('../../repositories/song-repository.js')).LocalSongRepository(config.songsDir),
    graphs: new (await import('../../repositories/song-graph-repository.js')).LocalSongGraphRepository(config.songsDir),
  };

  const analysisModelConfig = resolveAgentModelConfig('analysis');
  const feasibilityModelConfig = resolveAgentModelConfig('feasibility');
  if (analysisModelConfig === null || feasibilityModelConfig === null) {
    throw new AgentError('AGENT_MODEL_UNAVAILABLE', 'No model configured for agents');
  }

  let analysisModel;
  let feasibilityModel;
  try {
    analysisModel = await getAgentModel('analysis');
    feasibilityModel = await getAgentModel('feasibility');
  } catch (err) {
    throw new AgentError('AGENT_MODEL_UNAVAILABLE', (err as Error).message, { cause: err });
  }

  const songsDir = analysisDeps.songsDir ?? config.songsDir;

  const workflow = new StateGraph(SongProcessingState)
    .addNode('load-song', async (state: State) => recorder.wrap('LOAD_SONG', () => loadSongNode(state, { analysis: analysisDeps })))
    .addNode('ensure-analysis', async (state: State) =>
      recorder.wrap('ENSURE_ANALYSIS', () => ensureAnalysisNode(state, { analysis: analysisDeps }), (r) =>
        r.analysisResult !== undefined ? 'loaded' : undefined,
      ),
    )
    .addNode('analysis-agent', async (state: State) =>
      recorder.wrap(
        'ANALYSIS_AGENT',
        async () => {
          const retryUsed = state.retryCounts.analysisAgent >= MAX_ANALYSIS_RETRIES;
          const graphHash = await hashSongGraphFromDisk(state.songId, songsDir);
          const cacheKey = buildAgentCacheKey({
            agent: 'analysis',
            graphHash,
            model: analysisModelConfig.model,
            promptVersion: ANALYSIS_PROMPT_VERSION,
          });

          if (options.forceAgents !== true) {
            const cached = await findCachedAgentByKey<AnalysisAgentDecision>(state.songId, 'analysis', cacheKey, songsDir);
            if (cached !== null) {
              agentCacheHits.analysis = true;
              return analysisAgentNode(cached.decision, { analysis: { ...cached.provenance, cached: true, latencyMs: 0 } });
            }
          }

          const evidence = buildAnalysisEvidenceSummary(state.songGraph!, state.analysisResult ?? null);
          const run = await runAnalysisAgent(analysisModel, evidence, {
            retryAlreadyUsed: retryUsed,
            modelConfig: analysisModelConfig,
          });
          if (options.dryRun !== true) {
            await saveCachedAgentResult(state.songId, 'analysis', cacheKey, run.decision, run.provenance, songsDir);
          }
          return analysisAgentNode(run.decision, { analysis: run.provenance });
        },
        () => (agentCacheHits.analysis ? 'cached' : undefined),
      ),
    )
    .addNode('targeted-analysis', async (state: State) =>
      recorder.wrap('TARGETED_ANALYSIS', () => targetedAnalysisNode(state, { analysis: analysisDeps })),
    )
    .addNode('feasibility-agent', async (state: State) =>
      recorder.wrap(
        'FEASIBILITY_AGENT',
        async () => {
          const graphHash = await hashSongGraphFromDisk(state.songId, songsDir);
          const analysisHash = hashAnalysisDecision(state.analysisDecision!);
          const cacheKey = buildAgentCacheKey({
            agent: 'feasibility',
            graphHash,
            model: feasibilityModelConfig.model,
            promptVersion: FEASIBILITY_PROMPT_VERSION,
            analysisHash,
          });

          if (options.forceAgents !== true) {
            const cached = await findCachedAgentByKey<GuitarFeasibilityDecision>(state.songId, 'feasibility', cacheKey, songsDir);
            if (cached !== null) {
              agentCacheHits.feasibility = true;
              return feasibilityAgentNode(cached.decision, { feasibility: { ...cached.provenance, cached: true, latencyMs: 0 } });
            }
          }

          const evidence: FeasibilityEvidence = {
            song: state.songGraph!,
            analysisDecision: state.analysisDecision!,
            capabilities: (await import('../../agents/feasibility/index.js')).CURRENT_CAPABILITIES,
          };
          const run = await runFeasibilityAgent(feasibilityModel, evidence, { modelConfig: feasibilityModelConfig });
          if (options.dryRun !== true) {
            await saveCachedAgentResult(state.songId, 'feasibility', cacheKey, run.decision, run.provenance, songsDir);
          }
          return feasibilityAgentNode(run.decision, { feasibility: run.provenance });
        },
        () => (agentCacheHits.feasibility ? 'cached' : undefined),
      ),
    )
    .addNode('build-base-arrangement', async (state: State) =>
      recorder.wrap('BUILD_BASE_ARRANGEMENT', () => buildArrangementNode(state), (r) =>
        r.baseArrangement !== undefined ? `${r.baseArrangement.chords.length} chord events` : undefined,
      ),
    )
    .addNode('simplify-arrangement', async (state: State) =>
      recorder.wrap('SIMPLIFY_ARRANGEMENT', () => simplifyArrangementNode(state), (r) =>
        `${r.finalArrangements?.length ?? 0} frontier candidates`,
      ),
    )
    .addNode('finalize', async (state: State) => {
      if (options.dryRun !== true) {
        await persistAgentResults(state, recorder);
      }
      return {};
    })
    .addEdge(START, 'load-song')
    .addEdge('load-song', 'ensure-analysis')
    .addEdge('ensure-analysis', 'analysis-agent')
    .addConditionalEdges('analysis-agent', routeAnalysis)
    .addEdge('targeted-analysis', 'analysis-agent')
    .addConditionalEdges('feasibility-agent', routeFeasibility)
    .addEdge('build-base-arrangement', 'simplify-arrangement')
    .addEdge('simplify-arrangement', 'finalize')
    .addEdge('finalize', END);

  const app = workflow.compile();
  const startedAt = new Date().toISOString();
  let finalState: State;
  let status: SongProcessingResult['status'];
  try {
    finalState = (await app.invoke({ jobId, songId, dryRun: options.dryRun === true }, { recursionLimit: 30 })) as State;
    status =
      finalState.feasibilityDecision?.strategy === 'DEFER_LOW_CONFIDENCE' || finalState.analysisDecision?.status === 'DEFER'
        ? 'DEFERRED'
        : 'COMPLETED';
  } catch (err) {
    status = 'FAILED';
    await persistRun(songId, jobId, startedAt, status, recorder, null);
    if (err instanceof AgentError) throw err;
    throw new AgentError('WORKFLOW_FAILED', `Song processing failed: ${(err as Error).message}`, { cause: err });
  }

  const candidates = finalState.finalArrangements ?? [];
  const base = finalState.baseArrangement;
  const preset = SKILL_PRESETS[skillLevel];
  const pool =
    status === 'COMPLETED' && base !== undefined
      ? candidates.length > 0
        ? [base, ...candidates]
        : [base]
      : [];
  const recommended =
    status === 'COMPLETED' && pool.length > 0
      ? selectForSkill(pool, preset) ?? base
      : undefined;
  const ladder =
    status === 'COMPLETED' && base !== undefined
      ? buildArrangementLadder(pool.length > 0 ? pool : [base], base)
      : undefined;

  const recommendedSection = finalState.songGraph !== undefined ? recommendFirstSection(finalState.songGraph) : undefined;

  const result: SongProcessingResult = {
    jobId,
    songId,
    status,
    ...(finalState.analysisDecision !== undefined && { analysisDecision: finalState.analysisDecision }),
    ...(finalState.feasibilityDecision !== undefined && { feasibilityDecision: finalState.feasibilityDecision }),
    arrangements: status === 'COMPLETED' ? candidates : [],
    warnings: finalState.warnings,
    trace: recorder.events,
    ...(status === 'COMPLETED' && base !== undefined && { baseArrangement: base }),
    selectedLevel: skillLevel,
    ...(recommended !== undefined && { recommendedArrangement: recommended }),
    ...(ladder !== undefined && { arrangementLadder: ladder }),
    ...(base !== undefined &&
      recommended !== undefined && { explanation: explainArrangement(base, recommended) }),
    ...(recommendedSection !== undefined ? { recommendedSection } : {}),
    ...(recommended !== undefined && { lessonSteps: buildLessonPlan(recommended) }),
    agentCache: agentCacheHits,
  };

  await persistRun(songId, jobId, startedAt, status, recorder, result);
  return result;
}

async function persistAgentResults(state: State, recorder: TraceRecorder): Promise<void> {
  const dir = path.join(config.songsDir, state.songId, 'agents');
  if (state.analysisDecision !== undefined) {
    const file = path.join(dir, 'analysis', 'latest.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({ decision: state.analysisDecision, provenance: state.agentProvenance.analysis ?? null, trace: recorder.events }, null, 2) + '\n',
    );
  }
  if (state.feasibilityDecision !== undefined) {
    const file = path.join(dir, 'feasibility', 'latest.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({ decision: state.feasibilityDecision, provenance: state.agentProvenance.feasibility ?? null }, null, 2) + '\n',
    );
  }
}

async function persistRun(
  songId: string,
  jobId: string,
  startedAt: string,
  status: SongProcessingResult['status'],
  recorder: TraceRecorder,
  result: SongProcessingResult | null,
): Promise<void> {
  const dir = path.join(config.songsDir, songId, 'agents', 'runs', jobId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'result.json'),
    JSON.stringify(
      {
        jobId,
        songId,
        graphVersion: SONG_PROCESSING_GRAPH_VERSION,
        startedAt,
        completedAt: new Date().toISOString(),
        status,
        ...(result !== null && { result }),
        trace: recorder.events,
      },
      null,
      2,
    ) + '\n',
  );
}
