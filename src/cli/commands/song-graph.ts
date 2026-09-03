import { Command } from 'commander';
import { config } from '../../config/env.js';
import { LocalSongGraphRepository } from '../../repositories/song-graph-repository.js';

export function registerSongGraphCommand(song: Command): void {
  song
    .command('graph')
    .description('Inspect the stored SongGraph for a song')
    .argument('<songId>')
    .option('--json', 'output the full graph as JSON')
    .option('--chords', 'print the chord timeline')
    .option('--beats', 'print the beat timeline')
    .action(
      async (
        songId: string,
        opts: { json?: boolean; chords?: boolean; beats?: boolean },
      ) => {
        const graph = await new LocalSongGraphRepository(config.songsDir).load(songId);

        if (opts.json) {
          console.log(JSON.stringify(graph, null, 2));
          return;
        }

        console.log('Title:');
        console.log(graph.metadata.title ?? '(untitled)');
        console.log();
        if (graph.metadata.artist !== undefined) {
          console.log('Artist:');
          console.log(graph.metadata.artist);
          console.log();
        }
        console.log('Tempo:');
        console.log(`${Math.round(graph.global.bpm)} BPM`);
        console.log();
        console.log('Key:');
        console.log(graph.global.key ?? 'unknown');
        console.log();
        const ts = graph.global.timeSignature;
        console.log('Time signature:');
        console.log(`${ts.numerator}/${ts.denominator} (${ts.source.toLowerCase()}, confidence ${ts.confidence.toFixed(2)})`);
        console.log();
        console.log('Analysis confidence (heuristic):');
        console.log(graph.confidence.overall.toFixed(2));
        console.log();

        if (opts.beats) {
          console.log('Beats:');
          for (const b of graph.beats) {
            console.log(`${String(b.beat).padStart(4)}  ${(b.timeMs / 1000).toFixed(3)}s${b.isDownbeat ? '  downbeat' : ''}`);
          }
          console.log();
        }

        console.log('Chord timeline:');
        for (const c of graph.harmony.chords) {
          const start = (c.startBeat * 60) / graph.global.bpm;
          const end = ((c.startBeat + c.durationBeats) * 60) / graph.global.bpm;
          const rootQuality = `${c.root}${c.quality === 'minor' ? 'm' : ''}`;
          console.log(
            `${start.toFixed(1).padStart(6)}–${end.toFixed(1).padEnd(6)}  ${rootQuality.padEnd(4)}  (conf ${c.confidence.toFixed(2)})`,
          );
        }
      },
    );
}
