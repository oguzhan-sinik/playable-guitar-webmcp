import { Command } from 'commander';
import { config } from '../../config/env.js';
import { runSongProcessing } from '../../workflows/song-processing/graph.js';
import { LocalSongGraphRepository } from '../../repositories/song-graph-repository.js';
import { AssessmentSchema } from '../../domain/agent/analysis-decision.js';
import { parseSkillLevel } from '../../domain/skill/skill-preset.js';
import { formatTimeMs } from '../../engines/arrangement/recommend-section.js';
import type { z } from 'zod';

type Assessment = z.infer<typeof AssessmentSchema>;

const assessmentLabel = (a: Assessment): string => {
  switch (a) {
    case 'COHERENT':
      return 'Usable';
    case 'PARTIAL':
      return 'Partial';
    case 'AMBIGUOUS':
      return 'Ambiguous';
    case 'SUSPICIOUS':
      return 'Suspicious';
    case 'UNRELIABLE':
      return 'Unreliable';
  }
};

const uniqueShapes = (shapes: string[]): string => [...new Set(shapes)].join('  ');

export function registerSongProcessCommand(song: Command): void {
  song
    .command('process')
    .description('Run the LangGraph song-processing pipeline (analysis agent -> feasibility agent -> compiler -> simplifier)')
    .argument('<songId>')
    .option('--json', 'machine-readable JSON output')
    .option('--show-trace', 'print the workflow trace table')
    .option('--dry-run', 'run agents and planning without persisting results')
    .option('--force-agents', 'bypass agent decision cache and re-run Gemini')
    .option('--level <level>', 'skill level: beginner | intermediate | advanced', 'beginner')
    .option('--bpm <bpm>', 'MANUAL_OVERRIDE: force BPM before agents run (recorded, not hidden)')
    .option('--meter <meter>', 'MANUAL_OVERRIDE: force meter n/d (recorded, not hidden)')
    .action(
      async (
        songId: string,
        opts: {
          json?: boolean;
          showTrace?: boolean;
          dryRun?: boolean;
          forceAgents?: boolean;
          level?: string;
          bpm?: string;
          meter?: string;
        },
      ) => {
        if (opts.bpm !== undefined || opts.meter !== undefined) {
          const { analyzeSong } = await import('../../application/analyze-song.js');
          const { LocalSongRepository } = await import('../../repositories/song-repository.js');
          const { LocalSongGraphRepository } = await import('../../repositories/song-graph-repository.js');
          await analyzeSong(songId, {
            songs: new LocalSongRepository(config.songsDir),
            graphs: new LocalSongGraphRepository(config.songsDir),
          }, {
            force: true,
            ...(opts.bpm !== undefined && { bpmOverride: Number(opts.bpm) }),
            ...(opts.meter !== undefined && {
              meterOverride: (() => {
                const m = /^(\d+)\/(\d+)$/.exec(opts.meter!);
                if (m === null) throw new Error(`Invalid --meter (use n/d): ${opts.meter}`);
                return { numerator: Number(m[1]), denominator: Number(m[2]) };
              })(),
            }),
          });
        }

        const skillLevel = parseSkillLevel(opts.level);
        const result = await runSongProcessing(songId, {
          dryRun: opts.dryRun === true,
          forceAgents: opts.forceAgents === true,
          skillLevel,
        });

        if (opts.json === true) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        const graph = await new LocalSongGraphRepository(config.songsDir).load(songId);
        const title = graph.metadata.title ?? songId;
        const artist = graph.metadata.artist;
        const ts = graph.global.timeSignature;

        console.log(`Processing ${title}${artist !== undefined ? ` — ${artist}` : ''}`);
        console.log();
        console.log('Music Analysis');
        console.log('──────────────');
        console.log(`Tempo: ${Math.round(graph.global.bpm)} BPM`);
        console.log(`Meter: ${ts.numerator}/${ts.denominator}`);
        if (graph.global.key !== undefined) {
          console.log(`Key: ${graph.global.key}`);
        }
        const sections = [...new Set(graph.sections.map((s) => s.type).filter((t) => t !== 'UNKNOWN'))];
        if (sections.length > 0) {
          console.log();
          console.log('Sections:');
          for (const s of sections) console.log(s);
        }
        console.log();

        if (result.analysisDecision !== undefined) {
          const d = result.analysisDecision;
          console.log('Analysis Agent');
          console.log('──────────────');
          console.log(d.status);
          console.log();
          console.log('Harmony:');
          console.log(assessmentLabel(d.interpretation.harmonyAssessment));
          console.log();
          console.log('Structure:');
          console.log(assessmentLabel(d.interpretation.structureAssessment));
          if (d.warnings.length > 0) {
            console.log();
            for (const w of d.warnings) console.log(`- ${w}`);
          }
          console.log();
        }

        if (result.feasibilityDecision !== undefined) {
          const f = result.feasibilityDecision;
          console.log('Guitar Feasibility');
          console.log('──────────────────');
          console.log(f.strategy);
          if (result.baseArrangement?.difficulty !== undefined) {
            console.log();
            console.log('Original Guitar Difficulty:');
            console.log(`${result.baseArrangement.difficulty.total.toFixed(2)} / 10`);
          }
          if (f.limitations.length > 0) {
            console.log();
            console.log('Current limitation:');
            console.log(f.limitations[0]);
          }
          console.log();
        }

        if (result.arrangementLadder !== undefined && result.arrangementLadder.length > 0) {
          console.log('Choose Your Level');
          console.log('─────────────────');
          console.log();
          for (const entry of result.arrangementLadder) {
            const a = entry.arrangement;
            console.log(entry.level);
            if (a.tuning.capo > 0) console.log(`Capo ${a.tuning.capo}`);
            console.log(uniqueShapes(a.chords.map((c) => c.shapeName)));
            console.log(`Difficulty ${a.difficulty?.total.toFixed(2) ?? '-'}`);
            console.log(`Fidelity ${a.fidelity?.total.toFixed(2) ?? '-'}`);
            console.log();
          }
        }

        const recommended = result.recommendedArrangement ?? result.arrangements[0];
        if (recommended !== undefined) {
          console.log(`Recommended Version (${result.selectedLevel ?? 'BEGINNER'})`);
          console.log('───────────────────');
          if (recommended.tuning.capo > 0) {
            console.log(`Capo: ${recommended.tuning.capo}`);
            console.log();
          }
          console.log('Shapes:');
          console.log(uniqueShapes(recommended.chords.map((c) => c.shapeName)));
          if (recommended.difficulty !== undefined) {
            console.log();
            console.log('Difficulty:');
            console.log(`${recommended.difficulty.total.toFixed(2)} / 10`);
          }
          if (recommended.fidelity !== undefined) {
            console.log();
            console.log('Fidelity:');
            console.log(recommended.fidelity.total.toFixed(2));
          }
          console.log();
        }

        if (result.explanation !== undefined) {
          const e = result.explanation;
          console.log('Why This Version Is Easier');
          console.log('──────────────────────────');
          console.log();
          console.log('Original');
          console.log(`Difficulty: ${e.difficultyBefore.toFixed(2)}`);
          console.log();
          console.log('Your version');
          console.log(`Difficulty: ${e.difficultyAfter.toFixed(2)}`);
          console.log();
          for (const c of e.changes) console.log(`✓ ${c.description}`);
          console.log();
        }

        if (result.recommendedSection !== undefined) {
          const s = result.recommendedSection;
          console.log('Start Here');
          console.log('──────────');
          console.log(s.type);
          console.log(`${formatTimeMs(s.startMs)} → ${formatTimeMs(s.endMs)}`);
          console.log('Learn this section first');
          console.log();
        }

        if (result.lessonSteps !== undefined && result.lessonSteps.length > 0) {
          console.log('Your First Lesson');
          console.log('─────────────────');
          for (const step of result.lessonSteps) {
            console.log(`${step.step}. ${step.instruction}`);
          }
          console.log();
        }

        if (opts.showTrace === true) {
          console.log('Workflow Trace');
          console.log('──────────────');
          for (const event of result.trace) {
            const duration =
              new Date(event.completedAt).getTime() - new Date(event.startedAt).getTime();
            const mark = event.status === 'FAILED' ? '✗' : '✓';
            console.log(`${mark} ${event.node.toLowerCase().padEnd(24)}${duration}ms${event.summary !== undefined ? `  ${event.summary}` : ''}`);
          }
        }
      },
    );
}
