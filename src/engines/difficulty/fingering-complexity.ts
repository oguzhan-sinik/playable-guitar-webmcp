import type { ArrangementChordEvent } from '../../domain/arrangement/chord-event.js';
import { findShape, shapeToPositions } from '../../domain/guitar/chord-shape.js';
import { AppError } from '../../errors/app-error.js';
import { clamp10 } from './config.js';

/** Average fingers required per chord, /4 → 0-10 (4 fingers = hardest). */
export function computeFingeringComplexity(chords: ArrangementChordEvent[]): number {
  if (chords.length === 0) return 0;
  const sum = chords.reduce((acc, ev) => {
    const shape = findShape(ev.shapeName);
    if (!shape) {
      throw new AppError('DOMAIN_VALIDATION', `Unknown chord shape "${ev.shapeName}"`);
    }
    const fretted = shapeToPositions(shape).filter((p) => p.fret > 0);
    const barreStrings = shape.barre
      ? fretted.filter(
          (p) =>
            p.fret === shape.barre!.fret &&
            p.string >= Math.min(shape.barre!.fromString, shape.barre!.toString) &&
            p.string <= Math.max(shape.barre!.fromString, shape.barre!.toString),
        ).length
      : 0;
    const fingers = fretted.length - barreStrings + (shape.barre ? 1 : 0);
    return acc + fingers;
  }, 0);
  return clamp10((sum / chords.length / 4) * 10);
}
