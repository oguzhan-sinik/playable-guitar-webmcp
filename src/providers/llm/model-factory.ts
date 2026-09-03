import { createRequire } from 'node:module';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AgentError } from '../../errors/agent-errors.js';
import {
  llmCredentialsAvailable,
  resolveAgentModelConfig,
  resolveGoogleCloudLocation,
  resolveGoogleCloudProject,
  type AgentModelConfig,
} from './config.js';

export type AgentRole = 'analysis' | 'feasibility';

const instances = new Map<string, BaseChatModel>();

function createAnthropicModel(config: AgentModelConfig): BaseChatModel {
  const require = createRequire(import.meta.url);
  const { ChatAnthropic } = require('@langchain/anthropic') as typeof import('@langchain/anthropic');
  const { default: Anthropic } = require('@anthropic-ai/sdk') as typeof import('@anthropic-ai/sdk');

  return new ChatAnthropic({
    model: config.model,
    temperature: config.temperature ?? 0,
    maxRetries: 1,
    createClient: (options) =>
      new Anthropic({
        ...(options as ConstructorParameters<typeof Anthropic>[0]),
        ...(process.env.ANTHROPIC_AUTH_TOKEN !== undefined && { authToken: process.env.ANTHROPIC_AUTH_TOKEN }),
        ...(process.env.ANTHROPIC_BASE_URL !== undefined && { baseURL: process.env.ANTHROPIC_BASE_URL }),
      }),
  }) as unknown as BaseChatModel;
}

async function createGoogleVertexModel(config: AgentModelConfig): Promise<BaseChatModel> {
  const projectId = resolveGoogleCloudProject();
  if (projectId === undefined) {
    throw new AgentError(
      'AGENT_MODEL_UNAVAILABLE',
      'GOOGLE_CLOUD_PROJECT is required for Vertex AI (set it to your GCP project id)',
    );
  }

  const { ChatGoogle } = await import('@langchain/google/node');
  return new ChatGoogle({
    model: config.model,
    platformType: 'gcp',
    location: resolveGoogleCloudLocation(),
    maxRetries: 2,
    // Explicit googleAuthOptions avoids falling back to GOOGLE_API_KEY / AI Studio.
    googleAuthOptions: {
      projectId,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    },
    ...(config.thinkingLevel !== undefined && { thinkingLevel: config.thinkingLevel }),
  }) as unknown as BaseChatModel;
}

async function createModel(config: AgentModelConfig): Promise<BaseChatModel> {
  return config.provider === 'google-vertex'
    ? createGoogleVertexModel(config)
    : createAnthropicModel(config);
}

/**
 * One model instance per role, created lazily and reused (never per tool call).
 * Provider choice is isolated here: Gemini via Vertex ADC, Anthropic for Claude.
 */
export async function getAgentModel(
  role: AgentRole,
  configOverride?: AgentModelConfig,
): Promise<BaseChatModel> {
  const resolved = configOverride ?? resolveAgentModelConfig(role);
  const cacheKey = `${role}:${resolved?.model ?? ''}:${resolved?.provider ?? ''}`;
  const cached = instances.get(cacheKey);
  if (cached !== undefined) return cached;

  if (resolved === undefined || resolved === null) {
    throw new AgentError(
      'AGENT_MODEL_UNAVAILABLE',
      `No model configured for the ${role} agent (set LLM_DEFAULT_MODEL and credentials)`,
    );
  }
  if (!llmCredentialsAvailable(resolved)) {
    const hint =
      resolved.provider === 'google-vertex'
        ? 'Set GOOGLE_CLOUD_PROJECT and run: gcloud auth application-default login'
        : 'No LLM credentials in environment';
    throw new AgentError('AGENT_MODEL_UNAVAILABLE', hint);
  }

  const model = await createModel(resolved);
  instances.set(cacheKey, model);
  return model;
}

/** Test/evaluation hook: inject a custom model per role. */
export function setAgentModel(role: AgentRole, model: BaseChatModel, configKey = 'custom'): void {
  instances.set(`${role}:${configKey}:`, model);
}

export function resetAgentModels(): void {
  instances.clear();
}
