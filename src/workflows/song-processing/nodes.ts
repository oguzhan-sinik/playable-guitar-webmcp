import { config } from '../../config/env.js';
import { analyzeSong, type AnalyzeSongDeps } from '../../application/analyze-song.js';
import { LocalSongRepository } from '../../repositories/song-repository.js';
import { LocalSongGraphRepository } from '../../repositories/song-graph-repository.js';
import { buildBaseArrangement } from '../../engines/arrangement/build-base-arrangement.js';
import { computeDifficulty } from '../../engines/difficulty/arrangement-difficulty.js';
import { computeFidelity } from '../../engines/fidelity/arrangement-fidelity.js';
import { generateCandidates } from '../../engines/transformations/index.js';
import { paretoFilter } from '../../engines/arrangement/pareto-filter.js';
import type { SongProcessingState } from './state.js';

/** Node context. Nodes write only their own state fields and reuse existing
 * application/domain services; tracing happens in the runner. */
export interface NodeDeps {
  analysis?: AnalyzeSongDeps;
  songsDir?: string;
}

const defaultDeps = (deps?: Partial<NodeDeps>): NodeDeps => ({
  analysis:
    deps?.analysis ??
    {
      songs: new LocalSongRepository(config.songsDir),
      graphs: new LocalSongGraphRepository(config.songsDir),
    },
  songsDir: deps?.songsDir ?? config.songsDir,
});

// --- load-song ---
export async function loadSongNode(state: SongProcessingState, deps?: Partial<NodeDeps>): Promise<Partial<SongProcessingState>> {
  const d = defaultDeps(deps);
  const song = await d.analysis!.songs.get(state.songId);
  return { song };
}

// --- ensure-analysis (deterministic MIR, cached) ---
export async function ensureAnalysisNode(state: SongProcessingState, deps?: Partial<NodeDeps>): Promise<Partial<SongProcessingState>> {
  const d = defaultDeps(deps);
  const result = await analyzeSong(state.songId, d.analysis!);
  return { analysisResult: result, songGraph: result.graph };
}

// --- agent decisions are computed by the workflow runner (needs a live
// model); these nodes apply pre-computed decisions to the state. ---
export function analysisAgentNode(
  decision: SongProcessingState['analysisDecision'],
  provenance?: SongProcessingState['agentProvenance'],
): Partial<SongProcessingState> {
  return {
    ...(decision !== undefined && { analysisDecision: decision }),
    ...(provenance !== undefined && { agentProvenance: provenance }),
  };
}

export function feasibilityAgentNode(
  decision: SongProcessingState['feasibilityDecision'],
  provenance?: SongProcessingState['agentProvenance'],
): Partial<SongProcessingState> {
  return {
    ...(decision !== undefined && { feasibilityDecision: decision }),
    ...(provenance !== undefined && { agentProvenance: provenance }),
  };
}

// --- targeted deterministic retry (bounded: one) ---
export async function targetedAnalysisNode(state: SongProcessingState, deps?: Partial<NodeDeps>): Promise<Partial<SongProcessingState>> {
  const d = defaultDeps(deps);
  const decision = state.analysisDecision;
  const strategy: Parameters<typeof analyzeSong>[2] = { force: true, strategy: {} };
  if (decision?.recommendedAction === 'RETRY_CHORDS') {
    strategy.strategy = { chordProviders: ['essentia', 'deepchroma', 'cnn-crf'], consensus: { enabled: true } };
  } else {
    // RETRY_RHYTHM (default): full recompute exercises the rhythm consensus
    strategy.strategy = { rhythmProviders: [...defaultRhythm()] };
  }
  const result = await analyzeSong(state.songId, d.analysis!, strategy);
  return {
    analysisResult: result,
    songGraph: result.graph,
    retryCounts: { analysisAgent: state.retryCounts.analysisAgent + 1 },
    warnings: result.warnings.map((w) => ({ node: 'TARGETED_ANALYSIS', message: `[${w.code}] ${w.message}` })),
  };
}

const defaultRhythm = () => ['beat-this', 'madmom-downbeat', 'madmom-beat', 'all-in-one', 'essentia'];

// --- build base arrangement (deterministic compiler) ---
export function buildArrangementNode(state: SongProcessingState): Partial<SongProcessingState> {
  const song = state.songGraph!;
  const base = buildBaseArrangement(song);
  base.difficulty = computeDifficulty({ arrangement: base, song });
  base.fidelity = computeFidelity({ arrangement: base, original: song });
  return { baseArrangement: base };
}

// --- simplification (deterministic) ---
export function simplifyArrangementNode(state: SongProcessingState): Partial<SongProcessingState> {
  const song = state.songGraph!;
  const base = state.baseArrangement!;
  const candidates = generateCandidates(base, { song });
  const frontier = paretoFilter(candidates);
  const finalArrangements = [...frontier].sort(
    (a, b) => (a.difficulty?.total ?? Infinity) - (b.difficulty?.total ?? Infinity),
  );
  return { candidateArrangements: candidates, finalArrangements };
}
