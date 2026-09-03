import { afterEach, describe, expect, it } from 'vitest';
import {
  llmCredentialsAvailable,
  resolveAgentModelConfig,
  resolveGoogleCloudLocation,
  resolveGoogleCloudProject,
  resolveModelProvider,
} from '../../src/providers/llm/config.js';

describe('LLM provider config', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  it('routes gemini-3.7-flash to google-vertex provider', () => {
    expect(resolveModelProvider('gemini-3.7-flash')).toBe('google-vertex');
    process.env.LLM_DEFAULT_MODEL = 'gemini-3.7-flash';
    const cfg = resolveAgentModelConfig('analysis');
    expect(cfg?.provider).toBe('google-vertex');
    expect(cfg?.model).toBe('gemini-3.7-flash');
  });

  it('resolves Vertex config when GOOGLE_CLOUD_PROJECT is set', () => {
    process.env.LLM_DEFAULT_MODEL = 'gemini-3.7-flash';
    process.env.GOOGLE_CLOUD_PROJECT = 'my-gcp-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'global';
    expect(resolveGoogleCloudProject()).toBe('my-gcp-project');
    expect(resolveGoogleCloudLocation()).toBe('global');
    const cfg = resolveAgentModelConfig('feasibility')!;
    expect(llmCredentialsAvailable(cfg)).toBe(true);
  });

  it('does not require GOOGLE_API_KEY for Vertex path', () => {
    process.env.LLM_DEFAULT_MODEL = 'gemini-3.7-flash';
    process.env.GOOGLE_CLOUD_PROJECT = 'my-gcp-project';
    delete process.env.GOOGLE_API_KEY;
    const cfg = resolveAgentModelConfig('analysis')!;
    expect(cfg.provider).toBe('google-vertex');
    expect(llmCredentialsAvailable(cfg)).toBe(true);
  });

  it('keeps claude on anthropic provider', () => {
    process.env.LLM_DEFAULT_MODEL = 'claude-sonnet-4-20250514';
    delete process.env.LLM_ANALYSIS_MODEL;
    delete process.env.LLM_FEASIBILITY_MODEL;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    const cfg = resolveAgentModelConfig('analysis');
    expect(cfg?.provider).toBe('anthropic');
    expect(cfg?.temperature).toBe(0);
  });
});
