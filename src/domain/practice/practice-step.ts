export type PracticeStepKind =
  | 'learn-chords'
  | 'learn-transition'
  | 'loop-section'
  | 'full-run';

/**
 * One block of a practice session. Durations are minutes; a session's steps
 * sum to (approximately) the requested practice time.
 */
export interface PracticeStep {
  kind: PracticeStepKind;
  instruction: string;
  minutes: number;
  /** Loop/full-run steps: tempo factor for this block. */
  tempoFactor?: number;
  /** Chords this step drills. */
  chordNames?: string[];
}
