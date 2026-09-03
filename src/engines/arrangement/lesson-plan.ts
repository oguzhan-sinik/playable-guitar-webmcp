import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import { findShape } from '../../domain/guitar/chord-shape.js';

export interface LessonStep {
  step: number;
  instruction: string;
}

const shapeDifficulty = (name: string): number => (findShape(name)?.barre !== undefined ? 3 : 1);

export function buildLessonPlan(arrangement: GuitarArrangement): LessonStep[] {
  const shapes = [...new Set(arrangement.chords.map((c) => c.shapeName))].sort(
    (a, b) => shapeDifficulty(a) - shapeDifficulty(b),
  );
  const steps: LessonStep[] = [];
  let n = 1;

  if (shapes.length >= 2) {
    steps.push({ step: n++, instruction: `Learn ${shapes[0]} and ${shapes[1]}` });
  } else if (shapes[0] !== undefined) {
    steps.push({ step: n++, instruction: `Learn ${shapes[0]}` });
  }

  for (const shape of shapes.slice(2, 4)) {
    steps.push({ step: n++, instruction: `Learn ${shape}` });
  }

  if (shapes.length >= 2) {
    steps.push({ step: n++, instruction: `Practice ${shapes[0]} → ${shapes[1]} slowly` });
  }

  const tempoPct = Math.round(arrangement.tempoFactor * 100);
  const slowPct = Math.max(50, tempoPct - 20);
  steps.push({ step: n++, instruction: `Play the progression at ${slowPct}% speed` });
  if (tempoPct < 100) {
    steps.push({ step: n++, instruction: `Increase to ${tempoPct}% speed` });
  }
  steps.push({ step: n++, instruction: 'Play along with the song' });

  return steps.slice(0, 6);
}
