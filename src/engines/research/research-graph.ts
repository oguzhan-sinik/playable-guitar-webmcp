import { SongGraphSchema, type SongGraph, type FieldProvenance } from '../../domain/music/song-graph.js';
import { PITCH_CLASSES, type PitchClass } from '../../domain/music/pitch.js';
import type { ChordQuality } from '../../domain/music/chord.js';
import type { ResearchResolution } from '../../domain/song-research/research-resolution.js';
import type { CanonicalChord } from '../../domain/song-research/evidence-claim.js';

/**
 * ResearchResolution → valid SongGraph the existing guitar compiler accepts
 * UNCHANGED. The graph is a SECTION-RELATIVE practice representation: one
 * chord per bar unless evidence implies otherwise. Timing is NOT claimed to
 * be the recording's timing — timingPrecision stays SECTION_ONLY and
 * generatedTiming marks the synthesized grid.
 */
const FALLBACK_PRACTICE_BPM = 84;
const MIN_BARS_PER_SECTION = 2;

export interface ResearchGraphResult {
  graph: SongGraph;
  warnings: string[];
}

export function buildResearchSongGraph(
  songId: string,
  resolution: ResearchResolution,
  identity: { title?: string; artist?: string },
): ResearchGraphResult {
  const warnings: string[] = [...resolution.warnings];

  const bpm = resolution.tempo?.practiceOrMetricBpm ?? FALLBACK_PRACTICE_BPM;
  if (resolution.tempo === undefined) warnings.push('No tempo evidence — using a neutral 84 BPM practice tempo.');
  const numerator = resolution.meter?.numerator ?? 4;
  const denominator = resolution.meter?.denominator ?? 4;
  const beatMs = 60000 / bpm;

  // section order: resolved structure first, then harmony sections
  const sectionNames = resolution.structure.sectionOrder.filter((name) =>
    resolution.harmony.sections.some((s) => s.section === name),
  );
  for (const s of resolution.harmony.sections) {
    if (!sectionNames.includes(s.section)) sectionNames.push(s.section);
  }
  const sections = sectionNames.length > 0
    ? sectionNames.map((name) => resolution.harmony.sections.find((s) => s.section === name)!)
    : [];

  const beatEvents: SongGraph['beats'] = [];
  const sectionEvents: SongGraph['sections'] = [];
  const chordEvents: SongGraph['harmony']['chords'] = [];
  let beat = 0;
  let sectionIndex = 0;
  for (const section of sections) {
    const bars = Math.max(MIN_BARS_PER_SECTION, section.chords.length);
    const sectionStart = beat;
    for (let bar = 0; bar < bars; bar++) {
      const chord = section.chords[bar % Math.max(1, section.chords.length)] ?? null;
      for (let b = 0; b < numerator; b++) {
        beatEvents.push({ beat, timeMs: Math.round(beat * beatMs), isDownbeat: b === 0, positionInBar: b + 1 });
        beat += 1;
      }
      if (chord !== null) {
        const quality = qualityForFamily(chord.family, warnings, chord);
        chordEvents.push({
          startBeat: sectionStart + bar * numerator,
          durationBeats: numerator,
          root: PITCH_CLASSES[chord.rootPc % 12] as PitchClass,
          quality,
          confidence: Math.min(0.95, section.confidence),
        });
      }
    }
    sectionIndex += 1;
    sectionEvents.push({
      id: `sec_${sectionIndex}`,
      type: sectionTypeOf(section.section),
      startBeat: sectionStart,
      endBeat: beat,
      confidence: section.confidence,
      importance: section.section === 'CHORUS' ? 0.9 : 0.6,
    });
  }

  if (chordEvents.length === 0) {
    throw new Error('No harmony resolved — cannot build a research SongGraph.');
  }

  const durationMs = Math.round(beat * beatMs);
  const c = resolution.confidence;

  const fieldProvenance: Record<string, FieldProvenance> = {
    identity: { origin: 'WEB_RESEARCH', confidence: c.identity, evidenceIds: [], resolutionMethod: 'multi-source identity resolution' },
    tempo: {
      origin: 'WEB_RESEARCH',
      confidence: c.tempo,
      evidenceIds: [],
      resolutionMethod: resolution.tempo?.explanation ?? 'practice tempo fallback',
    },
    meter: { origin: 'WEB_RESEARCH', confidence: c.meter, evidenceIds: [], resolutionMethod: resolution.meter ? 'independent source consensus' : 'assumed 4/4' },
    key: { origin: 'WEB_RESEARCH', confidence: c.key, evidenceIds: [], resolutionMethod: resolution.key ? 'key source consensus with theory-consistency support' : 'unresolved' },
    harmony: { origin: 'WEB_RESEARCH', confidence: c.harmony, evidenceIds: [], resolutionMethod: 'capo-normalized progression consensus across independent source families' },
    sections: { origin: 'WEB_RESEARCH', confidence: c.structure, evidenceIds: [], resolutionMethod: 'section label normalization + ordering' },
    timing: { origin: 'WEB_RESEARCH', confidence: 0.3, evidenceIds: [], resolutionMethod: 'generatedTiming: section-relative grid, one chord per bar' },
  };

  const graph = SongGraphSchema.parse({
    id: songId,
    metadata: {
      ...(identity.title !== undefined && { title: identity.title }),
      ...(identity.artist !== undefined && { artist: identity.artist }),
      durationMs,
    },
    global: {
      bpm,
      timeSignature: { numerator, denominator, confidence: c.meter, source: resolution.meter ? 'ANALYZED' : 'DEFAULT' },
      ...(resolution.key !== undefined && { key: resolution.key.display }),
      tuningReferenceHz: 440,
    },
    beats: beatEvents,
    sections: sectionEvents,
    harmony: { chords: chordEvents },
    timingPrecision: 'SECTION_ONLY',
    motifs: [],
    confidence: {
      overall: c.overallUsability,
      rhythm: Math.min(c.tempo, c.meter),
      ...(c.key > 0 && { key: c.key }),
      chord: c.harmony,
    },
    provenance: {
      provider: 'research-fusion',
      analysisVersion: resolution.resolverVersion,
      createdAt: resolution.resolvedAt,
      origin: 'RESEARCH_FUSION',
      fieldProvenance,
    },
  });

  return { graph, warnings };
}

function qualityForFamily(family: CanonicalChord['family'], warnings: string[], chord: CanonicalChord): ChordQuality {
  switch (family) {
    case 'MAJOR':
      return 'major';
    case 'MINOR':
      return 'minor';
    case 'SEVENTH':
      return 'dominant7';
    case 'OTHER':
      warnings.push(`Chord ${chord.label} simplified to a major triad for compilation (the shape library has no voicing for it).`);
      return 'major';
  }
}

/** Known section type or a safe fallback. */
function sectionTypeOf(label: string): SongGraph['sections'][number]['type'] {
  const known = ['INTRO', 'VERSE', 'PRE_CHORUS', 'CHORUS', 'BRIDGE', 'SOLO', 'BREAKDOWN', 'OUTRO'];
  return (known.find((k) => k === label) ?? 'UNKNOWN') as SongGraph['sections'][number]['type'];
}
