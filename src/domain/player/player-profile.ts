import type { SkillLevel } from '../skill/skill-preset.js';
import { type ChordSkill, clampMastery, normalizeChordLabel } from './chord-skill.js';
import { DEFAULT_TECHNIQUES, PRESET_TECHNIQUES, type TechniqueSkills } from './technique-skill.js';
import type { PlayerConstraints } from './player-constraints.js';

/**
 * PlayerProfile V1 — what this specific guitarist can play right now.
 * The coarse BEGINNER/INTERMEDIATE/ADVANCED presets remain shortcuts that
 * expand into a profile; a detailed profile overrides preset assumptions.
 */
export interface PlayerProfile {
  id: string;

  preset?: SkillLevel;

  /** Keyed by chord label in library form ("C", "Am", "F#m"...). */
  knownChords: Record<string, ChordSkill>;

  barreChords: {
    comfortable: boolean;
    mastery: number;
  };

  techniques: TechniqueSkills;

  practicePreferences: {
    avoidBarreChords: boolean;
    allowSlowerTempo: boolean;
    prioritizeRecognizability: boolean;
  };

  comfortableTempoBpm?: number;
  maxPreferredFretSpan?: number;
  preferredCapoMax?: number;
}

export const DEFAULT_PROFILE_ID = 'player-default';

export function defaultProfile(preset?: SkillLevel): PlayerProfile {
  const beginnerChords = ['C', 'G', 'D', 'Em', 'Am', 'E', 'A', 'Dm'];
  const knownChords: Record<string, ChordSkill> = {};
  if (preset === 'BEGINNER') {
    for (const chord of beginnerChords) knownChords[chord] = { mastery: 0.8 };
  } else if (preset === 'INTERMEDIATE') {
    for (const chord of [...beginnerChords, 'Bm', 'F', 'Fmaj7', 'Bb']) knownChords[chord] = { mastery: 0.75 };
  }
  return {
    id: DEFAULT_PROFILE_ID,
    ...(preset !== undefined && { preset }),
    knownChords,
    barreChords: {
      comfortable: preset !== 'BEGINNER',
      mastery: preset === 'ADVANCED' ? 0.95 : preset === 'INTERMEDIATE' ? 0.6 : 0.15,
    },
    techniques: preset === undefined ? { ...DEFAULT_TECHNIQUES } : { ...PRESET_TECHNIQUES[preset] },
    practicePreferences: {
      avoidBarreChords: preset === 'BEGINNER',
      allowSlowerTempo: true,
      prioritizeRecognizability: true,
    },
    ...(preset === 'BEGINNER' && { comfortableTempoBpm: 90 }),
  };
}

/** Coarse preset → profile. Existing callers of SKILL_PRESETS keep working. */
export function presetProfile(level: SkillLevel): PlayerProfile {
  return defaultProfile(level);
}

export interface PlayerProfileInput {
  id?: string;
  preset?: SkillLevel;
  knownChords?: Record<string, { mastery?: unknown } | number>;
  barreChords?: { comfortable?: unknown; mastery?: unknown };
  techniques?: Partial<TechniqueSkills>;
  practicePreferences?: Partial<PlayerConstraints['practicePreferences']>;
  comfortableTempoBpm?: unknown;
  maxPreferredFretSpan?: unknown;
  preferredCapoMax?: unknown;
}

const optInt = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : undefined;

const optBool = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined;

/**
 * Merge partial input (from a WebMCP tool or UI form) over a base profile.
 * Keeps fields the caller did not supply, so an agent can update one thing.
 */
export function mergeProfile(input: PlayerProfileInput, base?: PlayerProfile): PlayerProfile {
  const preset = input.preset ?? base?.preset;
  const merged: PlayerProfile = base ?? defaultProfile(preset);
  const out: PlayerProfile = { ...merged, id: input.id ?? merged.id };

  if (input.preset !== undefined && input.preset !== base?.preset) {
    // preset change refreshes the assumed defaults but keeps explicit detail
    const fresh = defaultProfile(input.preset);
    out.barreChords = { ...fresh.barreChords };
    out.techniques = { ...fresh.techniques };
    out.knownChords = { ...fresh.knownChords, ...out.knownChords };
    out.practicePreferences = { ...fresh.practicePreferences };
    delete out.comfortableTempoBpm;
    if (fresh.comfortableTempoBpm !== undefined) out.comfortableTempoBpm = fresh.comfortableTempoBpm;
  }
  if (preset !== undefined) out.preset = preset;

  if (input.knownChords !== undefined) {
    const known: Record<string, ChordSkill> = { ...out.knownChords };
    for (const [label, value] of Object.entries(input.knownChords)) {
      const mastery = typeof value === 'number' ? value : (value?.mastery ?? 1);
      known[normalizeChordLabel(label)] = { mastery: clampMastery(mastery) };
    }
    out.knownChords = known;
  }

  const barreComfortable = optBool(input.barreChords?.comfortable);
  if (barreComfortable !== undefined || input.barreChords?.mastery !== undefined) {
    out.barreChords = {
      comfortable: barreComfortable ?? out.barreChords.comfortable,
      mastery: clampMastery(input.barreChords?.mastery ?? (barreComfortable !== undefined ? (barreComfortable ? 0.8 : 0.15) : out.barreChords.mastery)),
    };
  }

  if (input.techniques !== undefined) {
    out.techniques = { ...out.techniques };
    for (const [key, value] of Object.entries(input.techniques)) {
      if (value === undefined) continue;
      (out.techniques as Record<string, number>)[key] = clampMastery(value);
    }
  }

  if (input.practicePreferences !== undefined) {
    const avoid = optBool(input.practicePreferences.avoidBarreChords);
    const slower = optBool(input.practicePreferences.allowSlowerTempo);
    const recognizability = optBool(input.practicePreferences.prioritizeRecognizability);
    out.practicePreferences = {
      avoidBarreChords: avoid ?? out.practicePreferences.avoidBarreChords,
      allowSlowerTempo: slower ?? out.practicePreferences.allowSlowerTempo,
      prioritizeRecognizability: recognizability ?? out.practicePreferences.prioritizeRecognizability,
    };
  }

  const tempo = optInt(input.comfortableTempoBpm, 30, 240);
  if (tempo !== undefined) out.comfortableTempoBpm = tempo;
  const span = optInt(input.maxPreferredFretSpan, 2, 6);
  if (span !== undefined) out.maxPreferredFretSpan = span;
  const capoMax = optInt(input.preferredCapoMax, 0, 9);
  if (capoMax !== undefined) out.preferredCapoMax = capoMax;

  return out;
}

/** Mastery of a chord label; unknown chords count as 0. */
export function chordMastery(profile: PlayerProfile, chordLabel: string): number {
  return profile.knownChords[normalizeChordLabel(chordLabel)]?.mastery ?? 0;
}

/** True when the profile carries more detail than its preset alone. */
export function hasDetailedProfile(profile: PlayerProfile | undefined): profile is PlayerProfile {
  if (profile === undefined) return false;
  return (
    Object.keys(profile.knownChords).length > 0 ||
    profile.barreChords.mastery > 0 ||
    profile.comfortableTempoBpm !== undefined ||
    profile.maxPreferredFretSpan !== undefined ||
    profile.preferredCapoMax !== undefined ||
    profile.preset === undefined
  );
}
