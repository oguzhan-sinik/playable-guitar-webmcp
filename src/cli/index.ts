#!/usr/bin/env node
import { Command } from 'commander';
import { AppError } from '../errors/app-error.js';
import { AgentError } from '../errors/agent-errors.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerSongIngestCommand } from './commands/song-ingest.js';
import { registerSongAnalyzeCommand } from './commands/song-analyze.js';
import { registerSongGraphCommand } from './commands/song-graph.js';
import { registerSongPrepareCommand } from './commands/song-prepare.js';
import { registerSongEvaluateGraphCommand } from './commands/song-evaluate-graph.js';
import { registerSongAnalyzeProvidersCommand } from './commands/song-analyze-providers.js';
import { registerSongEvaluateProvidersCommand } from './commands/song-evaluate-providers.js';
import { registerSongRhythmProvidersCommand, registerSongRhythmExplainCommand } from './commands/song-rhythm-providers.js';
import { registerSongAgentAnalyzeCommand } from './commands/song-agent-analyze.js';
import { registerSongProcessCommand } from './commands/song-process.js';
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
  registerSongAgentAnalyzeCommand(song);
  registerSongProcessCommand(song);
}

program.parseAsync(process.argv).catch((err: unknown) => {
  if (err instanceof AppError || err instanceof AgentError) {
    if (process.env.DEBUG) {
      console.error(err.stack);
    } else {
      const msg = err.message.includes('RESOURCE_EXHAUSTED') || err.message.includes('429')
        ? 'Vertex AI rate limit — wait a moment or use cached demo: pnpm demo'
        : err.message;
      console.error(`error: ${msg}`);
    }
    process.exitCode = 1;
    return;
  }
  const message = (err as Error).message ?? String(err);
  if (!process.env.DEBUG && (message.includes('RESOURCE_EXHAUSTED') || message.includes('429'))) {
    console.error('error: Vertex AI rate limit — retry shortly or use: pnpm demo');
    process.exitCode = 1;
    return;
  }
  throw err;
});
