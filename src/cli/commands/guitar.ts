import { Command } from 'commander';
import { DEFAULT_GUITAR, type GuitarConfig } from '../../domain/guitar/tuning.js';
import { withCapo } from '../../domain/guitar/capo.js';
import { getPositionsForMidi } from '../../domain/guitar/fretboard.js';
import { AppError } from '../../errors/app-error.js';
import { midiToPitchName } from '../../domain/music/pitch.js';
import { findShape, formatShape, BUILT_IN_SHAPES, type GuitarChordShape } from '../../domain/guitar/chord-shape.js';
import { calculateChordDifficulty, validateChordShape } from '../../engines/guitar/index.js';
import { formatTablature, tablatureFromPositions, type Tablature } from '../../domain/guitar/tablature.js';
import type { PitchClass } from '../../domain/music/pitch.js';

const SUFFIX_QUALITY: Record<string, string> = {
  '': 'major',
  m: 'minor',
  '7': 'dominant7',
  maj7: 'major7',
  m7: 'minor7',
};

/** Parse "Am7" -> { root: "A", quality: "minor7" }. */
export function parseChordName(name: string): { root: PitchClass; quality: string } {
  const match = /^([A-G]#?)(maj7|m7|m|7)?$/.exec(name);
  if (!match) {
    throw new AppError('DOMAIN_VALIDATION', `Cannot parse chord name "${name}"`);
  }
  return { root: match[1] as PitchClass, quality: SUFFIX_QUALITY[match[2] ?? ''] ?? 'other' };
}

function resolveGuitar(capo: number | undefined, frets: string | undefined): GuitarConfig {
  let guitar = DEFAULT_GUITAR;
  if (frets !== undefined) {
    const n = Number(frets);
    if (!Number.isInteger(n) || n < 1) {
      throw new AppError('DOMAIN_VALIDATION', `Invalid --frets "${frets}"`);
    }
    guitar = { ...guitar, frets: n };
  }
  return capo !== undefined ? withCapo(guitar, capo) : guitar;
}

function shapeChordToneSummary(shape: GuitarChordShape): string {
  const { root, quality } = parseChordShapeName(shape);
  const validation = validateChordShape(shape, intervalsFor(quality), root);
  return validation.soundingPitches.map((p) => p.pitchClass).join(' ');
}

// shapes carry their quality in the display name
function parseChordShapeName(shape: GuitarChordShape): { root: PitchClass; quality: string } {
  return parseChordName(shape.chord);
}

const QUALITY_INTERVALS: Record<string, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dominant7: [0, 4, 7, 10],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
};

function intervalsFor(quality: string): number[] {
  return QUALITY_INTERVALS[quality] ?? [0];
}

export function registerGuitarCommand(program: Command): void {
  const guitar = program
    .command('guitar')
    .description('Inspect guitar fretboard, chords, and positions');

  guitar
    .command('note')
    .description('List every position where a MIDI note can be played')
    .argument('<midi>', 'MIDI note number 0-127', Number)
    .option('--capo <n>', 'capo position', Number)
    .option('--frets <n>', 'fret range override', String)
    .option('--tab', 'show one valid low-fret path as ASCII tab')
    .action((midi: number, opts: { capo?: number; frets?: string; tab?: boolean }) => {
      if (!Number.isInteger(midi) || midi < 0 || midi > 127) {
        throw new AppError('DOMAIN_VALIDATION', `MIDI ${midi} out of range 0-127`);
      }
      const g = resolveGuitar(opts.capo, opts.frets);
      const positions = getPositionsForMidi(g, midi);

      console.log(`MIDI ${midi}`);
      console.log(midiToPitchName(midi));
      if (g.capo > 0) console.log(`Capo: ${g.capo}`);
      console.log();
      if (positions.length === 0) {
        console.log('Possible positions: none (note below playable range)');
        return;
      }
      console.log('Possible positions:');
      console.log();
      console.log('String  Fret');
      for (const p of positions) {
        console.log(`${`String ${p.string}`.padEnd(8)} Fret ${p.fret}`);
      }

      if (opts.tab && positions.length > 0) {
        const tab: Tablature = tablatureFromPositions([positions[0]!]);
        console.log();
        console.log(formatTablature(tab));
      }
    });

  guitar
    .command('chord')
    .description('Show a built-in chord shape, difficulty, and validation')
    .argument('<name>', `chord name (one of: ${BUILT_IN_SHAPES.map((s) => s.chord).join(', ')})`)
    .action((name: string) => {
      const shape = findShape(name);
      if (!shape) {
        throw new AppError(
          'DOMAIN_VALIDATION',
          `Unknown chord "${name}". Available: ${BUILT_IN_SHAPES.map((s) => s.chord).join(', ')}`,
        );
      }
      const { root, quality } = parseChordShapeName(shape);
      const validation = validateChordShape(shape, intervalsFor(quality), root);
      const difficulty = calculateChordDifficulty(shape);

      console.log(`${root} ${quality}`);
      console.log();
      console.log(formatShape(shape));
      console.log();
      console.log('Barre:');
      console.log(
        shape.barre
          ? `Yes, fret ${shape.barre.fret}, strings ${shape.barre.fromString}-${shape.barre.toString}`
          : 'No',
      );
      console.log();
      console.log('Difficulty:');
      console.log(difficulty.toFixed(1));
      console.log();
      console.log('Chord tones sounded:');
      console.log(shapeChordToneSummary(shape));
      if (!validation.valid) {
        console.log();
        console.log('Validation problems:');
        for (const p of validation.problems) console.log(`- ${p}`);
        process.exitCode = 1;
      }
    });

  guitar
    .command('fretboard')
    .description('Print pitches for a fret range')
    .option('--from <midi>', 'from MIDI', Number, 60)
    .option('--to <midi>', 'to MIDI', Number, 72)
    .option('--capo <n>', 'capo position', Number)
    .action((opts: { from: number; to: number; capo?: number }) => {
      const g = resolveGuitar(opts.capo, undefined);
      console.log(`Pitch classes from MIDI ${opts.from} to ${opts.to} (capo ${g.capo}):`);
      for (let midi = opts.from; midi <= opts.to; midi++) {
        const positions = getPositionsForMidi(g, midi)
          .map((p) => `s${p.string}/f${p.fret}`)
          .join(' ');
        console.log(`${String(midi).padStart(3)} ${midiToPitchName(midi).padEnd(4)} ${positions}`);
      }
    });
}
