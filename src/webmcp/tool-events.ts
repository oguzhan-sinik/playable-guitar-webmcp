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
}

let lastInvocation: ToolInvocation | null = null;
const invocationListeners = new Set<(invocation: ToolInvocation) => void>();

export function recordToolInvocation(tool: string, startedAtMs: number): void {
  lastInvocation = { tool, durationMs: Math.round(performance.now() - startedAtMs) };
  for (const listener of invocationListeners) listener(lastInvocation);
}

export function onToolInvocation(listener: (invocation: ToolInvocation) => void): () => void {
  invocationListeners.add(listener);
  if (lastInvocation !== null) listener(lastInvocation);
  return () => invocationListeners.delete(listener);
}
