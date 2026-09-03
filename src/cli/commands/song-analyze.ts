import { Command } from 'commander';
import { config } from '../../config/env.js';
import { analyzeSong } from '../../application/analyze-song.js';
import { DemucsStemSeparationProvider } from '../../providers/music-analysis/registry.js';
import { LocalSongRepository } from '../../repositories/song-repository.js';
import { LocalSongGraphRepository } from '../../repositories/song-graph-repository.js';

export function registerSongAnalyzeCommand(song: Command): void {
  song
    .command('analyze')
    .description('Analyze the normalized audio into a SongGraph (multi-provider, consensus)')
    .argument('<songId>')
    .option('--force', 'recompute even if cached provider results exist')
    .option('--rhythm-provider <id>', 'rhythm provider(s), comma separated (all-in-one, essentia)')
    .option('--chord-provider <id>', 'chord provider(s), comma separated (essentia, deepchroma, cnn-crf)')
    .option('--no-separation', 'skip source separation (full mix only)')
    .option('--no-consensus', 'disable consensus (use first chord provider alone)')
    .option('--bpm <bpm>', 'MANUAL_OVERRIDE: force the resolved BPM (debug only, recorded in graph)')
    .option('--meter <meter>', 'MANUAL_OVERRIDE: force the meter as n/d (debug only, recorded in graph)')
    .option('--json', 'output machine-readable JSON')
    .action(
      async (
        songId: string,
        opts: {
          force?: boolean;
          rhythmProvider?: string;
          chordProvider?: string;
          separation?: boolean;
          consensus?: boolean;
          bpm?: string;
          meter?: string;
          json?: boolean;
        },
      ) => {
        let bpmOverride: number | undefined;
        if (opts.bpm !== undefined) {
          const parsed = Number(opts.bpm);
          if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid --bpm: ${opts.bpm}`);
          bpmOverride = parsed;
        }
        let meterOverride: { numerator: number; denominator: number } | undefined;
        if (opts.meter !== undefined) {
          const m = /^(\d+)\/(\d+)$/.exec(opts.meter);
          if (m === null) throw new Error(`Invalid --meter (use n/d): ${opts.meter}`);
          meterOverride = { numerator: Number(m[1]), denominator: Number(m[2]) };
        }
        const result = await analyzeSong(
          songId,
          {
            songs: new LocalSongRepository(config.songsDir),
            graphs: new LocalSongGraphRepository(config.songsDir),
            stems: new DemucsStemSeparationProvider(),
          },
          {
            force: opts.force === true,
            ...(bpmOverride !== undefined && { bpmOverride }),
            ...(meterOverride !== undefined && { meterOverride }),
            strategy: {
              ...(opts.rhythmProvider !== undefined && {
                rhythmProviders: opts.rhythmProvider.split(',').map((s) => s.trim()),
              }),
              ...(opts.chordProvider !== undefined && {
                chordProviders: opts.chordProvider.split(',').map((s) => s.trim()),
              }),
              useSourceSeparation: opts.separation !== false,
              consensus: { enabled: opts.consensus !== false },
            },
          },
        );

        const { graph } = result;
        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                songId,
                graphPath: result.graphPath,
                ranProviders: result.ranProviders,
                cachedProviders: result.cachedProviders,
                warnings: result.warnings,
                timings: result.timings,
                graphSummary: {
                  bpm: graph.global.bpm,
                  key: graph.global.key ?? null,
                  beats: graph.beats.length,
                  chordEvents: graph.harmony.chords.length,
                  sections: graph.sections.map((s) => s.type),
                  averageChordConfidence: graph.confidence.chord ?? null,
                  overallConfidence: graph.confidence.overall,
                },
              },
              null,
              2,
            ),
          );
          return;
        }

        console.log(`Analyzing ${songId}...`);
        console.log();
        for (const p of result.ranProviders) console.log(`✓ ${p}`);
        for (const p of result.cachedProviders) console.log(`✓ ${p} (cached)`);
        console.log('✓ Consensus + SongGraph built');
        console.log();
        console.log('Tempo:');
        console.log(`${Math.round(graph.global.bpm)} BPM`);
        console.log();
        console.log('Key:');
        console.log(graph.global.key ?? 'unknown');
        console.log();
        const ts = graph.global.timeSignature;
        console.log('Meter:');
        console.log(`${ts.numerator}/${ts.denominator} (${ts.source.toLowerCase()}, confidence ${ts.confidence.toFixed(2)})`);
        console.log();
        console.log('Beats:');
        console.log(`${graph.beats.length} (${graph.beats.filter((b) => b.isDownbeat).length} downbeats)`);
        console.log();
        console.log('Chord events:');
        console.log(graph.harmony.chords.length);
        console.log();
        console.log('Sections:');
        console.log(graph.sections.map((s) => s.type).join(' → '));
        console.log();
        console.log('Average chord confidence:');
        console.log((graph.confidence.chord ?? 0).toFixed(2));
        console.log();
        console.log('Overall analysis confidence (heuristic):');
        console.log(graph.confidence.overall.toFixed(2));
        if (result.warnings.length > 0) {
          console.log();
          console.log('Warnings:');
          for (const w of result.warnings) console.log(`- [${w.code}] ${w.message}`);
        }
        console.log();
        console.log('Graph:');
        console.log(result.graphPath);
      },
    );
}
