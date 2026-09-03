import { createAgent } from 'langchain';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { z } from 'zod';
import { AnalysisAgentDecisionSchema, type AnalysisAgentDecision } from '../../domain/agent/analysis-decision.js';
import { AgentError } from '../../errors/agent-errors.js';
import type { AgentRunProvenance } from '../../domain/agent/workflow-trace.js';
import type { AnalysisEvidenceSummary } from './evidence.js';
import { createAnalysisTools, type AnalysisVariantRequest } from './tools.js';
import { ANALYSIS_PROMPT_VERSION, ANALYSIS_SYSTEM_PROMPT, analysisUserPrompt } from './prompt.v1.js';
import type { AgentModelConfig } from '../../providers/llm/config.js';

export { ANALYSIS_PROMPT_VERSION };
export { AnalysisAgentDecisionSchema };

const MAX_TOOL_CALLS = 5;

export interface AnalysisAgentRun {
  decision: AnalysisAgentDecision;
  provenance: AgentRunProvenance;
  variantRequests: AnalysisVariantRequest[];
}

/** Runs the Analysis Agent. Output is validated with Zod — the prose is never
 * parsed; an invalid structured response raises AGENT_OUTPUT_INVALID. */
export async function runAnalysisAgent(
  model: BaseChatModel,
  evidence: AnalysisEvidenceSummary,
  options: { retryAlreadyUsed?: boolean; modelConfig?: AgentModelConfig } = {},
): Promise<AnalysisAgentRun> {
  const context = { evidence, variantRequests: [] as AnalysisVariantRequest[] };
  const tools = createAnalysisTools(context);
  const agent = createAgent({
    model,
    tools,
    responseFormat: AnalysisAgentDecisionSchema,
  });

  const started = Date.now();
  let raw: Awaited<ReturnType<typeof agent.invoke>>;
  try {
    raw = await agent.invoke(
      {
        messages: [
          { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
          { role: 'user', content: analysisUserPrompt(evidence, options.retryAlreadyUsed === true) },
        ],
      },
      { recursionLimit: 20 + MAX_TOOL_CALLS },
    );
  } catch (err) {
    throw new AgentError('AGENT_TIMEOUT', `Analysis agent failed: ${(err as Error).message}`, { cause: err });
  }

  const parsed = AnalysisAgentDecisionSchema.safeParse(raw.structuredResponse);
  if (!parsed.success) {
    throw new AgentError('AGENT_OUTPUT_INVALID', `Analysis agent returned invalid structured output: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }

  const toolCalls = raw.messages
    .flatMap((m) => (('tool_calls' in m && Array.isArray(m.tool_calls)) ? (m.tool_calls as Array<{ name: string }>) : []))
    .map((c) => c.name);
  const usage = raw.messages.reduce(
    (acc, m) => {
      const meta = (m as { usage_metadata?: { input_tokens?: number; output_tokens?: number } }).usage_metadata;
      if (meta !== undefined) {
        acc.input += meta.input_tokens ?? 0;
        acc.output += meta.output_tokens ?? 0;
      }
      return acc;
    },
    { input: 0, output: 0 },
  );

  const provenance: AgentRunProvenance = {
    agent: 'analysis',
    model: options.modelConfig?.model ?? (model as unknown as { modelName?: string }).modelName ?? 'unknown',
    promptVersion: ANALYSIS_PROMPT_VERSION,
    toolCalls,
    latencyMs: Date.now() - started,
    retryCount: options.retryAlreadyUsed === true ? 1 : 0,
    ...(options.modelConfig?.provider !== undefined && { provider: options.modelConfig.provider }),
    ...(usage.input + usage.output > 0 ? { tokenUsage: usage } : {}),
  };

  return { decision: parsed.data, provenance, variantRequests: context.variantRequests };
}
