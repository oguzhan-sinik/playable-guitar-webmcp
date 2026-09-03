import type { SongResearchSession } from '../../domain/song-research/research-session.js';
import type { ResearchResolution } from '../../domain/song-research/research-resolution.js';
import type { ResearchConflict } from '../../domain/song-research/research-hypothesis.js';
import { RESOLVER_VERSION, type ResearchConfidence } from '../../domain/song-research/research-confidence.js';
import { clamp01 } from '../../domain/song-research/research-confidence.js';
import {
  resolveIdentity,
  resolveKey,
  resolveTempo,
  resolveMeter,
  resolveHarmony,
  resolveStructure,
} from './evidence-consensus.js';
import { researchGaps } from './hypothesis-generator.js';

/**
 * Deterministic evidence fusion: SongResearchSession → ResearchResolution.
 * No LLM anywhere — clusters, priors, noisy-or confidence, explicit conflicts.
 * Readiness thresholds are deliberately coarse; honesty beats decimals.
 */
export function resolveSongResearch(session: SongResearchSession): ResearchResolution {
  const evidence = session.evidence;
  const identity = resolveIdentity(session.songIdentity, evidence);
  const harmony = resolveHarmony(evidence);
  const allHarmonyChords = harmony.sections.flatMap((s) => s.chords);
  const key = resolveKey(evidence, allHarmonyChords, harmony.preferFlats);
  const tempo = resolveTempo(evidence);
  const meter = resolveMeter(evidence);
  const structure = resolveStructure(evidence, harmony);

  const confidence: ResearchConfidence = {
    identity: identity.confidence,
    key: key.confidence,
    tempo: 'bpm' in tempo ? tempo.confidence : 0,
    meter: 'numerator' in meter ? meter.confidence : 0,
    harmony: harmony.confidence,
    structure: structure.confidence,
    overallUsability: 0,
  };
  confidence.overallUsability = clamp01(
    0.2 * confidence.identity +
      0.45 * confidence.harmony +
      0.1 * confidence.key +
      0.1 * confidence.tempo +
      0.075 * confidence.meter +
      0.075 * confidence.structure,
  );

  const status = evidence.length === 0 ? 'RESEARCHING' : readinessStatus(confidence);
  const conflicts: ResearchConflict[] = [
    ...(key.conflict !== undefined ? [key.conflict] : []),
    ...('conflict' in tempo && tempo.conflict !== undefined ? [tempo.conflict] : []),
    ...('conflict' in meter && meter.conflict !== undefined ? [meter.conflict] : []),
    ...harmony.conflicts,
  ];

  const warnings: string[] = [];
  if (status === 'READY_WITH_WARNINGS' || (status === 'READY' && confidence.tempo < 0.7)) {
    if ('bpm' in tempo) warnings.push(`Tempo is a practice tempo, not verified song timing: ${tempo.explanation}`);
  }
  if (confidence.meter < 0.6) warnings.push('Meter unconfirmed — practice display assumes 4/4.');
  if (harmony.sections.length > 0 && harmony.sections.every((s) => s.section === 'SONG')) {
    warnings.push('No section structure found — practicing as one progression.');
  }
  if (key.inferredFromChords) warnings.push('Key inferred from the chord evidence, not stated by a source.');
  if (status === 'READY_WITH_WARNINGS') warnings.push('Compiled from research evidence below full confidence — labeled as such.');

  const resolution: ResearchResolution = {
    status,
    confidence,
    identity: {
      ...(identity.title !== undefined && { title: identity.title }),
      ...(identity.artist !== undefined && { artist: identity.artist }),
      ...(identity.musicBrainzRecordingId !== undefined && { musicBrainzRecordingId: identity.musicBrainzRecordingId }),
      ...(identity.isrc !== undefined && { isrc: identity.isrc }),
      ...(identity.ambiguous && { ambiguous: true }),
      ...(identity.candidateSummaries.length > 0 && { candidateSummaries: identity.candidateSummaries }),
    },
    ...(key.key !== undefined && key.display !== undefined
      ? { key: { tonicPitchClass: key.key.tonicPitchClass, mode: key.key.mode, display: key.display } }
      : {}),
    ...('bpm' in tempo
      ? {
          tempo: {
            practiceOrMetricBpm: tempo.bpm,
            relatedReportedBpms: tempo.relatedReportedBpms,
            support: tempo.confidence,
            explanation: tempo.explanation,
          },
        }
      : {}),
    ...('numerator' in meter
      ? { meter: { numerator: meter.numerator, denominator: meter.denominator, alternatives: meter.alternatives } }
      : {}),
    harmony: {
      sections: harmony.sections,
      mainChords: harmony.mainChords,
      preferFlats: harmony.preferFlats,
    },
    structure: { sectionOrder: structure.sectionOrder },
    conflicts,
    gaps: [],
    warnings,
    resolvedAt: new Date().toISOString(),
    resolverVersion: RESOLVER_VERSION,
    researchVersion: session.researchVersion,
  };

  resolution.gaps = researchGaps({
    identity: {
      ...(resolution.identity.title !== undefined && { title: resolution.identity.title }),
      ...(resolution.identity.artist !== undefined && { artist: resolution.identity.artist }),
    },
    confidence: {
      key: confidence.key,
      tempo: confidence.tempo,
      meter: confidence.meter,
      harmony: confidence.harmony,
      structure: confidence.structure,
    },
    conflicts,
  });

  session.hypotheses = harmony.hypotheses;
  session.status = status;
  session.resolution = resolution;
  return resolution;
}

/** Broad readiness gates. FAILED = identity unresolved — nothing honest to build on. */
function readinessStatus(c: ResearchConfidence): ResearchResolution['status'] {
  if (c.identity < 0.45) return 'FAILED';
  if (c.harmony < 0.5) return 'NEEDS_MORE_EVIDENCE';
  if (c.overallUsability >= 0.82 && c.harmony >= 0.75 && c.identity >= 0.8) return 'READY';
  if (c.overallUsability >= 0.7 && c.harmony >= 0.6) return 'READY_WITH_WARNINGS';
  return 'NEEDS_MORE_EVIDENCE';
}
