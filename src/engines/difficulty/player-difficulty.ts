import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import type { SongGraph } from '../../domain/music/song-graph.js';
import { findShape } from '../../domain/guitar/chord-shape.js';
import { chordMastery, type PlayerProfile } from '../../domain/player/player-profile.js';
import type { GuitarTechnique } from '../../domain/arrangement/technique.js';

/**
 * Player-aware difficulty: how hard THIS arrangement is for THIS player.
 * The absolute difficulty engine is untouched; this layer only re-scores
 * the selected candidate against the profile.
 */
export interface PlayerDifficultyScore {
  absoluteDifficulty: number;
  playerDifficulty: number;
  unfamiliarChordPenalty: number;
  barrePenalty: number;
  tempoPenalty: number;
  techniquePenalty: number;
  transitionPenalty: number;
  reasons: string[];
}

/** Penalty per unique unknown chord (mastery-weighted). */
const UNFAMILIAR_WEIGHT = 0.8;
/** Familiarity credit per fully-known unique chord. */
const FAMILIAR_CREDIT = 0.3;
/** Penalty per unique barre shape when barre chords are uncomfortable. */
const BARRE_PENALTY = 1.4;
/** Penalty per 10 BPM above the comfortable tempo. */
const TEMPO_WEIGHT = 0.3;
const TEMPO_MAX = 3;
/** Penalty per chord change involving an unfamiliar chord. */
const TRANSITION_WEIGHT = 0.15;
const TRANSITION_MAX = 1.5;

const TECHNIQUE_OF_EVENT: Partial<Record<GuitarTechnique, keyof PlayerProfile['techniques']>> = {
  HAMMER_ON: 'hammerOns',
  PULL_OFF: 'pullOffs',
  SLIDE: 'slides',
  BEND: 'bends',
};

export function computePlayerDifficulty(
  arrangement: GuitarArrangement,
  profile: PlayerProfile,
  song: Pick<SongGraph, 'global'>,
): PlayerDifficultyScore {
  const absolute = arrangement.difficulty?.total ?? 0;
  const reasons: string[] = [];

  // --- chord familiarity ---
  const uniqueShapes = [...new Set(arrangement.chords.map((c) => c.shapeName))];
  let unfamiliarChordPenalty = 0;
  let familiarityCredit = 0;
  const unknown: string[] = [];
  for (const shape of uniqueShapes) {
    const mastery = chordMastery(profile, shape);
    if (mastery >= 0.5) {
      familiarityCredit += FAMILIAR_CREDIT * mastery;
    } else {
      unfamiliarChordPenalty += UNFAMILIAR_WEIGHT * (1 - mastery);
      if (mastery < 0.25) unknown.push(shape);
    }
  }
  if (unknown.length > 0) {
    reasons.push(`Uses ${unknown.join(', ')}, which ${profile.preset === undefined ? 'this player' : 'you'} haven't learned yet`);
  } else if (uniqueShapes.length > 0) {
    reasons.push(`Only uses ${uniqueShapes.join(', ')}, which are known chords`);
  }

  // --- barre constraint ---
  const barreShapes = uniqueShapes.filter((s) => findShape(s)?.barre !== undefined);
  const barrePenalty = profile.barreChords.comfortable
    ? barreShapes.length * 0.1
    : barreShapes.length * BARRE_PENALTY;
  if (barreShapes.length > 0 && !profile.barreChords.comfortable) {
    reasons.push(`Needs barre chords (${barreShapes.join(', ')})`);
  }

  // --- comfortable tempo ---
  const effectiveBpm = song.global.bpm * arrangement.tempoFactor;
  let tempoPenalty = 0;
  if (profile.comfortableTempoBpm !== undefined && effectiveBpm > profile.comfortableTempoBpm) {
    tempoPenalty = Math.min(TEMPO_MAX, ((effectiveBpm - profile.comfortableTempoBpm) / 10) * TEMPO_WEIGHT);
    reasons.push(
      `Plays at ${Math.round(effectiveBpm)} BPM, above the comfortable ${profile.comfortableTempoBpm} BPM`,
    );
  }

  // --- technique skills vs techniques used ---
  let techniquePenalty = 0;
  const usedTechniques = new Set(arrangement.techniques.map((t) => t.type));
  for (const technique of usedTechniques) {
    const skillKey = TECHNIQUE_OF_EVENT[technique];
    if (skillKey === undefined) continue;
    const skill = profile.techniques[skillKey];
    if (skill < 0.5) {
      techniquePenalty += (1 - skill) * 0.6;
      reasons.push(`Uses ${skillKey} techniques this player is weak at`);
    }
  }

  // --- transitions through unfamiliar chords ---
  let transitionPenalty = 0;
  for (let i = 1; i < arrangement.chords.length; i++) {
    const from = arrangement.chords[i - 1]!.shapeName;
    const to = arrangement.chords[i]!.shapeName;
    if (from === to) continue;
    const harder = chordMastery(profile, from) < 0.5 || chordMastery(profile, to) < 0.5;
    if (harder) transitionPenalty = Math.min(TRANSITION_MAX, transitionPenalty + TRANSITION_WEIGHT);
  }
  if (transitionPenalty >= TRANSITION_WEIGHT) {
    reasons.push('Includes fast changes through unfamiliar chords');
  }

  const raw =
    absolute +
    unfamiliarChordPenalty +
    barrePenalty +
    tempoPenalty +
    techniquePenalty +
    transitionPenalty -
    familiarityCredit;
  const playerDifficulty = Math.min(10, Math.max(0.2, Math.round(raw * 100) / 100));

  return {
    absoluteDifficulty: Math.round(absolute * 100) / 100,
    playerDifficulty,
    unfamiliarChordPenalty: Math.round(unfamiliarChordPenalty * 100) / 100,
    barrePenalty: Math.round(barrePenalty * 100) / 100,
    tempoPenalty: Math.round(tempoPenalty * 100) / 100,
    techniquePenalty: Math.round(techniquePenalty * 100) / 100,
    transitionPenalty: Math.round(transitionPenalty * 100) / 100,
    reasons,
  };
}

/** Compact diagnostics for the WebMCP get_arrangement_diagnostics tool. */
export function arrangementDiagnostics(
  arrangement: GuitarArrangement,
  profile: PlayerProfile,
  song: Pick<SongGraph, 'global'>,
): PlayerDifficultyScore & {
  knownChords: string[];
  unfamiliarChords: string[];
  barreChords: string[];
  effectiveBpm: number;
} {
  const score = computePlayerDifficulty(arrangement, profile, song);
  const uniqueShapes = [...new Set(arrangement.chords.map((c) => c.shapeName))];
  return {
    ...score,
    knownChords: uniqueShapes.filter((s) => chordMastery(profile, s) >= 0.5),
    unfamiliarChords: uniqueShapes.filter((s) => chordMastery(profile, s) < 0.5),
    barreChords: uniqueShapes.filter((s) => findShape(s)?.barre !== undefined),
    effectiveBpm: Math.round(song.global.bpm * arrangement.tempoFactor * 10) / 10,
  };
}
