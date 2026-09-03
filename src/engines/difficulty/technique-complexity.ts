import type { TechniqueEvent } from '../../domain/arrangement/technique.js';
import type { DifficultyConfig } from './config.js';
import { clamp10 } from './config.js';

/** Mean configured cost of technique events (0-10). */
export function computeTechniqueComplexity(
  techniques: TechniqueEvent[],
  config: DifficultyConfig,
): number {
  if (techniques.length === 0) return 0;
  const sum = techniques.reduce((acc, t) => acc + (config.techniqueCosts[t.type] ?? 0), 0);
  return clamp10(sum / techniques.length);
}
