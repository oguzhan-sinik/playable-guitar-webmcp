#!/usr/bin/env node
import { Command } from 'commander';
import { AppError } from '../errors/app-error.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerSongIngestCommand } from './commands/song-ingest.js';
import { registerSongAnalyzeCommand } from './commands/song-analyze.js';
import { registerSongGraphCommand } from './commands/song-graph.js';
import { registerSongPrepareCommand } from './commands/song-prepare.js';
import { registerSongEvaluateGraphCommand } from './commands/song-evaluate-graph.js';
import { registerSongAnalyzeProvidersCommand } from './commands/song-analyze-providers.js';
import { registerSongEvaluateProvidersCommand } from './commands/song-evaluate-providers.js';
import { registerSongRhythmProvidersCommand, registerSongRhythmExplainCommand } from './commands/song-rhythm-providers.js';
import { registerBenchmarkCommand } from './commands/benchmark.js';
import { registerGuitarCommand } from './commands/guitar.js';
import { registerArrangementCommand } from './commands/arrangement.js';

const program = new Command();
program.name('guitar').description('Guitar learning backend CLI').version('0.1.0');

registerDoctorCommand(program);
registerBenchmarkCommand(program);
registerGuitarCommand(program);
registerArrangementCommand(program);
{
  const song = program.command('song').description('Song operations');
  registerSongIngestCommand(song);
  registerSongAnalyzeCommand(song);
  registerSongGraphCommand(song);
  registerSongPrepareCommand(song);
  registerSongEvaluateGraphCommand(song);
  registerSongAnalyzeProvidersCommand(song);
  registerSongEvaluateProvidersCommand(song);
  registerSongRhythmProvidersCommand(song);
  registerSongRhythmExplainCommand(song);
    }

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof AppError) {
    if (process.env.DEBUG) {
      console.error(err.stack);
    } else {
      const msg = err.message
      console.error(`error: ${msg}`);
    }
    process.exitCode = 1;
    return;
  }
  const message = (err as Error).message ?? String(err);
  throw err;
});
