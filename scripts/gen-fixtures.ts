import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SongGraph } from '../src/domain/music/song-graph.js';
import type { ChordEvent, ChordQuality } from '../src/domain/music/chord.js';
import type { NoteEvent } from '../src/domain/music/note.js';
import type { MusicalMotif } from '../src/domain/music/motif.js';

const chord = (root: ChordEvent['root'], quality: ChordQuality, startBeat: number, durationBeats: number, confidence = 1): ChordEvent => ({
  startBeat, durationBeats, root, quality, confidence,
});

const note = (i: number, midi: number, startBeat: number, durationBeats: number, salience?: number): NoteEvent => ({
  id: `n${i}`,
  midi,
  startBeat,
  durationBeats,
  confidence: 1,
  ...(salience !== undefined && { salience }),
});

function graph(spec: Partial<SongGraph> & { id: string; title: string }): SongGraph {
  return {
    metadata: { title: spec.title, durationMs: 0 },
    global: { bpm: 120, timeSignature: { numerator: 4, denominator: 4 }, tuningReferenceHz: 440 },
    beats: [],
    sections: [],
    harmony: { chords: [] },
    motifs: [],
    confidence: { overall: 1 },
    ...spec,
  } as SongGraph;
}

const outDir = path.join(process.cwd(), 'tests', 'fixtures', 'songgraphs');
await mkdir(outDir, { recursive: true });

// 1. simple open chords: C G Am F, whole notes
{
  const chords = [
    chord('C', 'major', 0, 4), chord('G', 'major', 4, 4),
    chord('A', 'minor', 8, 4), chord('F', 'major', 12, 4),
  ];
  const g = graph({ id: 'graph_simple_open', title: 'Simple Open Chords', harmony: { chords } });
  await writeFile(path.join(outDir, 'simple-open-chords.json'), JSON.stringify(g, null, 2));
}

// 2. difficult chords: Bb Eb Gm F with dense 16th rhythm, fast tempo
{
  const roots: Array<[ChordEvent['root'], ChordQuality]> = [
    ['A#', 'major'], ['D#', 'major'], ['G', 'minor'], ['F', 'major'],
  ];
  const chords: ChordEvent[] = [];
  let beat = 0;
  for (let rep = 0; rep < 2; rep++) {
    for (const [root, quality] of roots) {
      for (let i = 0; i < 8; i++) { // 8 sixteenth strums per 2-beat chord
        chords.push(chord(root, quality, beat + i * 0.25, 0.25));
      }
      beat += 2;
    }
  }
  const g = graph({
    id: 'graph_difficult', title: 'Difficult Chords',
    global: { bpm: 160, timeSignature: { numerator: 4, denominator: 4 }, tuningReferenceHz: 440 },
    harmony: { chords },
  });
  await writeFile(path.join(outDir, 'difficult-chords.json'), JSON.stringify(g, null, 2));
}

// 3. dense rhythm: single C chord, 16ths with syncopation, two bars
{
  const pattern = [0, 0.25, 0.5, 0.75, 1, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75, 3.875];
  const chords = [
    ...pattern.map((b) => chord('C', 'major', b, 0.25)),
    ...pattern.map((b) => chord('C', 'major', 4 + b, 0.25)),
  ];
  const g = graph({ id: 'graph_dense_rhythm', title: 'Dense Rhythm', harmony: { chords } });
  await writeFile(path.join(outDir, 'dense-rhythm.json'), JSON.stringify(g, null, 2));
}

// 4. fast melody: 16 notes at 160bpm, 4-note high-recognition motif
{
  const midiLine = [76, 74, 72, 69, 71, 72, 74, 76, 72, 69, 67, 69, 71, 74, 72, 69];
  const notes = midiLine.map((m, i) => note(i, m, i * 0.5, 0.5));
  const motif: MusicalMotif = {
    id: 'motif_1', sectionId: 'sec_1', type: 'RIFF',
    eventIds: ['n0', 'n1', 'n2', 'n3'],
    salience: 0.9, recognizabilityImportance: 0.95,
  };
  const g = graph({
    id: 'graph_fast_melody', title: 'Fast Melody',
    global: { bpm: 160, timeSignature: { numerator: 4, denominator: 4 }, tuningReferenceHz: 440 },
    melody: { notes },
    motifs: [motif],
    sections: [{ id: 'sec_1', type: 'VERSE', startBeat: 0, endBeat: 8, confidence: 1, importance: 1 }],
  });
  await writeFile(path.join(outDir, 'fast-melody.json'), JSON.stringify(g, null, 2));
}

// 5. mixed beginner song: chords + melody + motifs + sections
{
  const chords = [
    chord('C', 'major', 0, 4), chord('G', 'major', 4, 4),
    chord('A', 'minor', 8, 4), chord('F', 'major', 12, 4),
  ];
  const melodyMidi = [65, 67, 69, 67, 64, 67, 72, 71, 69, 67, 65, 64, 62, 64, 67, 65];
  const notes = melodyMidi.map((m, i) => note(i, m, i, 1, i < 4 ? 0.9 : 0.3));
  const motif: MusicalMotif = {
    id: 'motif_1', sectionId: 'sec_1', type: 'MELODY',
    eventIds: ['n0', 'n1', 'n2', 'n3'],
    salience: 0.9, recognizabilityImportance: 0.9,
  };
  const g = graph({
    id: 'graph_mixed_beginner', title: 'Mixed Beginner Song',
    global: { bpm: 96, timeSignature: { numerator: 4, denominator: 4 }, tuningReferenceHz: 440 },
    harmony: { chords },
    melody: { notes },
    motifs: [motif],
    sections: [{ id: 'sec_1', type: 'VERSE', startBeat: 0, endBeat: 16, confidence: 1, importance: 0.8 }],
  });
  await writeFile(path.join(outDir, 'mixed-beginner-song.json'), JSON.stringify(g, null, 2));
}

console.log('fixtures written to', outDir);
