import { Annotation } from '@langchain/langgraph';
import { z } from 'zod';
import { SongSchema } from '../../domain/song/song.js';
import { AnalysisAgentDecisionSchema } from '../../domain/agent/analysis-decision.js';
import { GuitarFeasibilityDecisionSchema } from '../../domain/agent/feasibility-decision.js';
import { WorkflowTraceEventSchema, WorkflowWarningSchema, WorkflowErrorSchema, type AgentRunProvenance } from '../../domain/agent/workflow-trace.js';
import type { SongGraph } from '../../domain/music/song-graph.js';
import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import type { AnalyzeResult } from '../../application/analyze-song.js';

/**
 * Typed workflow state. Nodes return partial updates for their own fields
 * only; the graph merges them. Zod-validated channel contents where the
 * payload crosses a trust boundary (agent decisions).
 */
export const SongProcessingState = Annotation.Root({
  jobId: Annotation<string>,
  songId: Annotation<string>,
  dryRun: Annotation<boolean>,

  song: Annotation<z.infer<typeof SongSchema> | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  analysisResult: Annotation<AnalyzeResult | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  songGraph: Annotation<SongGraph | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  analysisDecision: Annotation<z.infer<typeof AnalysisAgentDecisionSchema> | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  feasibilityDecision: Annotation<z.infer<typeof GuitarFeasibilityDecisionSchema> | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  baseArrangement: Annotation<GuitarArrangement | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  candidateArrangements: Annotation<GuitarArrangement[] | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),
  finalArrangements: Annotation<GuitarArrangement[] | undefined>({
    reducer: (_prev, next) => next,
    default: () => undefined,
  }),

  warnings: Annotation<z.infer<typeof WorkflowWarningSchema>[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  errors: Annotation<z.infer<typeof WorkflowErrorSchema>[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  trace: Annotation<z.infer<typeof WorkflowTraceEventSchema>[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  agentProvenance: Annotation<Record<string, AgentRunProvenance>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
  retryCounts: Annotation<{ analysisAgent: number }>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({ analysisAgent: 0 }),
  }),
});

export type SongProcessingState = typeof SongProcessingState.State;

export const SONG_PROCESSING_GRAPH_VERSION = '1';
export const MAX_ANALYSIS_RETRIES = 1;
