import { z } from 'zod';
import { AnalysisAgentDecisionSchema } from '../../domain/agent/analysis-decision.js';
import { GuitarFeasibilityDecisionSchema } from '../../domain/agent/feasibility-decision.js';
import { WorkflowWarningSchema, WorkflowTraceEventSchema } from '../../domain/agent/workflow-trace.js';
import type { GuitarArrangement } from '../../domain/arrangement/arrangement.js';
import type { SkillLevel } from '../../domain/skill/skill-preset.js';
import type { ArrangementLadderEntry } from '../../engines/arrangement/skill-selection.js';
import type { ArrangementExplanation } from '../../engines/arrangement/explain-arrangement.js';
import type { RecommendedSection } from '../../engines/arrangement/recommend-section.js';
import type { LessonStep } from '../../engines/arrangement/lesson-plan.js';

export const SongProcessingResultSchema = z.object({
  jobId: z.string(),
  songId: z.string(),
  status: z.enum(['COMPLETED', 'DEFERRED', 'FAILED']),
  analysisDecision: AnalysisAgentDecisionSchema.optional(),
  feasibilityDecision: GuitarFeasibilityDecisionSchema.optional(),
  arrangements: z.array(z.custom<GuitarArrangement>(() => true)),
  warnings: z.array(WorkflowWarningSchema),
});
export type SongProcessingResult = z.infer<typeof SongProcessingResultSchema> & {
  trace: z.infer<typeof WorkflowTraceEventSchema>[];
  baseArrangement?: GuitarArrangement;
  selectedLevel?: SkillLevel;
  recommendedArrangement?: GuitarArrangement;
  arrangementLadder?: ArrangementLadderEntry[];
  explanation?: ArrangementExplanation;
  recommendedSection?: RecommendedSection;
  lessonSteps?: LessonStep[];
  agentCache?: { analysis?: boolean; feasibility?: boolean };
};
