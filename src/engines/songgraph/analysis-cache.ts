import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { RawMusicAnalysisSchema, type RawMusicAnalysis } from '../../domain/analysis/raw-music-analysis.js';
import { ANALYSIS_PIPELINE_VERSION } from './config.js';
import { AppError } from '../../errors/app-error.js';

/** Normalized analysis artifact persisted next to the raw provider output.
 * The meta block is the cache key: pipeline version + provider + source audio
 * content hash. Any change invalidates the cache. */
export const NormalizedAnalysisArtifactSchema = z.object({
  meta: z.object({
    pipelineVersion: z.string(),
    provider: z.string(),
    providerVersion: z.string().optional(),
    sourceAudioSha256: z.string(),
    analyzedAt: z.string(),
  }),
  analysis: RawMusicAnalysisSchema,
});
export type NormalizedAnalysisArtifact = z.infer<typeof NormalizedAnalysisArtifactSchema>;

export async function hashFile(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

export function cacheFingerprint(input: {
  sourceAudioSha256: string;
  provider: string;
  pipelineVersion?: string;
}): string {
  return [input.pipelineVersion ?? ANALYSIS_PIPELINE_VERSION, input.provider, input.sourceAudioSha256].join(':');
}

/** Valid only when provider, pipeline version, and source audio all match. */
export function isCacheValid(
  artifact: NormalizedAnalysisArtifact | null,
  expected: { sourceAudioSha256: string; provider: string; pipelineVersion?: string },
): boolean {
  return (
    artifact !== null &&
    artifact.meta.pipelineVersion === (expected.pipelineVersion ?? ANALYSIS_PIPELINE_VERSION) &&
    artifact.meta.provider === expected.provider &&
    artifact.meta.sourceAudioSha256 === expected.sourceAudioSha256
  );
}

export function parseArtifact(json: unknown): NormalizedAnalysisArtifact | null {
  const parsed = NormalizedAnalysisArtifactSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

export function toArtifact(
  analysis: RawMusicAnalysis,
  meta: { sourceAudioSha256: string; analyzedAt: string },
): NormalizedAnalysisArtifact {
  return {
    meta: {
      pipelineVersion: ANALYSIS_PIPELINE_VERSION,
      provider: analysis.provider,
      ...(analysis.providerVersion !== undefined && { providerVersion: analysis.providerVersion }),
      sourceAudioSha256: meta.sourceAudioSha256,
      analyzedAt: meta.analyzedAt,
    },
    analysis,
  };
}

export function assertArtifact(json: unknown): NormalizedAnalysisArtifact {
  const parsed = NormalizedAnalysisArtifactSchema.safeParse(json);
  if (!parsed.success) {
    throw new AppError('DOMAIN_VALIDATION', 'Stored analysis artifact is corrupt');
  }
  return parsed.data;
}
