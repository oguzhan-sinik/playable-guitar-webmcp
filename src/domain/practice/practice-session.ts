import type { SongGraph } from '../music/song-graph.js';
import type { GuitarArrangement } from '../arrangement/arrangement.js';
import type { PlayerProfile } from '../player/player-profile.js';
import type { SectionTime } from '../../application/prepare-arrangement.js';
import { clampTempoFactor } from './practice-tempo.js';
import type { PracticeStep } from './practice-step.js';

/**
 * PracticeSession V1 — a deterministic, section-scoped practice block for one
 * arrangement and one player. No LLM: steps derive from the arrangement's
 * chords, the player's familiarity, and the requested minutes.
 */
export interface PracticeSession {
  songId: string;
  arrangementId: string;
  sectionId: string;
  playerProfile: PlayerProfile;
  tempoFactor: number;
  loopEnabled: boolean;
  countInBars: number;
  metronomeEnabled: boolean;
  steps: PracticeStep[];
}

export interface PracticeSessionInput {
  song: Pick<SongGraph, 'id' | 'global'>;
  arrangement: GuitarArrangement;
  profile: PlayerProfile;
  section: Pick<SectionTime, 'type' | 'index'>;
  /** Requested total minutes; steps are sized to fill it. */
  minutes?: number;
  tempoFactor?: number;
  loopEnabled?: boolean;
  countInBars?: number;
  metronomeEnabled?: boolean;
}

const DEFAULT_MINUTES = 20;

/**
 * Lesson shape for a 20-minute session:
 *   learn chords → learn the hard transition → loop at 70% → loop at 85% →
 *   full-tempo run. Minutes are distributed deterministically.
 */
export function buildPracticeSession(input: PracticeSessionInput): PracticeSession {
  const minutes = clampMinutes(input.minutes ?? DEFAULT_MINUTES);
  const chords = [...new Set(input.arrangement.chords.map((c) => c.shapeName))];
  const known = chords.filter((c) => (input.profile.knownChords[c]?.mastery ?? 0) >= 0.5);
  const toLearn = chords.filter((c) => !known.includes(c));
  const transitions = chordTransitions(input.arrangement);
  const hardTransition = hardestTransition(transitions, input.profile);

  const raw: Array<{ kind: PracticeStep['kind']; instruction: string; minutes: number; tempoFactor?: number; chordNames?: string[] }> = [];

  if (toLearn.length > 0) {
    raw.push({
      kind: 'learn-chords',
      instruction: `Learn ${toLearn.join(' + ')}`,
      minutes: Math.min(6, 2 + toLearn.length),
      chordNames: toLearn,
    });
  } else if (chords.length > 0) {
    raw.push({
      kind: 'learn-chords',
      instruction: `Warm up on ${chords.join(' + ')}`,
      minutes: 2,
      chordNames: chords,
    });
  }

  if (hardTransition !== undefined) {
    raw.push({
      kind: 'learn-transition',
      instruction: `Practice ${hardTransition} slowly until smooth`,
      minutes: 4,
      chordNames: hardTransition.split(' → '),
    });
  }

  const sectionName = input.section.type.toLowerCase().replace(/_/g, ' ');
  const sessionTempo = clampTempoFactor(input.tempoFactor);
  // practice ladder relative to the session tempo: two slower loops, then
  // the full run at the session tempo itself
  const loopTempo = clampTempoFactor(sessionTempo - 0.2, sessionTempo);
  const midTempo = clampTempoFactor(sessionTempo - 0.1, sessionTempo);

  raw.push({ kind: 'loop-section', instruction: `Loop the ${sectionName} at ${Math.round(loopTempo * 100)}% tempo`, minutes: 4, tempoFactor: loopTempo });
  raw.push({ kind: 'loop-section', instruction: `Loop the ${sectionName} at ${Math.round(midTempo * 100)}% tempo`, minutes: 4, tempoFactor: midTempo });
  raw.push({ kind: 'full-run', instruction: `Play the ${sectionName} at ${Math.round(sessionTempo * 100)}% tempo, start to end`, minutes: 3, tempoFactor: sessionTempo });

  // scale to the requested minutes: keep order, distribute the remainder to
  // the biggest blocks; trim proportionally when over
  const steps = fitMinutes(raw, minutes);

  return {
    songId: input.song.id,
    arrangementId: input.arrangement.id,
    sectionId: `${input.section.type}_${input.section.index}`,
    playerProfile: input.profile,
    tempoFactor: sessionTempo,
    loopEnabled: input.loopEnabled ?? true,
    countInBars: input.countInBars ?? 1,
    metronomeEnabled: input.metronomeEnabled ?? true,
    steps,
  };
}

const clampMinutes = (minutes: number): number => Math.min(60, Math.max(5, Math.round(minutes)));

const chordTransitions = (arr: GuitarArrangement): string[] => {
  const out: string[] = [];
  for (let i = 1; i < arr.chords.length; i++) {
    const from = arr.chords[i - 1]!.shapeName;
    const to = arr.chords[i]!.shapeName;
    const label = `${from} → ${to}`;
    if (from !== to && !out.includes(label)) out.push(label);
  }
  return out;
};

/** Transition whose chords are least known (deterministic first-max). */
function hardestTransition(transitions: string[], profile: PlayerProfile): string | undefined {
  if (transitions.length === 0) return undefined;
  const score = (label: string): number => {
    const [from, to] = label.split(' → ');
    return (profile.knownChords[from!]?.mastery ?? 0) + (profile.knownChords[to!]?.mastery ?? 0);
  };
  return [...transitions].sort((a, b) => score(a) - score(b) || transitions.indexOf(a) - transitions.indexOf(b))[0];
}

/** Scale raw step minutes so they sum to ~minutes (±1). */
function fitMinutes(
  raw: Array<{ kind: PracticeStep['kind']; instruction: string; minutes: number; tempoFactor?: number; chordNames?: string[] }>,
  minutes: number,
): PracticeStep[] {
  const total = raw.reduce((sum, s) => sum + s.minutes, 0);
  let remaining = minutes;
  const steps: PracticeStep[] = [];
  raw.forEach((s, i) => {
    const isLast = i === raw.length - 1;
    const allotted = isLast
      ? Math.max(1, remaining)
      : Math.max(1, Math.min(remaining - (raw.length - i - 1), Math.round((s.minutes / total) * minutes)));
    remaining -= allotted;
    steps.push({
      kind: s.kind,
      instruction: s.instruction,
      minutes: allotted,
      ...(s.tempoFactor !== undefined && { tempoFactor: s.tempoFactor }),
      ...(s.chordNames !== undefined && { chordNames: s.chordNames }),
    });
  });
  return steps;
}
