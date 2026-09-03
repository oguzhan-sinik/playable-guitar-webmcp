import type { BeatEvent } from '../../domain/music/beat.js';
import { AppError } from '../../errors/app-error.js';

/**
 * Convert detected tick times (seconds) into the domain BeatEvent timeline.
 * Downbeats: we do NOT have meter detection yet, so no beat except the first
 * is claimed to be a downbeat. Presenting every 4th beat as a downbeat would
 * be manufactured certainty; leave it false until a meter stage exists.
 */
export function ticksToBeats(ticksSeconds: number[], durationSeconds: number): BeatEvent[] {
  const finiteSorted = ticksSeconds
    .filter((t) => Number.isFinite(t) && t >= 0 && t <= durationSeconds)
    .sort((a, b) => a - b);
  const beats: BeatEvent[] = [];
  let last = -1;
  for (let i = 0; i < finiteSorted.length; i++) {
    const t = finiteSorted[i]!;
    if (t === last) continue; // deduplicate identical ticks
    beats.push({ beat: beats.length, timeMs: Math.round(t * 1000), isDownbeat: beats.length === 0 });
    last = t;
  }
  return beats;
}

/** Nearest beat index for a time in seconds, using the actual detected grid. */
export function secondsToNearestBeat(timeSeconds: number, beats: BeatEvent[]): number {
  if (beats.length === 0) {
    throw new AppError('INSUFFICIENT_BEATS', 'No beats available for time alignment');
  }
  let lo = 0;
  let hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid]!.timeMs < timeSeconds * 1000) lo = mid + 1;
    else hi = mid;
  }
  const candidate = beats[lo]!;
  const prev = beats[lo - 1];
  if (prev !== undefined && Math.abs(prev.timeMs - timeSeconds * 1000) < Math.abs(candidate.timeMs - timeSeconds * 1000)) {
    return prev.beat;
  }
  return candidate.beat;
}

/** Map a time range onto the beat grid; end is exclusive on the beat timeline. */
export function timeRangeToBeatRange(
  startSeconds: number,
  endSeconds: number,
  beats: BeatEvent[],
): { startBeat: number; endBeat: number } {
  const startBeat = secondsToNearestBeat(startSeconds, beats);
  let endBeat = secondsToNearestBeat(endSeconds, beats);
  if (endBeat <= startBeat) endBeat = startBeat + 1;
  return { startBeat, endBeat };
}
