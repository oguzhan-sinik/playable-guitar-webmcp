import { cp, mkdir, access, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Vitest setup: point GUITAR_DATA_DIR at a repo-local, gitignored test data
 * dir and seed it with the committed demo song graph, so suites that compile
 * against a real SongGraph (candidate-search, preview-render, webmcp-tools)
 * work from a clean clone — no dependence on a developer's .data contents.
 * Runs before each test file's imports (config/env reads the env at import).
 *
 * The seed copy is done out-of-line + rename so parallel vitest workers that
 * run this setup concurrently cannot corrupt each other's copy.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_DIR = path.join(ROOT, 'tests', '.run');
const SONG_ID = 'song_5c0d7b45538b'; // committed seed: seed/demo-song
const dest = path.join(DATA_DIR, 'songs', SONG_ID);

process.env.GUITAR_DATA_DIR = DATA_DIR;

try {
  await access(path.join(dest, 'graph.json'));
} catch {
  const staging = path.join(DATA_DIR, `songs`, `.seed-${process.pid}-${Math.random().toString(36).slice(2)}`);
  await cp(path.join(ROOT, 'seed', 'demo-song'), staging, { recursive: true });
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    await rename(staging, dest);
  } catch {
    // another worker already seeded it — drop our staging copy
    await rm(staging, { recursive: true, force: true });
  }
}
