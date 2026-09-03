import { Command } from 'commander';
import { config } from '../../config/env.js';
import { getAgentModel } from '../../providers/llm/model-factory.js';
import { analyzeSong } from '../../application/analyze-song.js';
import { LocalSongGraphRepository } from '../../repositories/song-graph-repository.js';
import { buildAnalysisEvidenceSummary, runAnalysisAgent } from '../../agents/analysis/index.js';

export function registerSongAgentAnalyzeCommand(song: Command): void {
  song
    .command('agent-analyze')
    .description('Run the Analysis Agent over the stored SongGraph (structured review, no transcription)')
    .argument('<songId>')
    .option('--json', 'machine-readable JSON output')
    .action(async (songId: string, opts: { json?: boolean }) => {
      const graph = await new LocalSongGraphRepository(config.songsDir).load(songId);
      const analysisResult = await analyzeSong(songId, {
        songs: new (await import('../../repositories/song-repository.js')).LocalSongRepository(config.songsDir),
        graphs: new LocalSongGraphRepository(config.songsDir),
      });
      const evidence = buildAnalysisEvidenceSummary(graph, analysisResult);
      const run = await runAnalysisAgent(await getAgentModel('analysis'), evidence);
      const { decision } = run;

      if (opts.json === true) {
        console.log(JSON.stringify({ decision, provenance: run.provenance, variantRequests: run.variantRequests }, null, 2));
        return;
      }

      console.log('Analysis Agent');
      console.log('──────────────');
      console.log();
      console.log('Status:');
      console.log(decision.status);
      console.log();
      console.log('Confidence:');
      console.log(decision.confidence.toFixed(2));
      console.log();
      console.log('Tempo:');
      console.log(decision.interpretation.tempoAssessment);
      console.log();
      console.log('Harmony:');
      console.log(decision.interpretation.harmonyAssessment);
      console.log();
      console.log('Structure:');
      console.log(decision.interpretation.structureAssessment);
      if (decision.warnings.length > 0) {
        console.log();
        console.log('Warnings:');
        for (const w of decision.warnings) console.log(`- ${w}`);
      }
      console.log();
      console.log('Recommended action:');
      console.log(decision.recommendedAction);
    });
}
