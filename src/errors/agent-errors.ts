export type AgentErrorCode =
  | 'AGENT_MODEL_UNAVAILABLE'
  | 'AGENT_OUTPUT_INVALID'
  | 'AGENT_TOOL_FAILED'
  | 'AGENT_TIMEOUT'
  | 'WORKFLOW_FAILED';

export class AgentError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AgentError';
  }
}
