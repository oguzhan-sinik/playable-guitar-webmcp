import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import { findShape } from '../../domain/guitar/chord-shape.js';
import { getPitchAtPosition } from '../../domain/guitar/fretboard.js';
import { getChordPitchClasses } from '../../domain/music/chord.js';
import { midiToPitchClass } from '../../domain/music/pitch.js';

export interface ArrangementValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  eventId?: string;
}

export interface ArrangementValidation {
  valid: boolean;
  errors: ArrangementValidationIssue[];
  warnings: ArrangementValidationIssue[];
}

/**
 * Full arrangement validation. Downstream simplification must reject
 * arrangements whose validation contains errors.
 */
export function validateArrangement(arr: GuitarArrangement): ArrangementValidation {
  const errors: ArrangementValidationIssue[] = [];
  const warnings: ArrangementValidationIssue[] = [];
  const issue = (severity: 'error' | 'warning', code: string, message: string, eventId?: string) =>
    ({ severity, code, message, ...(eventId !== undefined && { eventId }) }) as ArrangementValidationIssue;

  if (!(arr.tempoFactor > 0)) {
    errors.push(issue('error', 'TEMPO_FACTOR', `tempoFactor must be > 0, got ${arr.tempoFactor}`));
  }
  if (!(arr.durationBeats > 0)) {
    errors.push(issue('error', 'DURATION', `durationBeats must be > 0, got ${arr.durationBeats}`));
  }
  if (arr.tuning.capo < 0 || !Number.isInteger(arr.tuning.capo)) {
    errors.push(issue('error', 'CAPO', `invalid capo ${arr.tuning.capo}`));
  }

  for (const c of arr.chords) {
    if (c.startBeat < 0) errors.push(issue('error', 'NEGATIVE_BEAT', 'negative startBeat', c.id));
    if (c.durationBeats <= 0) errors.push(issue('error', 'NONPOSITIVE_DURATION', 'durationBeats must be > 0', c.id));
    if (c.startBeat + c.durationBeats > arr.durationBeats + 1e-9) {
      errors.push(issue('error', 'BEAT_OVERFLOW', 'chord extends past song duration', c.id));
    }
    const shape = findShape(c.shapeName);
    if (!shape) {
      errors.push(issue('error', 'UNKNOWN_SHAPE', `unknown shape "${c.shapeName}"`, c.id));
      continue;
    }
    for (const [i, fret] of shape.frets.entries()) {
      const stringNo = i + 1;
      if (fret !== null && fret + arr.tuning.capo > arr.tuning.frets) {
        errors.push(issue('error', 'FRET_OUT_OF_RANGE', `string ${stringNo} fret ${fret} beyond ${arr.tuning.frets} frets`, c.id));
      }
    }
    // sounding harmony check: shape (+capo) must produce exactly the chord's pitch classes
    const expected = new Set<string>(getChordPitchClasses(c.chord));
    const actual = new Set<string>();
    for (const [i, fret] of shape.frets.entries()) {
      if (fret === null) continue;
      actual.add(midiToPitchClass(getPitchAtPosition(arr.tuning, i + 1, fret)));
    }
    const missing = [...expected].filter((pc) => !actual.has(pc));
    const foreign = [...actual].filter((pc) => !expected.has(pc));
    if (missing.length > 0) {
      errors.push(issue('error', 'HARMONY_MISMATCH', `shape missing chord tones ${missing.join(',')}`, c.id));
    }
    if (foreign.length > 0) {
      errors.push(issue('error', 'HARMONY_MISMATCH', `shape adds non-chord tones ${foreign.join(',')}`, c.id));
    }
  }

  for (const n of arr.notes) {
    if (n.startBeat < 0) errors.push(issue('error', 'NEGATIVE_BEAT', 'negative startBeat', n.id));
    if (n.durationBeats <= 0) errors.push(issue('error', 'NONPOSITIVE_DURATION', 'durationBeats must be > 0', n.id));
    if (n.startBeat + n.durationBeats > arr.durationBeats + 1e-9) {
      errors.push(issue('error', 'BEAT_OVERFLOW', 'note extends past song duration', n.id));
    }
    if (n.position.string < 1 || n.position.string > 6) {
      errors.push(issue('error', 'STRING_OUT_OF_RANGE', `invalid string ${n.position.string}`, n.id));
      continue;
    }
    if (n.position.fret < 0 || n.position.fret + arr.tuning.capo > arr.tuning.frets) {
      errors.push(issue('error', 'FRET_OUT_OF_RANGE', `invalid fret ${n.position.fret}`, n.id));
      continue;
    }
    const sounding = getPitchAtPosition(arr.tuning, n.position.string, n.position.fret);
    if (sounding !== n.midi || n.position.midi !== n.midi) {
      errors.push(issue('error', 'PITCH_MISMATCH', `position sounds MIDI ${sounding}, expected ${n.midi}`, n.id));
    }
  }

  for (const t of arr.techniques) {
    const known = arr.chords.some((c) => c.id === t.targetEventId) ||
      arr.notes.some((n) => n.id === t.targetEventId);
    if (!known) {
      warnings.push(issue('warning', 'DANGLING_TECHNIQUE', `technique references unknown event`, t.id));
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
