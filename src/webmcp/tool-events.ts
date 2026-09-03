/** Agent activity feed — one small log the UI subscribes to. */

export type ActivityListener = (message: string) => void;

const listeners = new Set<ActivityListener>();

export function onActivity(listener: ActivityListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function logActivity(message: string): void {
  for (const listener of listeners) listener(message);
}

/** Debug overlay data: last tool invocation name + duration (dev only). */
export interface ToolInvocation {
  tool: string;
  durationMs: number;
  /** One-line result summary for the ?debug=webmcp table. */
  result?: string;
}

/** Per-tool last invocation, for the debug tool table. */
const lastByTool = new Map<string, ToolInvocation>();

export function lastInvocationOf(tool: string): ToolInvocation | undefined {
  return lastByTool.get(tool);
}

let lastInvocation: ToolInvocation | null = null;
const invocationListeners = new Set<(invocation: ToolInvocation) => void>();

export function recordToolInvocation(tool: string, startedAtMs: number, result?: string): void {
  lastInvocation = {
    tool,
    durationMs: Math.round(performance.now() - startedAtMs),
    ...(result !== undefined && { result }),
  };
  lastByTool.set(tool, lastInvocation);
  for (const listener of invocationListeners) listener(lastInvocation);
}

export function onToolInvocation(listener: (invocation: ToolInvocation) => void): () => void {
  invocationListeners.add(listener);
  if (lastInvocation !== null) listener(lastInvocation);
  return () => invocationListeners.delete(listener);
}
