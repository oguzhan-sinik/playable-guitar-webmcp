export type SkillLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export interface SkillPreset {
  level: SkillLevel;
  targetDifficulty: number;
  allowBarre: boolean;
  maxPreferredFretSpan: number;
  preferredTempoFactor: number;
  rhythmComplexityTolerance: number;
}

export const SKILL_PRESETS: Record<SkillLevel, SkillPreset> = {
  BEGINNER: {
    level: 'BEGINNER',
    targetDifficulty: 3,
    allowBarre: false,
    maxPreferredFretSpan: 4,
    preferredTempoFactor: 0.8,
    rhythmComplexityTolerance: 0.5,
  },
  INTERMEDIATE: {
    level: 'INTERMEDIATE',
    targetDifficulty: 5,
    allowBarre: true,
    maxPreferredFretSpan: 5,
    preferredTempoFactor: 0.9,
    rhythmComplexityTolerance: 0.75,
  },
  ADVANCED: {
    level: 'ADVANCED',
    targetDifficulty: 10,
    allowBarre: true,
    maxPreferredFretSpan: 6,
    preferredTempoFactor: 1,
    rhythmComplexityTolerance: 1,
  },
};

export function parseSkillLevel(value: string | undefined): SkillLevel {
  const v = (value ?? 'beginner').trim().toLowerCase();
  if (v === 'intermediate') return 'INTERMEDIATE';
  if (v === 'advanced') return 'ADVANCED';
  return 'BEGINNER';
}
