import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import type { SongRepository } from '../repositories/song-repository.js';
import type { SongGraphRepository } from '../repositories/song-graph-repository.js';
import type { MusicAnalysisProvider, PartialRawMusicAnalysis } from '../providers/music-analysis/music-analysis-provider.js';
import type { StemSeparationProvider } from '../providers/music-analysis/registry.js';
import { createProvider } from '../providers/music-analysis/registry.js';
import { buildAudioVariants } from '../providers/music-analysis/audio-variant.js';
import type { SongGraph } from '../domain/music/song-graph.js';
import type {
  AnalysisAudioVariant,
  ChordAnalysisResult,
  RhythmProviderResult,
  ResolvedRhythm,
  TempoCandidate,
} from '../domain/analysis/raw-music-analysis.js';
import { type BeatEvent, type TimeSignature } from '../domain/music/beat.js';
import { ANALYSIS_PIPELINE_VERSION, DEFAULT_ANALYSIS_CONFIG } from '../engines/songgraph/config.js';
import { buildSongGraphFromResolved, buildBeatGrid, inferMeter, sectionsFromSegments, type ResolvedAnalysis } from '../engines/songgraph/resolve-analysis.js';
import { resolveTempo } from '../engines/analysis-consensus/tempo-consensus.js';
import { resolveRhythm } from '../engines/analysis-consensus/rhythm-consensus.js';
import { resolveChords } from '../engines/analysis-consensus/chord-consensus.js';
import { ticksToBeats } from '../engines/songgraph/beat-normalizer.js';
import { normalizeChordLabel } from '../domain/music/normalize.js';
import { aggregateConfidence } from '../engines/songgraph/confidence.js';
import { DEFAULT_ANALYSIS_STRATEGY, type AnalysisStrategyConfig } from '../config/analysis-strategy.js';
import { logger } from '../utils/logger.js';

const ARTIFACT_SCHEMA_VERSION = '2';

export interface AnalyzeSongDeps {
  songs: SongRepository;
  graphs: SongGraphRepository;
  /** Providers available for this run; strategy selects among them. */
  providers?: MusicAnalysisProvider[];
  stems?: StemSeparationProvider;
  songsDir?: string;
}

export interface ProviderRuntime {
  id: string;
  version: string;
  runtimeMs: number;
}

export interface RhythmProviderSummary {
  provider: string;
  beats: number;
  downbeats: number;
  medianBeatIntervalSeconds: number | null;
  impliedBpm: number | null;
  runtimeMs?: number;
}

export interface AnalyzeResult {
  graph: SongGraph;
  graphPath: string;
  artifactsDir: string;
  cachedProviders: string[];
  ranProviders: string[];
  strategy: AnalysisStrategyConfig;
  warnings: Array<{ code: string; message: string }>;
  timings: { totalMs: number; perProvider: ProviderRuntime[]; consensusMs: number };
  rhythmSummaries: RhythmProviderSummary[];
  resolvedRhythm: ResolvedRhythm | null;
}

const ProviderArtifactSchema = z.object({
  meta: z.object({
    pipelineVersion: z.string(),
    provider: z.string(),
    providerVersion: z.string(),
    model: z.string().optional(),
    audioVariant: z.string(),
    audioSha256: z.string(),
    analyzedAt: z.string(),
  }),
  partial: z.custom<PartialRawMusicAnalysis>(() => true),
});
type ProviderArtifact = z.infer<typeof ProviderArtifactSchema>;

const started = () => Number(process.hrtime.bigint() / 1000000n);

async function sha256(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

async function loadProviderArtifact(file: string): Promise<ProviderArtifact | null> {
  try {
    const parsed = ProviderArtifactSchema.safeParse(JSON.parse(await readFile(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface AnalyzeOptions {
  force?: boolean;
  strategy?: Partial<AnalysisStrategyConfig>;
  /** Skip persisting graph.json (provider evaluation runs keep graphs in memory). */
  saveGraph?: boolean;
  /** Debug-only overrides; always recorded as MANUAL_OVERRIDE in the graph. */
  bpmOverride?: number;
  meterOverride?: { numerator: number; denominator: number };
}

/**
 * V2 multi-provider analysis:
 *   audio -> providers (per capability, per audio variant) -> persisted raw
 *   artifacts -> tempo consensus -> beat grid/downbeats/meter -> chord
 *   consensus -> functional sections -> SongGraph (with provenance).
 * Provider results are cached individually keyed by pipeline version +
 * provider version + model + audio content hash; the reference is never used.
 */
export async function analyzeSong(songId: string, deps: AnalyzeSongDeps, options: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  const songsDir = deps.songsDir ?? config.songsDir;
  const songDir = path.join(songsDir, songId);
  const fullMixPath = path.join(songDir, 'audio', 'analysis.wav');
  const artifactsDir = path.join(songDir, 'analysis');
  const rawDir = path.join(artifactsDir, 'raw');
  const graphPath = path.join(songDir, 'graph.json');

  const song = await deps.songs.get(songId);

  const strategy: AnalysisStrategyConfig = {
    ...DEFAULT_ANALYSIS_STRATEGY,
    ...options.strategy,
    ...(options.strategy?.consensus !== undefined && { consensus: options.strategy.consensus }),
  };

  const totalStart = started();
  const perProvider: ProviderRuntime[] = [];
  const cachedProviders: string[] = [];
  const ranProviders: string[] = [];
  const warnings: Array<{ code: string; message: string }> = [];

  // Gather the providers the strategy asks for, filtered by availability.
  const available = deps.providers ?? defaultProviders(strategy);
  const providerById = new Map(available.map((p) => [p.id, p]));

  const fullMixSha = await sha256(fullMixPath).catch(() => {
    throw new AppError('ANALYSIS_AUDIO_MISSING', `No analysis audio for ${songId}: ${fullMixPath}`);
  });
  const durationSeconds = song.durationMs / 1000;

  const partials: Array<{ id: string; partial: PartialRawMusicAnalysis }> = [];
  // a provider may serve several roles (rhythm + chords) — run it once per variant
  const partialCache = new Map<string, PartialRawMusicAnalysis | null>();

  const runProvider = async (
    id: string,
    audioPath: string,
    audioSha: string,
    audioVariant: AnalysisAudioVariant,
  ): Promise<PartialRawMusicAnalysis | null> => {
    const memoKey = `${id}:${audioVariant}`;
    if (partialCache.has(memoKey)) return partialCache.get(memoKey) ?? null;
    const provider = providerById.get(id);
    if (provider === undefined) return null;
    if (!provider.capabilities().some((c) => c !== 'STEMS')) return null;
    const artifactFile = path.join(rawDir, `${id}.${audioVariant}.json`);
    if (options.force !== true) {
      const stored = await loadProviderArtifact(artifactFile);
      if (
        stored !== null &&
        stored.meta.pipelineVersion === ARTIFACT_SCHEMA_VERSION &&
        stored.meta.providerVersion === provider.version &&
        stored.meta.audioSha256 === audioSha
      ) {
        cachedProviders.push(`${id}:${audioVariant}`);
        partialCache.set(memoKey, stored.partial);
        return stored.partial;
      }
    }
    const t = started();
    const partial = await provider.analyze(audioPath, { audioVariant, device: strategy.device });
    perProvider.push({ id, version: provider.version, runtimeMs: started() - t });
    ranProviders.push(`${id}:${audioVariant}`);
    await mkdir(rawDir, { recursive: true });
    await writeFile(
      artifactFile,
      JSON.stringify(
        {
          meta: {
            pipelineVersion: ARTIFACT_SCHEMA_VERSION,
            provider: id,
            providerVersion: provider.version,
            audioVariant,
            audioSha256: audioSha,
            analyzedAt: new Date().toISOString(),
          },
          partial,
        },
        null,
        2,
      ) + '\n',
    );
    partialCache.set(memoKey, partial);
    return partial;
  };

  // --- source separation (optional, cached by full-mix hash) ---
  let variantPaths: Partial<Record<AnalysisAudioVariant, string>> = { FULL_MIX: fullMixPath };
  const variantShas: Partial<Record<AnalysisAudioVariant, string>> = { FULL_MIX: fullMixSha };
  const needsVariants = strategy.useSourceSeparation && strategy.chordAudioVariants.some((v) => v !== 'FULL_MIX');
  if (needsVariants) {
    const stemsDir = path.join(artifactsDir, 'stems');
    const stemPaths = await separateStemsCached(deps, fullMixPath, stemsDir, fullMixSha, options.force === true);
    if (stemPaths !== null) {
      const built = await buildAudioVariants(fullMixPath, stemPaths, stemsDir, strategy.chordAudioVariants.filter((v): v is Exclude<AnalysisAudioVariant, 'FULL_MIX'> => v !== 'FULL_MIX'));
      variantPaths = { ...variantPaths, ...built.paths };
      for (const [variant, p] of Object.entries(built.paths)) {
        if (p !== undefined && variant !== 'FULL_MIX') variantShas[variant as AnalysisAudioVariant] = await sha256(p);
      }
    } else {
      warnings.push({ code: 'SEPARATION_UNAVAILABLE', message: 'Source separation unavailable; chord variants limited to FULL_MIX' });
    }
  }

  // --- rhythm/structure providers ---
  for (const id of strategy.rhythmProviders) {
    const partial = await runProvider(id, fullMixPath, fullMixSha, 'FULL_MIX');
    if (partial !== null) partials.push({ id, partial });
  }

  // --- chord providers x variants ---
  for (const id of strategy.chordProviders) {
    for (const variant of strategy.chordAudioVariants) {
      const audioPath = variantPaths[variant];
      const audioSha = variantShas[variant];
      if (audioPath === undefined || audioSha === undefined) continue;
      const partial = await runProvider(id, audioPath, audioSha, variant);
      if (partial !== null) partials.push({ id, partial });
    }
  }

  if (partials.length === 0) {
    throw new AppError('SONG_GRAPH_BUILD_FAILED', `No analysis providers produced output for ${songId}`);
  }

  // --- assemble normalized views ---
  const rhythmStructures = partials
    .map((p) => p.partial.rhythmStructure)
    .filter((r): r is NonNullable<typeof r> => r !== undefined);
  const essentiaRhythms = partials.map((p) => p.partial.rhythm).filter((r): r is NonNullable<typeof r> => r !== undefined);
  const chordResults: ChordAnalysisResult[] = [];
  for (const p of partials) {
    if (p.partial.chords !== undefined && p.partial.chords.length > 0) {
      chordResults.push(...p.partial.chords);
    } else if (p.partial.tonal !== undefined) {
      // adapt a V1-style tonal block into a chord timeline
      chordResults.push({
        provider: p.id,
        vocabulary: 'majmin',
        audioVariant: 'FULL_MIX',
        segments: p.partial.tonal.chords,
      });
    }
  }
  // one timeline per provider+variant
  const seenTimelines = new Set<string>();
  const uniqueChordResults = chordResults.filter((c) => {
    const key = `${c.provider}:${c.audioVariant}`;
    if (seenTimelines.has(key)) return false;
    seenTimelines.add(key);
    return true;
  });
  const keyResults = partials.map((p) => p.partial.key).filter((k): k is NonNullable<typeof k> => k !== undefined);

  // --- tempo consensus (V3 when rhythm providers ran, V1 fallback otherwise) ---
  const consensusStart = started();
  const tempoCandidates: TempoCandidate[] = [];
  let beatTimes: number[] = [];
  let downbeatTimes: number[] = [];
  let beatStructure: NonNullable<(typeof rhythmStructures)[number]> | null = rhythmStructures[0] ?? null;

  // V3 rhythm-provider results (beat-this, madmom), plus adapted V2 output
  const rhythmResults: RhythmProviderResult[] = partials
    .map((p) => p.partial.rhythmResult)
    .filter((r): r is NonNullable<typeof r> => r !== undefined);
  for (const r of rhythmStructures) {
    rhythmResults.push({
      provider: 'all-in-one',
      beats: r.beats ?? [],
      ...(r.downbeats !== undefined && { downbeats: r.downbeats }),
      tempoCandidates: r.bpmCandidates ?? [],
      ...(r.runtimeMs !== undefined && { runtimeMs: r.runtimeMs }),
      provenance: { analyzedAt: 'adapted' },
    });
  }
  for (const r of essentiaRhythms) {
    if (rhythmResults.some((x) => x.provider === 'essentia')) break;
    rhythmResults.push({
      provider: 'essentia',
      beats: r.beats.map((b) => b.timeSeconds),
      tempoCandidates: [
        ...(r.bpm !== undefined
          ? [{ bpm: r.bpm, confidence: r.confidence, provider: 'essentia', relation: 'PRIMARY' as const, derived: false }]
          : []),
        ...(r.bpmCandidates ?? []),
      ],
      provenance: { analyzedAt: 'adapted' },
    });
  }

  let resolvedTempo: ReturnType<typeof resolveTempo>;
  let beats: BeatEvent[];
  let timeSignature: TimeSignature;
  let resolvedRhythm: ResolvedRhythm | null = null;
  let deduped: TempoCandidate[] = [];

  if (strategy.rhythmConsensus?.enabled === true && rhythmResults.length >= 2) {
    // V3: multi-provider rhythm consensus with metrical hypotheses
    resolvedRhythm = resolveRhythm({ results: rhythmResults, providerWeights: strategy.rhythmWeights });
    beatTimes = resolvedRhythm.beats.map((b) => b.timeSeconds);
    downbeatTimes = resolvedRhythm.downbeatTimes;
    deduped = [
      { bpm: resolvedRhythm.bpm, confidence: resolvedRhythm.confidence, provider: 'rhythm-consensus', relation: 'PRIMARY', derived: false },
      ...resolvedRhythm.tempoAlternatives.map((h) => ({ bpm: h.bpm, confidence: h.confidence, provider: h.sources[0] ?? 'consensus', relation: 'OTHER' as const, derived: h.derived })),
    ];
    resolvedTempo = {
      bpm: resolvedRhythm.bpm,
      confidence: resolvedRhythm.confidence,
      alternatives: resolvedRhythm.tempoAlternatives.map((h) => ({
        bpm: h.bpm,
        confidence: h.confidence,
        provider: h.sources[0] ?? 'consensus',
        relation: 'OTHER',
        derived: h.derived,
      })),
      evidence: resolvedRhythm.evidence,
    };
    const meter = resolvedRhythm.meter;
    timeSignature = {
      numerator: meter.numerator,
      denominator: meter.denominator ?? 4,
      confidence: meter.confidence,
      source: 'ANALYZED',
    };
    beats = resolvedRhythm.beats.map((b, i) => ({
      beat: i,
      timeMs: Math.round(b.timeSeconds * 1000),
      isDownbeat: b.isDownbeat,
    }));
  } else {
    // V1/V2 path: single structure provider + tempo consensus
    for (const r of rhythmStructures) {
      if (r.bpmCandidates !== undefined) tempoCandidates.push(...r.bpmCandidates);
      if ((r.beats?.length ?? 0) > beatTimes.length && (r.beats?.length ?? 0) > 4) {
        beatTimes = r.beats!;
        beatStructure = r;
        downbeatTimes = r.downbeats ?? [];
      }
    }
    for (const r of essentiaRhythms) {
      if (r.bpm !== undefined) {
        tempoCandidates.push({ bpm: r.bpm, confidence: r.confidence, provider: 'essentia', relation: 'PRIMARY', derived: false });
      }
      if (r.bpmCandidates !== undefined) tempoCandidates.push(...r.bpmCandidates);
      if (beatTimes.length === 0 && r.beats.length > 4) beatTimes = r.beats.map((b) => b.timeSeconds);
    }
    // V3-only provider selected without rhythm consensus: use its beats raw
    if (beatTimes.length === 0) {
      const fallback = rhythmResults.find((r) => r.beats.length > 4);
      if (fallback !== undefined) {
        beatTimes = fallback.beats;
        downbeatTimes = fallback.downbeats ?? [];
        for (const c of fallback.tempoCandidates) tempoCandidates.push(c);
      }
    }
    const deduped = dedupeCandidates(tempoCandidates);
    resolvedTempo = resolveTempo({
      candidates: deduped,
      ...(beatTimes.length > 4 && { beatTimes }),
      ...(downbeatTimes.length > 1 && { downbeatTimes }),
    });
    beats =
      beatStructure !== null && (beatStructure.beats?.length ?? 0) > 4
        ? buildBeatGrid(beatStructure, durationSeconds)
        : ticksToBeats(beatTimes, durationSeconds);
    timeSignature = beatStructure !== null ? inferMeter(beatStructure) : { numerator: 4, denominator: 4, confidence: 0.2, source: 'DEFAULT' as const };
  }

  if (beats.length < 4) {
    throw new AppError('INSUFFICIENT_BEATS', `Only ${beats.length} usable beat(s) detected`);
  }
  // manual overrides are recorded, never silent
  if (options.bpmOverride !== undefined) {
    resolvedTempo = { ...resolvedTempo, bpm: options.bpmOverride, evidence: [...resolvedTempo.evidence, { kind: 'MANUAL_OVERRIDE', detail: `bpm forced to ${options.bpmOverride}`, score: 1 }] };
  }
  if (options.meterOverride !== undefined) {
    timeSignature = { ...timeSignature, ...options.meterOverride, source: 'ANALYZED' };
  }
  const beatTimesResolved = beats.map((b) => b.timeMs / 1000);

  // --- chords ---
  const key = keyResults[0];
  const consensusEnabled = strategy.consensus.enabled;
  let chords;
  let chordSegments: ReturnType<typeof resolveChords>['segments'] = [];
  let chordProviderInfos = uniqueChordResults.map((c) => ({
    provider: c.provider,
    audioVariant: c.audioVariant,
    segments: c.segments.length,
    ...(c.runtimeMs !== undefined && { runtimeMs: c.runtimeMs }),
  }));
  if (consensusEnabled) {
    const timelines = uniqueChordResults.filter(
      (c) => strategy.chordProviders.includes(c.provider) && strategy.chordAudioVariants.includes(c.audioVariant),
    );
    const consensus = resolveChords({
      timelines,
      beatTimes: beatTimesResolved,
      ...(key !== undefined && { key: { root: key.root, scale: key.scale } }),
      config: { minimumChordDurationBeats: 2 },
    });
    chords = consensus.chords;
    chordSegments = consensus.segments;
  } else {
    const primary = chordResults.find((c) => c.provider === strategy.chordProviders[0]) ?? chordResults[0];
    chords = chordEventsFromTimeline(primary, beats);
  }

  // --- sections ---
  const sections =
    beatStructure?.segments !== undefined && beatStructure.segments.length > 0
      ? sectionsFromSegments(beatStructure.segments, beats)
      : sectionsFromSegments([], beats);

  const consensusMs = started() - consensusStart;

  // --- confidence (heuristic, documented) ---
  const avgChordConfidence =
    chords.length > 0 ? chords.reduce((s, c) => s + c.confidence, 0) / chords.length : 0;
  const confidence = aggregateConfidence(
    {
      provider: 'consensus',
      rhythm: {
        bpm: resolvedTempo.bpm,
        beats: beats.map((b) => ({ timeSeconds: b.timeMs / 1000 })),
        confidence: resolvedTempo.confidence,
      },
      tonal: {
        ...(key !== undefined && { key }),
        chords: [],
      },
      warnings: [],
    },
    DEFAULT_ANALYSIS_CONFIG.confidenceWeights,
    avgChordConfidence,
  );

  const overrides: Array<{ field: string; value: string }> = [];
  if (options.bpmOverride !== undefined) overrides.push({ field: 'bpm', value: String(options.bpmOverride) });
  if (options.meterOverride !== undefined) {
    overrides.push({ field: 'meter', value: `${options.meterOverride.numerator}/${options.meterOverride.denominator}` });
  }
  const resolved: ResolvedAnalysis = {
    tempo: resolvedTempo,
    ...(resolvedRhythm !== null && { rhythm: resolvedRhythm }),
    ...(overrides.length > 0 && { overrides }),
    beats,
    timeSignature,
    sections,
    chords,
    ...(key !== undefined && { keyLabel: `${key.root} ${key.scale}`, keyConfidence: key.confidence }),
    confidence: {
      rhythm: confidence.rhythm,
      key: confidence.key,
      chord: confidence.chord,
      overall: confidence.overall,
    },
    warnings,
    tempoProvenance: {
      selectedProvider: resolvedTempo.alternatives[0]?.provider ?? 'consensus',
      selectedBpm: resolvedTempo.bpm,
      observations: deduped.map((c) => ({ provider: c.provider, bpm: c.bpm, relation: c.relation, derived: c.derived })),
      evidence: resolvedTempo.evidence.map((e) => ({ kind: e.kind, detail: e.detail })),
    },
    chordProvenance: {
      providers: chordProviderInfos,
      segments: chordSegments.map((s) => ({
        startBeat: s.startBeat,
        endBeat: s.endBeat,
        root: s.root,
        quality: s.quality,
        agreement: s.agreement,
        votes: s.votes,
      })),
    },
    providers: perProvider.map((p) => ({ id: p.id, version: p.version, capabilities: [], runtimeMs: p.runtimeMs })),
  };

  const graph = buildSongGraphFromResolved(song, resolved);
  if (options.saveGraph !== false) {
    await deps.graphs.save(songId, graph);
  }

  // resolved summary for debugging (not the cache — artifacts above are)
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(
    path.join(artifactsDir, 'normalized.json'),
    JSON.stringify(
      {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        strategy,
        tempo: { bpm: resolvedTempo.bpm, confidence: resolvedTempo.confidence, alternatives: resolvedTempo.alternatives.slice(0, 3) },
        key: resolved.keyLabel ?? null,
        beats: beats.length,
        chordEvents: chords.length,
        sections: sections.map((s) => `${s.type}:${s.startBeat}-${s.endBeat}`),
        confidence: resolved.confidence,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );

  const rhythmSummaries: RhythmProviderSummary[] = rhythmResults.map((r) => {
    const intervals: number[] = [];
    for (let i = 1; i < r.beats.length; i++) intervals.push(r.beats[i]! - r.beats[i - 1]!);
    const medianInterval = intervals.length > 0 ? intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)]! : null;
    return {
      provider: r.provider,
      beats: r.beats.length,
      downbeats: r.downbeats?.length ?? 0,
      medianBeatIntervalSeconds: medianInterval,
      impliedBpm: medianInterval !== null ? Math.round((60 / medianInterval) * 10) / 10 : null,
      ...(r.runtimeMs !== undefined && { runtimeMs: r.runtimeMs }),
    };
  });

  const totalMs = started() - totalStart;
  logger.info('analyze_song', { songId, providers: ranProviders, cached: cachedProviders, totalMs });
  return {
    graph,
    graphPath,
    artifactsDir,
    cachedProviders,
    ranProviders,
    strategy,
    warnings,
    timings: { totalMs, perProvider, consensusMs },
    rhythmSummaries,
    resolvedRhythm,
  };
}

function defaultProviders(strategy: AnalysisStrategyConfig): MusicAnalysisProvider[] {
  const ids = [...new Set([...strategy.rhythmProviders, ...strategy.chordProviders])];
  return ids.map((id) => createProvider(id));
}

function dedupeCandidates(candidates: TempoCandidate[]): TempoCandidate[] {
  const seen = new Map<string, TempoCandidate>();
  for (const c of candidates) {
    const key = `${c.provider}:${c.bpm.toFixed(1)}:${c.relation}:${c.derived}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  return [...seen.values()];
}

function chordEventsFromTimeline(
  timeline: ChordAnalysisResult | undefined,
  beats: BeatEvent[],
): SongGraph['harmony']['chords'] {
  if (timeline === undefined || beats.length === 0) return [];
  const events: SongGraph['harmony']['chords'] = [];
  const timeToBeat = (t: number): number => {
    let lo = 0;
    let hi = beats.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (beats[mid]!.timeMs < t * 1000) lo = mid + 1;
      else hi = mid;
    }
    const cand = beats[lo]!;
    const prev = beats[lo - 1];
    if (prev && Math.abs(prev.timeMs - t * 1000) < Math.abs(cand.timeMs - t * 1000)) return prev.beat;
    return cand.beat;
  };
  for (const s of timeline.segments) {
    const parsed = normalizeChordLabel(s.label);
    if (parsed === null) continue;
    const startBeat = timeToBeat(s.startSeconds);
    let endBeat = timeToBeat(s.endSeconds) + 1;
    if (endBeat <= startBeat) endBeat = startBeat + 1;
    const last = events[events.length - 1];
    if (last && last.root === parsed.root && last.quality === parsed.quality && last.startBeat + last.durationBeats >= startBeat) {
      last.durationBeats = Math.max(last.durationBeats, endBeat - last.startBeat);
      continue;
    }
    events.push({ startBeat, durationBeats: endBeat - startBeat, root: parsed.root, quality: parsed.quality, confidence: s.confidence });
  }
  return events;
}

async function separateStemsCached(
  deps: AnalyzeSongDeps,
  fullMixPath: string,
  stemsDir: string,
  fullMixSha: string,
  force: boolean,
): Promise<Record<string, string> | null> {
  if (deps.stems === undefined) return null;
  const metaFile = path.join(stemsDir, 'meta.json');
  if (force !== true) {
    try {
      const meta = JSON.parse(await readFile(metaFile, 'utf8'));
      if (meta.audioSha256 === fullMixSha && meta.pipelineVersion === ARTIFACT_SCHEMA_VERSION) {
        return meta.stems as Record<string, string>;
      }
    } catch {
      // recompute
    }
  }
  const t = started();
  const stems = await deps.stems.separate(fullMixPath, stemsDir);
  logger.info('stem_separation', { runtimeMs: started() - t });
  await mkdir(stemsDir, { recursive: true });
  await writeFile(
    metaFile,
    JSON.stringify({ pipelineVersion: ARTIFACT_SCHEMA_VERSION, audioSha256: fullMixSha, stems }, null, 2) + '\n',
  );
  return stems;
}
