/** JSON Schema inputs for the WebMCP guitar tools. */

export const emptySchema: Record<string, unknown> = { type: 'object', properties: {} };

export const analyzeSongSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    force: { type: 'boolean', description: 'Re-run analysis even if cached.' },
  },
};

export const compileSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    level: { type: 'string', enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] },
    avoidBarreChords: {
      type: 'boolean',
      description: 'Prefer arrangements with fewer barre chords.',
    },
    section: { type: 'string', description: 'Optional section such as CHORUS or VERSE.' },
    maxDifficulty: { type: 'number', description: 'Hard cap on absolute difficulty (0-10).' },
    maxCapo: { type: 'integer', description: 'Highest capo fret the player accepts.' },
    preferredTempoFactor: { type: 'number', description: 'Practice tempo factor between 0.5 and 1.0.' },
    prioritizeFidelity: { type: 'boolean', description: 'Keep the song as intact as possible even if harder.' },
  },
  required: ['level'],
};

export const playerProfileSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    preset: { type: 'string', enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] },
    knownChords: {
      type: 'array',
      items: { type: 'string' },
      description: 'Chord names the player already knows, e.g. ["C","G","D","Em","Am"].',
    },
    barreChordsComfortable: { type: 'boolean', description: 'Can the player play barre chords comfortably?' },
    comfortableTempoBpm: { type: 'integer', description: 'Tempo in BPM that feels comfortable.' },
    maxPreferredFretSpan: { type: 'integer', description: 'Largest fret span that is physically comfortable.' },
    preferredCapoMax: { type: 'integer', description: 'Highest capo position the player accepts.' },
    avoidBarreChords: { type: 'boolean', description: 'Practice preference: avoid barre chords.' },
    allowSlowerTempo: { type: 'boolean', description: 'Practice preference: slower practice tempo is fine.' },
    prioritizeRecognizability: { type: 'boolean', description: 'Practice preference: keep the song recognizable.' },
  },
  description:
    'Details about the guitarist’s current abilities and physical/practice preferences. Provide at least one field.',
};

export const practiceConfigSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    section: { type: 'string', description: 'Section to practice, e.g. CHORUS.' },
    tempoFactor: { type: 'number', description: 'Practice tempo between 0.5 and 1.0 (pitch unchanged).' },
    loop: { type: 'boolean', description: 'Loop the section during practice.' },
    metronome: { type: 'boolean', description: 'Include a metronome click.' },
    countInBars: { type: 'integer', description: 'Count-in bars before the guitar enters (0-2).' },
    minutes: { type: 'integer', description: 'Requested practice session length in minutes (5-60).' },
  },
};

export const practicePreviewSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    section: { type: 'string', description: 'Section to preview, e.g. CHORUS. Defaults to the configured one.' },
    tempoFactor: { type: 'number', description: 'Practice tempo between 0.5 and 1.0.' },
    metronome: { type: 'boolean', description: 'Include the metronome click.' },
  },
  description:
    'Prepares audio of EXACTLY the compiled arrangement for the human to play from the Practice Studio. It never starts playback by itself.',
};

export const sectionSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    section: { type: 'string', description: 'Section type such as CHORUS, VERSE, BRIDGE.' },
  },
  required: ['section'],
};

export const planSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    minutes: { type: 'integer', minimum: 5, maximum: 60 },
  },
};

export const levelSchema: Record<string, unknown> = {
  type: 'object',
  properties: {
    level: { type: 'string', enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'] },
  },
  required: ['level'],
};
