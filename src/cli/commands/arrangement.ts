import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { SongGraphSchema, type SongGraph } from '../../domain/music/song-graph.js';
import { GuitarArrangementSchema, type GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import { AppError } from '../../errors/app-error.js';
import { buildBaseArrangement } from '../../engines/arrangement/build-base-arrangement.js';
import { computeDifficulty } from '../../engines/difficulty/arrangement-difficulty.js';
import { computeFidelity } from '../../engines/fidelity/arrangement-fidelity.js';
import { paretoFilter, compareArrangements, type Dominance } from '../../engines/arrangement/pareto-filter.js';
import { allOperators, generateCandidates, type OperatorKey } from '../../engines/transformations/index.js';
import { findShape } from '../../domain/guitar/chord-shape.js';
import { formatTablature, tablatureFromPositions } from '../../domain/guitar/tablature.js';

async function loadJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    throw new AppError('FILE_NOT_FOUND', `Cannot read JSON file: ${path}`, { cause: err });
  }
}

async function loadGraph(path: string): Promise<SongGraph> {
  const parsed = SongGraphSchema.safeParse(await loadJson(path));
  if (!parsed.success) {
    throw new AppError('DOMAIN_VALIDATION', `Not a valid SongGraph: ${path}`);
  }
  return parsed.data;
}

async function loadArrangement(path: string): Promise<GuitarArrangement> {
  const parsed = GuitarArrangementSchema.safeParse(await loadJson(path));
  if (!parsed.success) {
    throw new AppError('DOMAIN_VALIDATION', `Not a valid GuitarArrangement: ${path}`);
  }
  return parsed.data as GuitarArrangement;
}

function score(arrangement: GuitarArrangement, song: SongGraph): void {
  arrangement.difficulty = computeDifficulty({ arrangement, song });
  arrangement.fidelity = computeFidelity({ arrangement, original: song });
}

function countBarres(a: GuitarArrangement): number {
  return a.chords.filter((c) => findShape(c.shapeName)?.barre).length;
}

function dominanceLabel(d: Dominance): string {
  return d === 'A' ? 'A' : d === 'B' ? 'B' : d === 'EQUAL' ? 'Both (equal)' : 'Neither';
}

export function registerArrangementCommand(program: Command): void {
  const arrangement = program
    .command('arrangement')
    .description('Build, score, simplify, and compare guitar arrangements from synthetic SongGraphs');

  arrangement
    .command('build')
    .description('Build the base arrangement from a SongGraph fixture')
    .argument('<graphJson>')
    .option('--json', 'machine-readable JSON output')
    .action(async (graphJson: string, opts: { json?: boolean }) => {
      const song = await loadGraph(graphJson);
      const built = buildBaseArrangement(song);
      score(built, song);

      if (opts.json) {
        console.log(JSON.stringify(built, null, 2));
        return;
      }
      console.log('Arrangement created');
      console.log();
      console.log('Difficulty:');
      console.log(built.difficulty!.total.toFixed(2));
      console.log();
      console.log('Fidelity:');
      console.log(built.fidelity!.total.toFixed(2));
      console.log();
      console.log('Chords:');
      console.log(built.chords.map((c) => c.shapeName).join(' '));
      console.log();
      console.log('Notes:');
      console.log(built.notes.length);
      if (built.notes.length > 0) {
        console.log();
        console.log(formatTablature(tablatureFromPositions(built.notes.map((n) => n.position))));
      }
    });

  arrangement
    .command('difficulty')
    .description('Score an arrangement JSON file')
    .argument('<arrangementJson>')
    .option('--json', 'full component breakdown as JSON')
    .action(async (arrangementJson: string, opts: { json?: boolean }) => {
      const arr = await loadArrangement(arrangementJson);
      // difficulty needs tempo/timing context; stored score is reused when no song is available
      const difficulty = arr.difficulty ?? null;
      if (opts.json) {
        console.log(JSON.stringify(difficulty, null, 2));
        return;
      }
      if (!difficulty) {
        throw new AppError('DOMAIN_VALIDATION', 'Arrangement has no stored difficulty score');
      }
      console.log(`Difficulty: ${difficulty.total.toFixed(2)}`);
      console.log(`chord=${difficulty.chordComplexity} fingering=${difficulty.fingeringComplexity} movement=${difficulty.handMovement}`);
      console.log(`transitionSpeed=${difficulty.transitionSpeed} rhythm=${difficulty.rhythmComplexity} density=${difficulty.noteDensity}`);
    });

  arrangement
    .command('simplify')
    .description('Generate and compare simplification candidates')
    .argument('<graphJson>')
    .option('--operator <name>', 'tempo | fingering | capo | chords | rhythm | melody (default: all)')
    .option('--json', 'machine-readable JSON output')
    .action(async (graphJson: string, opts: { operator?: string; json?: boolean }) => {
      const song = await loadGraph(graphJson);
      const original = buildBaseArrangement(song);
      score(original, song);

      const operators = allOperators();
      const keys: OperatorKey[] | undefined = opts.operator !== undefined
        ? [opts.operator as OperatorKey]
        : undefined;
      if (keys) {
        for (const key of keys) {
          if (!operators[key]) throw new AppError('DOMAIN_VALIDATION', `Unknown operator "${key}"`);
        }
      }

      const candidates = generateCandidates(original, { song }, keys);
      const frontier = paretoFilter(candidates);

      if (opts.json) {
        console.log(JSON.stringify({ original, candidates: frontier }, null, 2));
        return;
      }

      console.log('Original');
      console.log(`Difficulty: ${original.difficulty!.total.toFixed(1)}`);
      console.log(`Fidelity: ${original.fidelity!.total.toFixed(2)}`);
      console.log();
      frontier
        .slice()
        .sort((a, b) => (a.difficulty!.total - b.difficulty!.total))
        .forEach((c, i) => {
          const last = c.transformations[c.transformations.length - 1];
          console.log(`Candidate ${i + 1}`);
          console.log(`Difficulty: ${c.difficulty!.total.toFixed(1)}`);
          console.log(`Fidelity: ${c.fidelity!.total.toFixed(2)}`);
          if (last) {
            console.log('Transformation:');
            console.log(last.type);
          }
          console.log();
        });
    });

  arrangement
    .command('compare')
    .description('Compare two arrangement JSON files')
    .argument('<aJson>')
    .argument('<bJson>')
    .action(async (aJson: string, bJson: string) => {
      const a = await loadArrangement(aJson);
      const b = await loadArrangement(bJson);
      const cmp = compareArrangements(a, b);
      const da = a.difficulty?.total ?? 0;
      const db = b.difficulty?.total ?? 0;
      const fa = a.fidelity?.total ?? 0;
      const fb = b.fidelity?.total ?? 0;

      console.log('                 A        B');
      console.log();
      console.log(`Difficulty     ${da.toFixed(1).padStart(4)}    ${db.toFixed(1).padStart(4)}`);
      console.log(`Fidelity       ${fa.toFixed(2).padStart(4)}    ${fb.toFixed(2).padStart(4)}`);
      console.log(`Notes          ${String(a.notes.length).padStart(4)}    ${String(b.notes.length).padStart(4)}`);
      console.log(`Barres         ${String(countBarres(a)).padStart(4)}    ${String(countBarres(b)).padStart(4)}`);
      console.log(`Tempo factor   ${a.tempoFactor.toFixed(2).padStart(4)}    ${b.tempoFactor.toFixed(2).padStart(4)}`);
      console.log();
      console.log('Dominates:');
      console.log(dominanceLabel(cmp.dominance));
    });
}
