import { Command } from 'commander';
import { config } from '../../config/env.js';
import { prepareSong } from '../../application/prepare-song.js';
import { LocalSongRepository } from '../../repositories/song-repository.js';
import { LocalSongGraphRepository } from '../../repositories/song-graph-repository.js';
import { findShape } from '../../domain/guitar/chord-shape.js';

export function registerSongPrepareCommand(song: Command): void {
  song
    .command('prepare')
    .description('Build and simplify a guitar arrangement from the analyzed SongGraph')
    .argument('<songId>')
    .option('--json', 'output machine-readable JSON')
    .action(async (songId: string, opts: { json?: boolean }) => {
      const prepared = await prepareSong(songId, {
        songs: new LocalSongRepository(config.songsDir),
        graphs: new LocalSongGraphRepository(config.songsDir),
      });
      const { song, base, frontier, warnings } = prepared;

      if (opts.json) {
        console.log(JSON.stringify({ base, frontier }, null, 2));
        return;
      }

      console.log('Song:');
      console.log(`${song.metadata.title ?? songId}${song.metadata.artist !== undefined ? ` — ${song.metadata.artist}` : ''}`);
      console.log();
      console.log('Analysis');
      console.log('────────');
      console.log();
      console.log('Tempo:');
      console.log(`${Math.round(song.global.bpm)} BPM`);
      console.log();
      console.log('Key:');
      console.log(song.global.key ?? 'unknown');
      console.log();
      console.log('Detected chord events:');
      console.log(song.harmony.chords.length);
      console.log();
      console.log('Analysis confidence (heuristic):');
      console.log(song.confidence.overall.toFixed(2));
      console.log();
      console.log('Base Arrangement');
      console.log('────────────────');
      console.log();
      console.log('Difficulty:');
      console.log(base.difficulty!.total.toFixed(2));
      console.log();
      console.log('Fidelity:');
      console.log(base.fidelity!.total.toFixed(2));
      console.log();
      console.log('Shapes:');
      console.log([...new Set(base.chords.map((c) => c.shapeName))].join(' '));
      console.log();

      const sorted = [...frontier].sort((a, b) => a.difficulty!.total - b.difficulty!.total);
      console.log('Recommended Simplifications');
      console.log('───────────────────────────');
      console.log();
      sorted.forEach((c, i) => {
        const capo = c.tuning.capo;
        console.log(`Candidate ${i + 1}`);
        if (capo > 0) {
          console.log();
          console.log('Capo:');
          console.log(capo);
        }
        console.log();
        console.log('Shapes:');
        console.log([...new Set(c.chords.map((x) => x.shapeName))].join(' '));
        console.log();
        console.log('Difficulty:');
        console.log(c.difficulty!.total.toFixed(2));
        console.log();
        console.log('Fidelity:');
        console.log(c.fidelity!.total.toFixed(2));
        console.log();
        const barres = c.chords.filter((x) => findShape(x.shapeName)?.barre).length;
        console.log(`Barre chords: ${barres}`);
        console.log();
      });

      console.log('Warnings');
      console.log('────────');
      for (const w of warnings) console.log(`- [${w.code}] ${w.message}`);
    });
}
