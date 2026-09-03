import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import { findShape } from '../../domain/guitar/chord-shape.js';
import type { SkillLevel, SkillPreset } from '../../domain/skill/skill-preset.js';
import { SKILL_PRESETS } from '../../domain/skill/skill-preset.js';

export interface ArrangementLadderEntry {
  level: SkillLevel;
  arrangement: GuitarArrangement;
}

const hasBarre = (arr: GuitarArrangement): boolean =>
  arr.chords.some((c) => findShape(c.shapeName)?.barre !== undefined);

const passesPreset = (arr: GuitarArrangement, preset: SkillPreset): boolean => {
  const diff = arr.difficulty?.total ?? Infinity;
  if (diff <= preset.targetDifficulty) return true;
  if (!preset.allowBarre && hasBarre(arr)) return false;
  if (arr.tempoFactor < preset.preferredTempoFactor - 0.05) return false;
  return true;
};

/** Highest-fidelity candidate at or below target difficulty; else easiest valid. */
export function selectForSkill(
  candidates: GuitarArrangement[],
  preset: SkillPreset,
): GuitarArrangement | undefined {
  const valid = candidates.filter((c) => passesPreset(c, preset));
  if (valid.length === 0) return undefined;

  const underTarget = valid
    .filter((c) => (c.difficulty?.total ?? Infinity) <= preset.targetDifficulty)
    .sort((a, b) => (b.fidelity?.total ?? 0) - (a.fidelity?.total ?? 0));
  if (underTarget.length > 0) return underTarget[0];

  return [...valid].sort((a, b) => (a.difficulty?.total ?? Infinity) - (b.difficulty?.total ?? Infinity))[0];
}

export function buildArrangementLadder(
  candidates: GuitarArrangement[],
  base: GuitarArrangement,
): ArrangementLadderEntry[] {
  const pool = candidates.length > 0 ? candidates : [base];
  const ladder: ArrangementLadderEntry[] = [];
  for (const level of ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] as const) {
    const picked = selectForSkill(pool, SKILL_PRESETS[level]) ?? base;
    ladder.push({ level, arrangement: picked });
  }
  return ladder;
}
