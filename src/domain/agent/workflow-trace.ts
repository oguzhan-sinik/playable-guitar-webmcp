import { z } from 'zod';

export const WorkflowTraceEventSchema = z.object({
  node: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  status: z.enum(['SUCCESS', 'FAILED', 'SKIPPED']),
  summary: z.string().optional(),
});
export type WorkflowTraceEvent = z.infer<typeof WorkflowTraceEventSchema>;

export const WorkflowWarningSchema = z.object({
  node: z.string(),
  message: z.string(),
});
export type WorkflowWarning = z.infer<typeof WorkflowWarningSchema>;

export const WorkflowErrorSchema = z.object({
  node: z.string(),
  code: z.string(),
  message: z.string(),
});
export type WorkflowError = z.infer<typeof WorkflowErrorSchema>;

/** Agent run provenance — kept separate from CLI output. */
export interface AgentRunProvenance {
  agent: string;
  provider?: string;
  model: string;
  promptVersion: string;
  toolCalls: string[];
  latencyMs: number;
  retryCount: number;
  cached?: boolean;
  tokenUsage?: { input: number; output: number };
}

export interface AgentResultBundle<T> {
  decision: T;
  provenance: AgentRunProvenance;
}
