import { Command } from 'commander';
import { config } from '../../config/env.js';
import { analyzeSong } from '../../application/analyze-song.js';
import { DemucsStemSeparationProvider } from '../../providers/music-analysis/registry.js';
import { LocalSongRepository } from '../../repositories/song-repository.js';
import { LocalSongGraphRepository } from '../../repositories/song-graph-repository.js';
import { DEFAULT_ANALYSIS_STRATEGY } from '../../config/analysis-strategy.js';

/** Run the strategy's rhythm providers and report per-provider rhythm output
 * plus the resolved consensus. Chord providers are skipped. */
export async function runRhythmProviders(songId: string, opts: { force?: boolean; json?: boolean }): Promise<void> {
  const result = await analyzeSong(
    songId,
    {
      songs: new LocalSongRepository(config.songsDir),
      graphs: new LocalSongGraphRepository(config.songsDir),
      stems: new DemucsStemSeparationProvider(),
    },
    {
      force: opts.force === true,
      saveGraph: false,
      strategy: {
        rhythmProviders: DEFAULT_ANALYSIS_STRATEGY.rhythmProviders,
        chordProviders: [],
        useSourceSeparation: false,
        chordAudioVariants: [],
        consensus: { enabled: false },
        rhythmConsensus: { enabled: true },
        rhythmWeights: DEFAULT_ANALYSIS_STRATEGY.rhythmWeights,
        device: DEFAULT_ANALYSIS_STRATEGY.device,
      },
    },
  );

  const rhythm = result.resolvedRhythm;
  if (opts.json === true) {
    console.log(
      JSON.stringify(
        {
          providers: result.rhythmSummaries,
          resolved: rhythm !== null
            ? {
                bpm: rhythm.bpm,
                pulseLevel: rhythm.pulseLevel,
                meter: rhythm.meter,
                meterAlternatives: rhythm.meterAlternatives,
                downbeats: rhythm.downbeatTimes.length,
                confidence: rhythm.confidence,
                evidence: rhythm.evidence,
              }
            : null,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log('Provider        BPM      Beats   Downbeats   Meter');
  console.log('-'.repeat(58));
  for (const s of result.rhythmSummaries) {
    console.log(
      s.provider.padEnd(16) +
        (s.impliedBpm !== null ? s.impliedBpm.toFixed(1).padStart(6) : '-'.padStart(6)) +
        String(s.beats).padStart(8) +
        String(s.downbeats).padStart(12),
    );
  }
  console.log();
  if (rhythm !== null) {
    const m = rhythm.meter;
    console.log('Resolved:');
    console.log(
      `BPM ${rhythm.bpm.toFixed(1)} (${rhythm.pulseLevel.toLowerCase()} level)  meter ${m.numerator}/${m.denominator ?? 4}${m.compound === true ? ' compound' : ''} (conf ${m.confidence.toFixed(2)})  downbeats ${rhythm.downbeatTimes.length}`,
    );
  } else {
    console.log(`Resolved: ${result.graph.global.bpm} BPM (V1 consensus)`);
  }
}

export function registerSongRhythmProvidersCommand(song: Command): void {
  song
    .command('rhythm-providers')
    .description('Run all rhythm providers and show per-provider output plus the resolved consensus')
    .argument('<songId>')
    .option('--force', 'recompute cached provider results')
    .option('--json', 'machine-readable JSON output')
    .action(async (songId: string, opts: { force?: boolean; json?: boolean }) => {
      await runRhythmProviders(songId, { ...(opts.force !== undefined && { force: opts.force }), json: opts.json === true });
    });
}

export function registerSongRhythmExplainCommand(song: Command): void {
  song
    .command('rhythm-explain')
    .description('(dev) Explain the resolved rhythm: which evidence selected the tempo and meter')
    .argument('<songId>')
    .option('--force', 'recompute cached provider results')
    .action(async (songId: string, opts: { force?: boolean }) => {
      const result = await analyzeSong(
        songId,
        {
          songs: new LocalSongRepository(config.songsDir),
          graphs: new LocalSongGraphRepository(config.songsDir),
          stems: new DemucsStemSeparationProvider(),
        },
        {
          ...(opts.force !== undefined && { force: opts.force }),
          saveGraph: false,
          strategy: {
            rhythmProviders: DEFAULT_ANALYSIS_STRATEGY.rhythmProviders,
            chordProviders: [],
            useSourceSeparation: false,
            chordAudioVariants: [],
            consensus: { enabled: false },
            rhythmConsensus: { enabled: true },
            rhythmWeights: DEFAULT_ANALYSIS_STRATEGY.rhythmWeights,
            device: DEFAULT_ANALYSIS_STRATEGY.device,
          },
        },
      );
      const rhythm = result.resolvedRhythm;
      console.log('Selected tempo / meter:');
      if (rhythm === null) {
        console.log(`${result.graph.global.bpm} BPM (V1 consensus — no V3 rhythm providers ran)`);
        return;
      }
      console.log(`${rhythm.bpm.toFixed(1)} BPM at the ${rhythm.pulseLevel.toLowerCase()} level`);
      const m = rhythm.meter;
      console.log(`Meter: ${m.numerator}/${m.denominator ?? 4}${m.compound === true ? ` compound (grouping ${(m.grouping ?? []).join('+')})` : ''}, confidence ${m.confidence.toFixed(2)}`);
      console.log();
      console.log('Why:');
      for (const e of rhythm.evidence) console.log(`- [${e.kind}] ${e.detail}`);
      console.log();
      console.log('Alternatives considered:');
      for (const alt of rhythm.tempoAlternatives) {
        console.log(`- ${alt.bpm.toFixed(1)} BPM (${alt.pulseLevel.toLowerCase()}, confidence ${alt.confidence.toFixed(2)}, sources: ${alt.sources.join(', ') || 'none'})`);
      }
      for (const alt of rhythm.meterAlternatives) {
        console.log(`- meter ${alt.numerator} beats/bar, confidence ${alt.confidence.toFixed(2)}`);
      }
    });
}
