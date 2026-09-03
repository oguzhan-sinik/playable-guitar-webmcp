import { createAgent } from 'langchain';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { GuitarFeasibilityDecisionSchema, type GuitarFeasibilityDecision } from '../../domain/agent/feasibility-decision.js';
import { AgentError } from '../../errors/agent-errors.js';
import type { AgentRunProvenance } from '../../domain/agent/workflow-trace.js';
import { createFeasibilityTools } from './tools.js';
import { FEASIBILITY_PROMPT_VERSION, FEASIBILITY_SYSTEM_PROMPT, feasibilityUserPrompt, type FeasibilityEvidence } from './prompt.v1.js';
import type { AgentModelConfig } from '../../providers/llm/config.js';

export { FEASIBILITY_PROMPT_VERSION };
export { GuitarFeasibilityDecisionSchema };
export type { FeasibilityEvidence };

const MAX_TOOL_CALLS = 3;

export interface FeasibilityAgentRun {
  decision: GuitarFeasibilityDecision;
  provenance: AgentRunProvenance;
}

/** Runs the Guitar Feasibility Agent with strict structured output. */
export async function runFeasibilityAgent(
  model: BaseChatModel,
  evidence: FeasibilityEvidence,
  options: { modelConfig?: AgentModelConfig } = {},
): Promise<FeasibilityAgentRun> {
  const agent = createAgent({
    model,
    tools: createFeasibilityTools(evidence),
    responseFormat: GuitarFeasibilityDecisionSchema,
  });

  const started = Date.now();
  let raw: Awaited<ReturnType<typeof agent.invoke>>;
  try {
    raw = await agent.invoke(
      {
        messages: [
          { role: 'system', content: FEASIBILITY_SYSTEM_PROMPT },
          { role: 'user', content: feasibilityUserPrompt(evidence) },
        ],
      },
      { recursionLimit: 12 + MAX_TOOL_CALLS },
    );
  } catch (err) {
    throw new AgentError('AGENT_TIMEOUT', `Feasibility agent failed: ${(err as Error).message}`, { cause: err });
  }

  const parsed = GuitarFeasibilityDecisionSchema.safeParse(raw.structuredResponse);
  if (!parsed.success) {
    throw new AgentError('AGENT_OUTPUT_INVALID', `Feasibility agent returned invalid structured output: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }

  const toolCalls = raw.messages
    .flatMap((m) => (('tool_calls' in m && Array.isArray(m.tool_calls)) ? (m.tool_calls as Array<{ name: string }>) : []))
    .map((c) => c.name);

  const provenance: AgentRunProvenance = {
    agent: 'feasibility',
    model: options.modelConfig?.model ?? (model as unknown as { modelName?: string }).modelName ?? 'unknown',
    promptVersion: FEASIBILITY_PROMPT_VERSION,
    toolCalls,
    latencyMs: Date.now() - started,
    retryCount: 0,
    ...(options.modelConfig?.provider !== undefined && { provider: options.modelConfig.provider }),
  };

  return { decision: parsed.data, provenance };
}
