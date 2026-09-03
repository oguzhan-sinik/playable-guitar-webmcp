/**
 * Per-chord knowledge for a player. Mastery 0..1:
 * 0 = never played it, 1 = fully comfortable, changes cleanly.
 */
export interface ChordSkill {
  mastery: number;
}

/** Normalize user/agent chord labels ("c", "c#m", "E-") to library form ("Cm"). */
export function normalizeChordLabel(label: string): string {
  let s = label.trim();
  if (s.length === 0) return s;
  s = s[0]!.toUpperCase() + s.slice(1);
  s = s.replace(/-/g, 'm').replace(/^([A-G]#?)maj7$/, '$1maj7').replace(/^([A-G]#?)M$/, '$1');
  return s;
}

/** Clamp a mastery value into [0, 1]; non-numeric input counts as unknown. */
export function clampMastery(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.min(1, Math.max(0, n));
}
