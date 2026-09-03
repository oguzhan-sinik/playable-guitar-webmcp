import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import type { SongGraph } from '../../domain/music/song-graph.js';
import { generateCandidates } from '../transformations/index.js';
import { paretoFilter } from './pareto-filter.js';
import { computePlayerDifficulty } from '../difficulty/player-difficulty.js';
import { chordMastery, presetProfile, type PlayerProfile } from '../../domain/player/player-profile.js';
import type { SkillLevel } from '../../domain/skill/skill-preset.js';
import { SKILL_PRESETS } from '../../domain/skill/skill-preset.js';

/**
 * Bounded beam search over transformation CHAINS (capo + tempo + rhythm +
 * chords + fingering combinations), replacing the flat one-shot candidate
 * list so the skill ladder gets genuinely distinct arrangements.
 * Deterministic: no randomness, stable sort order everywhere.
 */
export interface SearchOptions {
  /** Frontier size between depths. */
  beamWidth?: number;
  /** Chain length (number of sequential transformation rounds). */
  maxDepth?: number;
  /** Hard cap on returned candidates. */
  maxCandidates?: number;
}

const DEFAULTS: Required<SearchOptions> = { beamWidth: 12, maxDepth: 3, maxCandidates: 50 };

/** Musical identity used for dedup — near-identical candidates collapse. */
export function candidateKey(arr: GuitarArrangement): string {
  const shapeTimeline = arr.chords.map((c) => `${Math.round(c.startBeat * 4)}:${c.shapeName}`).join(',');
  const noteSig = arr.notes.length > 0 ? `n${arr.notes.length}` : '';
  return `${arr.tuning.capo}|${arr.tempoFactor}|${[...new Set(arr.chords.map((c) => c.shapeName))].sort().join('+')}|${shapeTimeline}${noteSig}`;
}

/** Player-aware cost. Without a profile this is the absolute difficulty. */
export function playerCost(
  arr: GuitarArrangement,
  profile: PlayerProfile,
  song: Pick<SongGraph, 'global'>,
): number {
  return computePlayerDifficulty(arr, profile, song).playerDifficulty;
}

export function searchArrangements(
  base: GuitarArrangement,
  song: SongGraph,
  profile: PlayerProfile,
  options: SearchOptions = {},
): GuitarArrangement[] {
  const { beamWidth, maxDepth, maxCandidates } = { ...DEFAULTS, ...options };

  const seen = new Set<string>([candidateKey(base)]);
  const pool: GuitarArrangement[] = [base];
  let frontier: GuitarArrangement[] = [base];

  for (let depth = 0; depth < maxDepth; depth++) {
    const expanded: GuitarArrangement[] = [];
    for (const node of frontier) {
      // pareto filter inside generateCandidates consumers; keep raw here and
      // pareto the pool once at the end so chains survive intermediate steps
      for (const candidate of generateCandidates(node, { song })) {
        const key = candidateKey(candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        expanded.push(candidate);
      }
    }
    if (expanded.length === 0) break;

    // rank by player difficulty, but always keep the most faithful branch so
    // the ADVANCED end of the ladder survives greedy easy-first expansion
    const scored = [...expanded].sort(
      (a, b) => playerCost(a, profile, song) - playerCost(b, profile, song),
    );
    const easiest = scored.slice(0, beamWidth);
    const mostFaithful = [...expanded].sort(
      (a, b) => (b.fidelity?.total ?? 0) - (a.fidelity?.total ?? 0) || a.id.localeCompare(b.id),
    )[0]!;
    frontier = easiest.some((c) => candidateKey(c) === candidateKey(mostFaithful))
      ? easiest
      : [...easiest.slice(0, beamWidth - 1), mostFaithful];

    pool.push(...frontier);
    if (pool.length >= maxCandidates) break;
  }

  const filtered = paretoFilter(pool);
  // base always stays in the pool even when Pareto-dominated: the ADVANCED
  // rung is "closest to the original", and dominance only sees difficulty
  const withBase = [base, ...filtered.filter((c) => candidateKey(c) !== candidateKey(base))];
  return withBase.slice(0, maxCandidates);
}

/** Target player difficulty per ladder rung (profile may push these around). */
function targetFor(level: SkillLevel, profile: PlayerProfile): number {
  const presetTarget = SKILL_PRESETS[level].targetDifficulty;
  // a detailed profile can bend the target: comfortable tempo + known barres
  // widen it, uncomfortable barres narrow it
  if (level === 'ADVANCED') return 10;
  const shift =
    (profile.barreChords.comfortable ? 0 : -0.5) +
    (profile.comfortableTempoBpm !== undefined && profile.comfortableTempoBpm < 90 ? -0.5 : 0);
  return Math.max(1, presetTarget + shift);
}

export interface PlayerSelection {
  selected: GuitarArrangement;
  /** Easiest faithful candidate when nothing meets the target. */
  closestAvailable: GuitarArrangement;
  constraintsSatisfied: boolean;
}

export type RungMode = 'easiest' | 'faithful';

const tieBreak = (mode: RungMode) => (
  a: { candidate: GuitarArrangement; cost: number; fidelity: number },
  b: { candidate: GuitarArrangement; cost: number; fidelity: number },
): number => {
  if (b.fidelity !== a.fidelity) return b.fidelity - a.fidelity;
  if (mode === 'faithful') {
    // closer to the original: full tempo first, then fewest transformations
    const tempo = b.candidate.tempoFactor - a.candidate.tempoFactor;
    if (Math.abs(tempo) > 0.001) return tempo;
    const tCount = a.candidate.transformations.length - b.candidate.transformations.length;
    if (tCount !== 0) return tCount;
  }
  return a.cost - b.cost || a.candidate.id.localeCompare(b.candidate.id);
};

/**
 * maximize fidelity subject to playerDifficulty <= target; without a
 * feasible candidate, fall back to the easiest faithful one (reported as
 * closestAvailable so the UI can say so honestly). mode 'faithful' breaks
 * fidelity ties toward the least-simplified candidate (INTERMEDIATE/ADVANCED).
 */
export function selectForPlayer(
  candidates: GuitarArrangement[],
  profile: PlayerProfile,
  song: Pick<SongGraph, 'global'>,
  targetPlayerDifficulty: number,
  mode: RungMode = 'easiest',
): PlayerSelection {
  if (candidates.length === 0) throw new Error('No candidates to select from');

  const scored = candidates.map((candidate) => ({
    candidate,
    cost: playerCost(candidate, profile, song),
    fidelity: candidate.fidelity?.total ?? 0,
  }));

  const feasible = scored.filter((s) => s.cost <= targetPlayerDifficulty);
  if (feasible.length > 0) {
    const best = [...feasible].sort(tieBreak(mode))[0]!;
    return { selected: best.candidate, closestAvailable: best.candidate, constraintsSatisfied: true };
  }

  const easiest = [...scored].sort(
    (a, b) => a.cost - b.cost || b.fidelity - a.fidelity || a.candidate.id.localeCompare(b.candidate.id),
  )[0]!;
  return { selected: easiest.candidate, closestAvailable: easiest.candidate, constraintsSatisfied: false };
}

const LADDER_ORDER: SkillLevel[] = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'];

/**
 * Real 3-level ladder. Each rung maximizes fidelity under its player
 * difficulty target and prefers to differ musically from the previous rung;
 * diversity is never fabricated — if only one distinct candidate exists,
 * rungs repeat it.
 */
export function buildPlayerLadder(
  candidates: GuitarArrangement[],
  base: GuitarArrangement,
  song: SongGraph,
  profile: PlayerProfile | undefined,
): Array<{ level: SkillLevel; arrangement: GuitarArrangement; constraintsSatisfied: boolean }> {
  const pool = candidates.length > 0 ? candidates : [base];
  const ladder: Array<{ level: SkillLevel; arrangement: GuitarArrangement; constraintsSatisfied: boolean }> = [];
  const usedKeys = new Set<string>();

  for (const level of LADDER_ORDER) {
    // without a detailed player profile each rung uses its own preset player
    const effective = profile ?? presetProfile(level);
    const target = targetFor(level, effective);
    const mode: RungMode = level === 'BEGINNER' ? 'easiest' : 'faithful';
    let pick = selectForPlayer(pool, effective, song, target, mode);

    // prefer a candidate musically distinct from earlier rungs
    const key = (arr: GuitarArrangement): string => candidateKey(arr);
    if (usedKeys.has(key(pick.selected))) {
      const alternates = [...pool]
        .filter((c) => !usedKeys.has(key(c)))
        .map((c) => ({ candidate: c, cost: playerCost(c, effective, song), fidelity: c.fidelity?.total ?? 0 }))
        .filter((s) => s.cost <= target + 1)
        .sort(tieBreak(mode));
      const distinct = alternates[0];
      if (distinct !== undefined) {
        pick = { selected: distinct.candidate, closestAvailable: distinct.candidate, constraintsSatisfied: distinct.cost <= target };
      }
    }

    usedKeys.add(key(pick.selected));
    ladder.push({ level, arrangement: pick.selected, constraintsSatisfied: pick.constraintsSatisfied });
  }
  return ladder;
}

/** Mastery quick-check used by the explanation layer. */
export function knownChordsOf(profile: PlayerProfile, shapes: string[]): string[] {
  return shapes.filter((s) => chordMastery(profile, s) >= 0.5);
}
