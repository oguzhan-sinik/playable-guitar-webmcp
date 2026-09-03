import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { config } from '../../config/env.js';
import { AppError } from '../../errors/app-error.js';
import { SongGraphSchema, type SongGraph } from '../../domain/music/song-graph.js';
import { LocalSongGraphRepository } from '../../repositories/song-graph-repository.js';
import { evaluateGraph, type GraphEvaluation } from '../../engines/songgraph/evaluate-graph.js';

export function registerSongEvaluateGraphCommand(song: Command): void {
  song
    .command('evaluate-graph')
    .description('(dev) Compare the inferred SongGraph against a hand-authored reference graph')
    .argument('<songId>')
    .argument('<referenceGraphJson>')
    .option('--json', 'output machine-readable JSON')
    .action(async (songId: string, referencePath: string, opts: { json?: boolean }) => {
      const inferred = await new LocalSongGraphRepository(config.songsDir).load(songId);
      let refJson: unknown;
      try {
        refJson = JSON.parse(await readFile(referencePath, 'utf8'));
      } catch (err) {
        throw new AppError('FILE_NOT_FOUND', `Cannot read reference graph: ${referencePath}`, { cause: err });
      }
      const parsed = SongGraphSchema.safeParse(refJson);
      if (!parsed.success) {
        throw new AppError('DOMAIN_VALIDATION', `Not a valid SongGraph: ${referencePath}`);
      }
      const reference = parsed.data as SongGraph;
      const evaluation = evaluateGraph(inferred, reference);

      if (opts.json) {
        console.log(JSON.stringify(evaluation, null, 2));
        return;
      }

      const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
      console.log('Reference comparison (evaluation only — not used during analysis)');
      console.log();
      console.log('Tempo:');
      console.log(`detected ${evaluation.tempo.detected.toFixed(1)} BPM vs reference ${evaluation.tempo.reference} BPM`);
      console.log(`absolute difference: ${evaluation.tempo.absoluteDifference.toFixed(1)} BPM`);
      console.log(`half/double-time folded difference: ${evaluation.tempo.octaveFoldedDifference.toFixed(1)} BPM`);
      console.log(`musically related: ${evaluation.tempo.musicallyRelated ? 'yes' : 'no'}`);
      console.log();
      if (evaluation.key !== null) {
        console.log('Key:');
        console.log(`detected "${evaluation.key.detected}" vs reference "${evaluation.key.reference}" — ${evaluation.key.match ? 'match' : 'MISMATCH'}`);
        console.log();
      }
      console.log('Chords:');
      console.log(`root accuracy:            ${pct(evaluation.chords.rootAccuracy)}`);
      console.log(`quality accuracy:         ${pct(evaluation.chords.qualityAccuracy)}`);
      console.log(`inferred-chord coverage:  ${pct(evaluation.chords.coverage)}`);
      console.log(`detected chord changes:   ${evaluation.chords.detectedChordChanges}`);
      console.log(`reference chord count:    ${evaluation.chords.referenceChordCount}`);
    });
}
