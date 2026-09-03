/**
 * Minimal ambient types for the browser-native WebMCP API
 * (`document.modelContext`, Chrome 149+ / WebMCP testing flag).
 * Kept local so we use the native API directly instead of a dependency.
 */
interface WebMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Tool Metadata hints (e.g. readOnlyHint) — part of the WebMCP surface. */
  annotations?: { readOnlyHint?: boolean; [key: string]: unknown };
  execute(input: Record<string, unknown>): Promise<unknown>;
}

interface ModelContext {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): Promise<void> | void;
}

interface Document {
  modelContext?: ModelContext;
}
