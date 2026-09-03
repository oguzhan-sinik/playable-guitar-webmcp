import { WorkflowTraceEventSchema, type WorkflowTraceEvent } from '../../domain/agent/workflow-trace.js';

export interface TraceRecorder {
  events: WorkflowTraceEvent[];
  wrap<T>(node: string, fn: () => T | Promise<T>, summarize?: (result: Awaited<T>) => string | undefined): Promise<Awaited<T>>;
}

/** Traces node execution; failures are recorded then rethrown. */
export function createTraceRecorder(): TraceRecorder {
  const events: WorkflowTraceEvent[] = [];
  const wrap = async <T>(node: string, fn: () => T | Promise<T>, summarize?: (result: Awaited<T>) => string | undefined): Promise<Awaited<T>> => {
      const startedAt = new Date().toISOString();
      try {
        const result = (await fn()) as Awaited<T>;
        events.push(
          WorkflowTraceEventSchema.parse({
            node,
            startedAt,
            completedAt: new Date().toISOString(),
            status: 'SUCCESS',
            ...(summarize !== undefined && { summary: summarize(result) }),
          }),
        );
        return result;
      } catch (err) {
        events.push(
          WorkflowTraceEventSchema.parse({
            node,
            startedAt,
            completedAt: new Date().toISOString(),
            status: 'FAILED',
            summary: (err as Error).message.slice(0, 200),
          }),
        );
        throw err;
      }
  };
  return { events, wrap };
}
