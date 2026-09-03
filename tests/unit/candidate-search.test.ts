import { describe, expect, it } from 'vitest';
import { candidateKey, searchArrangements, buildPlayerLadder } from '../../src/engines/arrangement/candidate-search.js';
import { buildBaseArrangement } from '../../src/engines/arrangement/build-base-arrangement.js';
import { computeDifficulty } from '../../src/engines/difficulty/arrangement-difficulty.js';
import { computeFidelity } from '../../src/engines/fidelity/arrangement-fidelity.js';
import { presetProfile } from '../../src/domain/player/player-profile.js';
import { loadGraph } from '../../src/application/prepare-arrangement.js';

const DEMO_SONG = 'song_5c0d7b45538b';

async function preparedBase() {
  const graph = await loadGraph(DEMO_SONG);
  const base = buildBaseArrangement(graph);
  base.difficulty = computeDifficulty({ arrangement: base, song: graph });
  base.fidelity = computeFidelity({ arrangement: base, original: graph });
  return { graph, base };
}

describe('candidate search', () => {
  it('generates multiple musically distinct candidates via chains', async () => {
    const { graph, base } = await preparedBase();
    const candidates = searchArrangements(base, graph, presetProfile('BEGINNER'));
    const keys = new Set(candidates.map(candidateKey));
    expect(candidates.length).toBeGreaterThan(3);
    expect(keys.size).toBe(candidates.length); // dedup by musical identity
  }, 30_000);

  it('bounds the beam: candidate count never exceeds the cap', async () => {
    const { graph, base } = await preparedBase();
    const candidates = searchArrangements(base, graph, presetProfile('BEGINNER'), {
      beamWidth: 4,
      maxDepth: 2,
      maxCandidates: 10,
    });
    expect(candidates.length).toBeLessThanOrEqual(10);
  }, 30_000);

  it('beginner/intermediate/advanced rungs differ when diversity allows', async () => {
    const { graph, base } = await preparedBase();
    const candidates = searchArrangements(base, graph, presetProfile('BEGINNER'));
    const ladder = buildPlayerLadder(candidates, base, graph, undefined);
    expect(ladder.map((l) => l.level)).toEqual(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
    const keys = new Set(ladder.map((l) => candidateKey(l.arrangement)));
    expect(keys.size).toBe(3);
    // advanced is the original key/original shapes; beginner is capo-compiled
    expect(ladder[2]!.arrangement.tuning.capo).toBeLessThanOrEqual(ladder[0]!.arrangement.tuning.capo);
    // fidelity never decreases toward advanced
    expect(ladder[2]!.arrangement.fidelity?.total ?? 1).toBeGreaterThanOrEqual(
      ladder[0]!.arrangement.fidelity?.total ?? 1,
    );
  }, 30_000);

  it('is deterministic', async () => {
    const { graph, base } = await preparedBase();
    const a = searchArrangements(base, graph, presetProfile('BEGINNER')).map(candidateKey);
    const b = searchArrangements(base, graph, presetProfile('BEGINNER')).map(candidateKey);
    expect(a).toEqual(b);
  }, 30_000);
});
