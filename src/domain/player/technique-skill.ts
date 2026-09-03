import { z } from 'zod';

/**
 * Player technique abilities, 0..1 each. Keys match the arrangement
 * technique vocabulary (src/domain/arrangement/technique.ts) where relevant.
 */
export const TechniqueSkillsSchema = z.object({
  strumming: z.number().min(0).max(1),
  alternatePicking: z.number().min(0).max(1),
  fingerstyle: z.number().min(0).max(1),
  bends: z.number().min(0).max(1),
  slides: z.number().min(0).max(1),
  hammerOns: z.number().min(0).max(1),
  pullOffs: z.number().min(0).max(1),
});
export type TechniqueSkills = z.infer<typeof TechniqueSkillsSchema>;

export const DEFAULT_TECHNIQUES: TechniqueSkills = {
  strumming: 0.5,
  alternatePicking: 0.3,
  fingerstyle: 0.2,
  bends: 0.2,
  slides: 0.3,
  hammerOns: 0.3,
  pullOffs: 0.2,
};

/** Technique skill mapped from a coarse skill preset. */
export const PRESET_TECHNIQUES: Record<'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED', TechniqueSkills> = {
  BEGINNER: {
    strumming: 0.4,
    alternatePicking: 0.2,
    fingerstyle: 0.1,
    bends: 0.1,
    slides: 0.15,
    hammerOns: 0.15,
    pullOffs: 0.1,
  },
  INTERMEDIATE: { ...DEFAULT_TECHNIQUES },
  ADVANCED: {
    strumming: 0.9,
    alternatePicking: 0.9,
    fingerstyle: 0.85,
    bends: 0.9,
    slides: 0.9,
    hammerOns: 0.9,
    pullOffs: 0.85,
  },
};
