/** Agent model configuration. Agents never hardcode a provider; the factory
 * resolves role-specific models from the environment. */
export type LlmProvider = 'anthropic' | 'google-vertex';

export interface AgentModelConfig {
  model: string;
  provider: LlmProvider;
  /** Anthropic only — Gemini 3.7 should use model defaults. */
  temperature?: number;
  /** Gemini 3 thinking level (low/medium). */
  thinkingLevel?: 'low' | 'medium' | 'high';
}

const cleanModel = (value: string): string =>
  // some environments annotate context size in brackets: "model-x[1m]"
  value.trim().replace(/\[[^\]]*\]$/, '').trim();

const firstEnv = (...names: string[]): string | undefined => {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value.trim() !== '') return cleanModel(value);
  }
  return undefined;
};

export function resolveModelProvider(model: string): LlmProvider {
  const id = model.toLowerCase();
  if (id.startsWith('gemini')) return 'google-vertex';
  if (id.startsWith('claude')) return 'anthropic';
  // legacy default: Anthropic-compatible endpoints
  return 'anthropic';
}

export function resolveGoogleCloudProject(): string | undefined {
  return firstEnv('GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT', 'GCLOUD_PROJECT');
}

export function resolveGoogleCloudLocation(): string {
  return firstEnv('GOOGLE_CLOUD_LOCATION', 'GCP_LOCATION') ?? 'global';
}

/** Specific role model -> default model -> undefined (no LLM available). */
export function resolveAgentModelConfig(role: 'analysis' | 'feasibility'): AgentModelConfig | null {
  const specific = firstEnv(`LLM_${role.toUpperCase()}_MODEL`);
  const fallback = firstEnv('LLM_DEFAULT_MODEL', 'ANTHROPIC_MODEL');
  const model = specific ?? fallback;
  if (model === undefined) return null;

  const provider = resolveModelProvider(model);
  if (provider === 'google-vertex') {
    return {
      model,
      provider,
      thinkingLevel: 'low',
    };
  }
  return { model, provider, temperature: 0 };
}

export function llmCredentialsAvailable(config: AgentModelConfig): boolean {
  if (config.provider === 'google-vertex') {
    // ADC is validated at invoke time; project is required to build Vertex URLs.
    return resolveGoogleCloudProject() !== undefined;
  }
  return (
    (process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? '') !== '' ||
    (process.env.OPENAI_API_KEY ?? '') !== ''
  );
}
