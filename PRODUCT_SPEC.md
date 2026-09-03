# AI Guitar Learning System
## Backend Product Design & Implementation Specification

**Status:** Initial Product Specification  
**Backend:** TypeScript  
**Agent Framework:** LangChain TypeScript  
**Orchestration:** LangGraph TypeScript  
**Interface:** CLI only for V0  
**Frontend:** Out of scope  
**Primary Instrument:** Guitar  
**Primary Goal:** Teach users guitar through songs they already love by automatically generating playable, progressively more faithful arrangements matched to their current skill level.

---

# 1. Product Vision

Traditional guitar-learning applications teach users through a predefined curriculum and a predefined library of songs.

This product reverses that relationship.

The user's music becomes the curriculum.

The system should:

1. Understand a song.
2. Determine whether and how it can be played on guitar.
3. Extract or generate a guitar arrangement.
4. Simplify the arrangement intelligently.
5. Generate multiple progressively harder versions.
6. Evaluate how difficult each version is.
7. Preserve the musical identity of the original song.
8. Match the correct version to the player's current abilities.
9. Determine what musical skills the player needs to learn next.
10. Eventually listen to the player and continuously update their skill model.

The core product principle is:

> Find the easiest version of a song the user can play while preserving enough of the song's musical identity that it still feels like the song they love.

---

# 2. Core Product Goal

Given:

```text
Song + Player Skill Profile
```

produce:

```text
SongGraph
    ↓
Playable Guitar Representation
    ↓
Multiple Difficulty-Aware Arrangements
    ↓
Best Arrangement for Player
    ↓
Skills Required
    ↓
Practice Plan
```

Example:

```text
Original song
Difficulty: 9.1 / 10

↓ compile

Level 0
Difficulty: 1.2
Similarity: 62%

Level 1
Difficulty: 2.0
Similarity: 71%

Level 2
Difficulty: 3.1
Similarity: 79%

Level 3
Difficulty: 4.6
Similarity: 87%

Level 4
Difficulty: 6.8
Similarity: 94%

Level 5
Difficulty: 9.1
Similarity: 100%
```

The system then determines:

```text
Player estimated ability: 3.3

Recommended arrangement: Level 2
```

---

# 3. Product Success Condition

The MVP succeeds if this command:

```bash
pnpm guitar song prepare ./fixtures/song.wav --player beginner
```

can produce:

```text
✓ Song analyzed
✓ Tempo detected
✓ Key detected
✓ Sections detected
✓ Chords extracted
✓ Guitar feasibility evaluated
✓ Guitar representation produced

Generated arrangements:

Level 0    Difficulty 1.1    Fidelity 0.64
Level 1    Difficulty 1.9    Fidelity 0.73
Level 2    Difficulty 3.0    Fidelity 0.82
Level 3    Difficulty 4.8    Fidelity 0.91

Recommended for beginner profile:
→ Level 1

New skills required:
→ C → G transition
→ eighth-note downstrumming

Output:
.data/songs/<song-id>/
```

The application does **not** need to teach through a GUI yet.

The first milestone is proving that the backend can reliably transform:

```text
audio
```

into:

```text
structured song
→ guitar arrangement
→ easier guitar arrangement
→ difficulty ladder
→ learning recommendation
```

---

# 4. Primary Product Hypothesis

A player is more motivated to learn:

```text
F major
```

when the application says:

> Learn F major so you can unlock the chorus of one of your favorite songs.

instead of:

> Lesson 17: F Major Chord.

Therefore the product should optimize curriculum generation around:

```text
motivation
+
existing skill reinforcement
+
small amounts of new learning
+
musical preference
```

rather than following a globally predefined curriculum.

---

# 5. V0 Scope

## Included

V0 should support:

- Guitar only.
- Standard guitar tuning: `E A D G B E`.
- Local audio files.
- WAV, MP3, FLAC where possible.
- Song metadata.
- Tempo detection.
- Beat/downbeat detection.
- Key estimation.
- Section segmentation.
- Chord timeline.
- Melody representation where available.
- Guitar-presence detection.
- Guitar stem separation through adapter interfaces.
- Audio transcription through adapter interfaces.
- Guitar fretboard mapping.
- Capo optimization.
- Chord simplification.
- Rhythm simplification.
- Melody/note-density simplification.
- Technique simplification.
- Arrangement difficulty calculation.
- Arrangement fidelity calculation.
- Difficulty ladder generation.
- Player skill profiles.
- Arrangement recommendation.
- Song ranking for a player.
- Practice-plan generation.
- CLI inspection and testing.
- LangChain multi-agent reasoning.
- LangGraph workflow orchestration.
- Structured JSON artifacts.
- Unit tests.
- Integration tests.
- Golden-song regression tests.
- Agent evaluations.

---

# 6. Explicitly Out of Scope for V0

Do **not** build yet:

- Frontend.
- Mobile app.
- User accounts.
- Payments.
- Spotify audio downloading.
- Apple Music audio downloading.
- Arbitrary streaming-service audio processing.
- Real-time microphone coaching.
- Real-time pitch detection.
- Full multiplayer/community functionality.
- Every guitar tuning.
- Seven/eight-string guitars.
- Full production music licensing system.
- Automatic vocal teaching.
- Piano teaching.
- Bass teaching.
- Drum teaching.
- Music generation.
- DAW functionality.
- Production-grade streaming infrastructure.

These can be added after the arrangement engine works.

---

# 7. Architectural Principle

## AI should orchestrate musical intelligence, not invent measurements

Do **not** ask an LLM:

```text
Here is a song.
Generate accurate guitar tabs.
```

The system must separate:

### Deterministic / specialist computation

Responsible for:

- audio analysis,
- note detection,
- tempo,
- beats,
- pitch,
- chord candidates,
- source separation,
- transcription,
- fretboard constraints,
- fingering validation,
- difficulty calculations,
- arrangement transformations,
- candidate search,
- timing calculations.

### Agentic reasoning

Responsible for:

- choosing analysis paths,
- interpreting uncertain analysis,
- deciding appropriate simplifications,
- choosing which musical identity should be protected,
- comparing candidate arrangements,
- explaining transformations,
- selecting pedagogical priorities,
- curriculum planning,
- handling ambiguity.

Rule:

> An LLM may decide **what transformation to attempt**, but deterministic code must validate **whether the resulting arrangement is actually playable and musically valid**.

---

# 8. High-Level Architecture

```text
                           CLI
                            │
                            ▼
                 ┌─────────────────────┐
                 │ Application Service │
                 └──────────┬──────────┘
                            │
                            ▼
                    LangGraph Workflow
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         ▼                  ▼                  ▼
   LangChain Agents    Music Engines       Data Layer
         │                  │                  │
         │                  │                  │
         ▼                  ▼                  ▼
   reasoning           deterministic      artifacts
   planning            algorithms         metadata
   evaluation          model APIs         player data
```

---

# 9. LangChain / LangGraph Architecture

Use:

```text
LangChain
```

for individual agent harnesses.

Use:

```text
LangGraph
```

for multi-agent workflow orchestration.

Do not build the entire application as one giant ReAct agent.

The workflow should contain deterministic nodes and agentic nodes.

Example:

```text
START
  │
  ▼
ingest_song
  │
  ▼
analyze_audio
  │
  ▼
analysis_agent
  │
  ▼
feasibility_agent
  │
  ├── existing guitar ──────┐
  │                         │
  └── arrangement needed ───┤
                            ▼
                   build_base_arrangement
                            │
                            ▼
                   arrangement_agent
                            │
                            ▼
                  deterministic_generator
                            │
                            ▼
                     critic_agent
                            │
                     ┌──────┴──────┐
                     │             │
                   reject        accept
                     │             │
                     └──── retry   ▼
                              save_song
                                   │
                                   ▼
                            curriculum_agent
                                   │
                                   ▼
                                  END
```

---

# 10. Agent System

V0 should use six primary agents.

---

## 10.1 Analysis Agent

### Purpose

Interpret raw music-analysis outputs and construct a coherent understanding of the song.

### Inputs

```ts
RawSongAnalysis
```

### Outputs

```ts
AnalysisInterpretation
```

### Responsibilities

- Resolve uncertain key estimates.
- Resolve ambiguous chord candidates.
- Determine important song sections.
- Determine likely musical hooks.
- Identify which signals deserve high confidence.
- Flag uncertain analysis.
- Recommend additional tools when analysis quality is low.

### Tools

Examples:

```text
get_audio_metadata
get_tempo_candidates
get_key_candidates
get_chord_candidates
get_section_candidates
get_stem_summary
get_transcription_summary
rerun_analysis
```

### Must NOT

- invent notes,
- invent chords not present in candidate data without marking inference,
- directly generate guitar tabs.

---

# 10.2 Guitar Feasibility Agent

### Purpose

Determine the best strategy for converting the song into guitar.

### Output Classification

Every song receives one of:

```ts
type GuitarStrategy =
  | "EXTRACT_EXISTING_GUITAR"
  | "ADAPT_EXISTING_GUITAR"
  | "GENERATE_GUITAR_ARRANGEMENT"
  | "DEFER_LOW_CONFIDENCE";
```

### EXTRACT_EXISTING_GUITAR

Use when:

- clear guitar exists,
- transcription confidence is high,
- part is playable.

### ADAPT_EXISTING_GUITAR

Use when:

- guitar exists,
- original part is too difficult,
- guitar part can still be extracted and simplified.

### GENERATE_GUITAR_ARRANGEMENT

Use when:

- no useful guitar exists,
- harmony/melody/rhythm are understandable,
- a guitar adaptation can represent the song.

### DEFER_LOW_CONFIDENCE

Use when:

- analysis confidence is too low,
- timing cannot be determined,
- transcription is severely unreliable,
- musical identity cannot safely be reconstructed.

---

# 10.3 Arrangement Planner Agent

### Purpose

Determine how an arrangement should be simplified.

It does **not** directly modify MIDI/tab.

Instead, it produces a transformation plan.

Example:

```json
{
  "targetDifficulty": 2.5,
  "preserve": [
    "chorus_hook",
    "harmonic_progression",
    "downbeat_pattern"
  ],
  "transformations": [
    {
      "type": "CAPO_OPTIMIZATION",
      "priority": 1
    },
    {
      "type": "REMOVE_BARRE_CHORDS",
      "priority": 2
    },
    {
      "type": "SIMPLIFY_RHYTHM",
      "priority": 3
    }
  ]
}
```

The deterministic arrangement engine executes the plan.

---

# 10.4 Arrangement Critic Agent

### Purpose

Evaluate candidate arrangements after deterministic validation.

It considers:

```text
Does this still feel like the song?
Did we simplify something musically essential?
Is another candidate preferable?
Did simplification create an awkward musical result?
```

### Inputs

- SongGraph.
- Original arrangement.
- Candidate arrangement.
- deterministic metrics.
- transformation history.

### Output

```ts
{
  accept: boolean;
  reasons: string[];
  protectedElementsMissed: string[];
  recommendedChanges: TransformationRequest[];
}
```

The critic can reject an arrangement.

It cannot bypass deterministic playability rules.

---

# 10.5 Curriculum Agent

### Purpose

Determine what the player should learn next.

Inputs:

```text
PlayerSkillGraph
AvailableSongs
GeneratedArrangements
SongPreferenceScores
```

Output:

```text
PracticePlan
```

Responsibilities:

- recommend songs,
- recommend arrangement level,
- identify required skills,
- prioritize small skill gaps,
- maximize reinforcement,
- avoid large difficulty jumps.

---

# 10.6 Supervisor Agent

The Supervisor handles exceptional reasoning across the workflow.

It should **not** micromanage every deterministic node.

Use it when:

- another agent reports uncertainty,
- conflicting analyses exist,
- candidate generation repeatedly fails,
- a fallback strategy must be selected.

The deterministic LangGraph workflow remains the actual orchestrator.

---

# 11. Strict Structured Agent Outputs

Every agent response must use Zod.

Never parse important agent output from prose.

Example:

```ts
export const FeasibilityDecisionSchema = z.object({
  strategy: z.enum([
    "EXTRACT_EXISTING_GUITAR",
    "ADAPT_EXISTING_GUITAR",
    "GENERATE_GUITAR_ARRANGEMENT",
    "DEFER_LOW_CONFIDENCE",
  ]),

  confidence: z.number().min(0).max(1),

  reasons: z.array(z.string()),

  requiredProcessing: z.array(
    z.enum([
      "SOURCE_SEPARATION",
      "GUITAR_TRANSCRIPTION",
      "MELODY_TRANSCRIPTION",
      "CHORD_ANALYSIS",
      "RHYTHM_ANALYSIS",
    ])
  ),
});
```

Agents should use:

```ts
createAgent({
  ...
  responseFormat: Schema,
});
```

where possible.

---

# 12. Global Workflow State

Create a LangGraph state representing the complete song-processing job.

Conceptually:

```ts
interface SongProcessingState {
  jobId: string;

  songId?: string;

  source?: AudioSource;

  rawAnalysis?: RawSongAnalysis;

  songGraph?: SongGraph;

  feasibility?: GuitarFeasibilityDecision;

  originalArrangement?: GuitarArrangement;

  arrangementPlans?: ArrangementPlan[];

  candidateArrangements?: GuitarArrangement[];

  acceptedArrangements?: GuitarArrangement[];

  player?: PlayerSkillGraph;

  curriculum?: PracticePlan;

  errors: ProcessingError[];

  warnings: ProcessingWarning[];

  trace: WorkflowEvent[];
}
```

Nodes should modify only the fields they own.

---

# 13. Core Domain Model: SongGraph

The most important internal representation is the `SongGraph`.

Do not allow downstream systems to operate directly against raw analysis-provider responses.

Everything must normalize into `SongGraph`.

---

# 14. SongGraph Schema

Approximate structure:

```ts
interface SongGraph {
  id: string;

  metadata: {
    title?: string;
    artist?: string;
    durationMs: number;
  };

  global: {
    bpm: number;
    timeSignature: TimeSignature;
    key?: MusicalKey;
    tuningReferenceHz: number;
  };

  beats: BeatEvent[];

  sections: SongSection[];

  harmony: {
    chords: ChordEvent[];
    keyChanges?: KeyChange[];
  };

  melody?: {
    notes: NoteEvent[];
    phrases: Phrase[];
  };

  rhythm: {
    events: RhythmEvent[];
    groove?: GrooveDescriptor;
  };

  instruments: InstrumentPresence[];

  guitar?: {
    detected: boolean;
    confidence: number;
    transcription?: GuitarTranscription;
  };

  motifs: MusicalMotif[];

  confidence: AnalysisConfidence;
}
```

---

# 15. Note Representation

```ts
interface NoteEvent {
  id: string;

  midi: number;

  pitchClass: number;

  octave: number;

  startBeat: number;

  durationBeats: number;

  velocity?: number;

  confidence: number;

  salience?: number;
}
```

All important musical timing should be represented in beats in addition to milliseconds.

This makes tempo changes and practice-speed changes easier.

---

# 16. Chord Representation

```ts
interface ChordEvent {
  startBeat: number;
  durationBeats: number;

  root: PitchClass;

  quality:
    | "major"
    | "minor"
    | "dominant7"
    | "major7"
    | "minor7"
    | "sus2"
    | "sus4"
    | "diminished"
    | "augmented"
    | "other";

  bass?: PitchClass;

  extensions?: string[];

  confidence: number;
}
```

---

# 17. Song Sections

```ts
type SectionType =
  | "INTRO"
  | "VERSE"
  | "PRE_CHORUS"
  | "CHORUS"
  | "BRIDGE"
  | "SOLO"
  | "BREAKDOWN"
  | "OUTRO"
  | "UNKNOWN";
```

Each section should include:

```ts
interface SongSection {
  id: string;

  type: SectionType;

  startBeat: number;

  endBeat: number;

  confidence: number;

  importance: number;
}
```

`importance` represents pedagogical/musical value.

A chorus can therefore be taught before the intro.

---

# 18. Musical Motifs

The engine needs a concept of musical identity.

Create:

```ts
interface MusicalMotif {
  id: string;

  sectionId: string;

  type:
    | "MELODY"
    | "RIFF"
    | "RHYTHM"
    | "HARMONY"
    | "BASS";

  events: string[];

  salience: number;

  recognizabilityImportance: number;
}
```

Initially motif detection can be basic.

It can later become learned.

---

# 19. Audio Analysis Abstraction

Do not tightly couple the backend to one music model.

Create interfaces.

```ts
interface TempoAnalyzer {
  analyze(file: AudioFile): Promise<TempoAnalysis>;
}

interface ChordAnalyzer {
  analyze(file: AudioFile): Promise<ChordAnalysis>;
}

interface StemSeparator {
  separate(file: AudioFile): Promise<StemSet>;
}

interface MusicTranscriber {
  transcribe(file: AudioFile): Promise<Transcription>;
}

interface SectionAnalyzer {
  analyze(file: AudioFile): Promise<SectionAnalysis>;
}
```

Providers must be replaceable.

---

# 20. Provider Architecture

Example:

```text
MusicAnalysisService
    │
    ├── TempoProvider
    ├── BeatProvider
    ├── KeyProvider
    ├── ChordProvider
    ├── SectionProvider
    ├── SeparationProvider
    └── TranscriptionProvider
```

External music models may run:

- through HTTP APIs,
- through hosted inference endpoints,
- through local subprocesses,
- through Dockerized services.

The **main backend remains TypeScript**.

Do not rewrite research-quality music ML systems in JavaScript simply to satisfy language consistency.

TypeScript owns:

- orchestration,
- contracts,
- persistence,
- validation,
- application logic,
- candidate generation,
- scoring,
- CLI.

---

# 21. Guitar Domain Model

Create explicit guitar-domain primitives.

```ts
interface GuitarConfig {
  strings: number[];

  frets: number;

  capo: number;
}
```

Default:

```ts
{
  strings: [40, 45, 50, 55, 59, 64],
  frets: 24,
  capo: 0
}
```

These represent MIDI pitches:

```text
E2 A2 D3 G3 B3 E4
```

---

# 22. Guitar Note Position

```ts
interface GuitarPosition {
  string: number;

  fret: number;

  midi: number;
}
```

The same MIDI note may have several valid positions.

The guitar engine must enumerate them.

---

# 23. Fingering Cost Function

For every candidate fingering calculate:

```text
position shift
finger stretch
number of fingers
barre requirement
string skipping
open-string advantage
previous-position distance
technique requirement
```

Example:

```ts
interface FingeringCost {
  positionShift: number;
  stretch: number;
  fingerCount: number;
  barre: number;
  stringSkip: number;
  technique: number;

  total: number;
}
```

Never simply choose the lowest fret.

Choose the lowest cumulative playing cost across the phrase.

---

# 24. Capo Optimizer

For chord-based arrangements:

Test:

```text
capo 0
capo 1
capo 2
...
capo 9
```

For each position:

1. transpose chord shapes appropriately,
2. calculate chord-shape difficulty,
3. calculate transition difficulty,
4. calculate barre usage,
5. calculate average hand complexity.

Return candidate configurations.

Example output:

```text
Original key: Bb

Capo 0
Shapes: Bb Eb Gm F
Difficulty: 5.8

Capo 3
Shapes: G C Em D
Difficulty: 1.7

Winner:
Capo 3
```

The sounding key must remain correct.

---

# 25. Guitar Arrangement

```ts
interface GuitarArrangement {
  id: string;

  songId: string;

  level: number;

  tuning: GuitarConfig;

  tempoFactor: number;

  chordEvents: GuitarChordEvent[];

  notes: GuitarNoteEvent[];

  techniques: TechniqueEvent[];

  transformations: AppliedTransformation[];

  difficulty: DifficultyScore;

  fidelity: FidelityScore;

  validation: ArrangementValidation;
}
```

---

# 26. Arrangement Simplification Operators

Simplification must be implemented as explicit reusable operators.

Each operator takes:

```text
Arrangement
```

and produces:

```text
ArrangementCandidate[]
```

with transformation metadata.

---

# 27. Operator 1: Tempo Reduction

Example factors:

```text
1.00
0.90
0.80
0.70
0.60
0.50
```

Tempo reduction changes practice difficulty but not the symbolic arrangement.

Store separately:

```ts
tempoFactor: 0.7
```

Do not mutate original BPM.

---

# 28. Operator 2: Fingering Optimization

Keep exact pitches.

Change:

```text
string/fret positions
```

to minimize:

```text
movement
stretch
string skipping
difficult transitions
```

This transformation has essentially zero intended musical-fidelity loss.

Therefore it should happen before note deletion.

---

# 29. Operator 3: Capo Optimization

Search capo positions.

Objective:

```text
minimize:
chord difficulty
+
transition difficulty
+
barre usage
```

while preserving sounding harmony.

---

# 30. Operator 4: Chord Simplification

Create a chord simplification graph.

Example:

```text
Cmaj9
 ↓
Cmaj7
 ↓
C
 ↓
C5
 ↓
C/E or partial shell
```

Example:

```text
Bm7
 ↓
Bm
 ↓
Bm partial
 ↓
B5
```

The system must retain transformation cost.

Example:

```ts
{
  from: "Cmaj9",
  to: "Cmaj7",
  fidelityCost: 0.05,
  difficultyReduction: 0.18
}
```

---

# 31. Operator 5: Barre Removal

When possible:

```text
full barre
→ partial barre
→ triad
→ dyad
→ alternate capo configuration
```

Capo optimization should be attempted before destructive harmonic simplification.

---

# 32. Operator 6: Rhythm Simplification

Example progression:

```text
sixteenth-note syncopation
↓
eighth-note original accents
↓
regular eighth notes
↓
quarter-note strumming
↓
one strum per chord
```

Important accents should be protected.

---

# 33. Operator 7: Melody Reduction

Do **not** simply remove every second note.

Calculate note salience using:

```text
downbeat importance
duration
phrase position
melodic extremum
chord-tone status
motif membership
repetition
accent
```

Example:

```ts
salience =
  downbeatWeight +
  durationWeight +
  motifWeight +
  contourWeight +
  harmonyWeight;
```

Remove lowest-salience notes first.

---

# 34. Operator 8: Octave Substitution

Allow:

```text
note
→ octave above
```

or:

```text
note
→ octave below
```

only when:

- fretboard playability improves significantly,
- melodic contour remains acceptable,
- recognizability loss remains low.

---

# 35. Operator 9: Technique Simplification

Examples:

```text
bend
→ destination note

slide
→ two picked notes

hammer-on
→ two picked notes

pull-off
→ two picked notes

complex fingerstyle
→ arpeggio

arpeggio
→ chord strum

tremolo picking
→ reduced-note picking
```

---

# 36. Operator 10: Voice Reduction

Original:

```text
bass
+
harmony
+
melody
+
fill
```

Possible beginner version:

```text
harmony only
```

or:

```text
harmony + iconic melody note
```

The system should prioritize whichever musical voice carries the identity of the section.

---

# 37. Difficulty Model

Difficulty must be deterministic first.

Machine-learning personalization can come later.

Normalize:

```text
0.0 = trivial

10.0 = extremely difficult
```

---

# 38. Difficulty Components

```ts
interface DifficultyScore {
  total: number;

  chordComplexity: number;

  fingeringComplexity: number;

  handMovement: number;

  transitionSpeed: number;

  rhythmComplexity: number;

  noteDensity: number;

  techniqueComplexity: number;

  stringPickingComplexity: number;
}
```

---

# 39. Basic Difficulty Formula

Initial version:

```text
D =
w1 * chordComplexity
+
w2 * fingeringComplexity
+
w3 * handMovement
+
w4 * transitionSpeed
+
w5 * rhythmComplexity
+
w6 * noteDensity
+
w7 * techniqueComplexity
+
w8 * pickingComplexity
```

Weights must live in configuration.

Do not hardcode them throughout the application.

Example:

```json
{
  "chordComplexity": 1.2,
  "fingeringComplexity": 1.1,
  "handMovement": 1.0,
  "transitionSpeed": 1.3,
  "rhythmComplexity": 1.1,
  "noteDensity": 0.8,
  "techniqueComplexity": 1.4,
  "pickingComplexity": 1.0
}
```

These numbers are placeholders until calibration.

---

# 40. Player-Specific Difficulty

Generic difficulty is insufficient.

Calculate:

```text
D(arrangement, player)
```

instead of only:

```text
D(arrangement)
```

Example:

```text
Bm barre chord

Generic difficulty:
4.5

Player A:
already mastered Bm
effective difficulty = 1.2

Player B:
never learned barre chords
effective difficulty = 7.4
```

---

# 41. Player Skill Graph

```ts
interface PlayerSkillGraph {
  playerId: string;

  chords: Record<string, SkillState>;

  transitions: ChordTransitionSkill[];

  rhythms: RhythmSkill[];

  techniques: TechniqueSkill[];

  picking: PickingSkill;

  fretboard: FretboardSkill;

  overallEstimate: number;
}
```

---

# 42. Skill State

```ts
interface SkillState {
  mastery: number;

  confidence: number;

  lastObservedAt?: string;

  observations: number;
}
```

Range:

```text
0 → unknown

1 → fully mastered
```

---

# 43. Chord Transition Skill

```ts
interface ChordTransitionSkill {
  from: string;

  to: string;

  comfortableBpm: number;

  mastery: number;
}
```

This is critical.

Knowing:

```text
C
```

and:

```text
G
```

does not automatically mean the player can perform:

```text
C → G → C
```

at 120 BPM.

---

# 44. Arrangement Fidelity Model

Each candidate must receive:

```text
0.0 → unrecognizable

1.0 → original musical content
```

---

# 45. Fidelity Components

```ts
interface FidelityScore {
  total: number;

  harmony: number;

  melody: number;

  rhythm: number;

  motifCoverage: number;

  structure: number;
}
```

---

# 46. Fidelity Formula

Initial deterministic implementation:

```text
F =
wH * harmonySimilarity
+
wM * melodySimilarity
+
wR * rhythmSimilarity
+
wMotif * motifCoverage
+
wS * structuralSimilarity
```

Motifs should receive disproportionately high weight.

Removing an irrelevant passing note should matter very little.

Removing the defining guitar riff should matter enormously.

---

# 47. Core Optimization Problem

The arrangement engine should conceptually solve:

```text
maximize:

Fidelity(arrangement)
-
λ × Difficulty(arrangement, player)
```

with constraints:

```text
arrangement must be playable
fret positions must be valid
timing must be valid
minimum fidelity must be satisfied
```

Alternative formulation:

```text
minimize Difficulty(arrangement, player)

subject to:

Fidelity(arrangement) >= targetFidelity
```

---

# 48. Candidate Search

Do not generate one simplification.

Generate candidates.

Recommended initial algorithm:

```text
Beam Search
+
Pareto Filtering
```

---

# 49. Beam Search

Example:

```text
Original
 │
 ├─ capo optimization
 │   ├─ capo 2
 │   ├─ capo 3
 │   └─ capo 5
 │
 ├─ rhythm simplification
 │
 ├─ chord simplification
 │
 └─ melody reduction
```

At every stage:

1. generate candidate transformations,
2. validate playability,
3. calculate difficulty,
4. calculate fidelity,
5. discard dominated candidates,
6. retain top N candidates.

Start with configurable:

```text
beamWidth = 10
```

Do not optimize prematurely.

---

# 50. Pareto Frontier

Candidate A dominates candidate B when:

```text
A is easier
AND
A has equal or greater fidelity
```

Candidate B should be removed.

Keep arrangements where improving difficulty requires sacrificing fidelity.

---

# 51. Arrangement Ladder Generator

The final result should not contain arbitrary candidates.

It should produce a monotonic ladder.

Example:

```text
L0 difficulty: 1.1
L1 difficulty: 1.8
L2 difficulty: 2.9
L3 difficulty: 4.4
L4 difficulty: 6.3
L5 difficulty: 8.7
```

Requirements:

```text
difficulty(Ln+1) > difficulty(Ln)

fidelity(Ln+1) >= fidelity(Ln)
```

Allow minor tolerance around fidelity due to scoring noise.

---

# 52. Recommended Initial Arrangement Levels

## Level 0 — Recognition

Goal:

> Let an absolute beginner participate in the song.

Use:

- root notes,
- power chords,
- one strum per bar,
- tiny iconic motif if possible,
- heavily reduced tempo.

---

## Level 1 — Beginner Chords

Use:

- familiar open chords,
- capo optimization,
- remove difficult extensions,
- avoid barre chords,
- quarter-note rhythm.

---

## Level 2 — Song Foundation

Use:

- mostly correct harmony,
- eighth-note rhythm,
- simple transitions,
- essential hook fragments.

---

## Level 3 — Recognizable Arrangement

Use:

- original rhythm where feasible,
- important riffs,
- common techniques,
- more accurate voicings.

---

## Level 4 — Near Original

Use:

- mostly original arrangement,
- minor fingering optimization,
- minimal simplification.

---

## Level 5 — Original

Represent original guitar part as accurately as available transcription allows.

---

# 53. Guitar Validation Engine

Every arrangement must pass validation after every transformation.

---

# 54. Validation Rules

Check:

### Fret validity

```text
0 <= fret <= configuredFrets
```

### String validity

```text
1 <= string <= 6
```

### Simultaneous-note validity

A string cannot produce two different fretted notes simultaneously.

### Physical stretch

Flag impossible or extreme hand spans.

### Barre requirements

Correctly identify required barres.

### Transition feasibility

Calculate movement between consecutive positions.

### Timing

Notes cannot have:

```text
negative durations
invalid ordering
invalid beat references
```

### Tuning

Every guitar position must produce the expected MIDI pitch.

---

# 55. Guitar Mapping Test

Critical invariant:

```ts
getPitch(string, fret, tuning, capo)
```

must always equal:

```text
openStringPitch
+
fret
+
capo
```

Test all strings × all supported frets.

---

# 56. Curriculum Engine

After arrangements exist, songs become curriculum candidates.

For every:

```text
player × arrangement
```

calculate:

```text
knownSkills
newSkills
reinforcedSkills
skillGap
difficulty
preference
```

---

# 57. Song Recommendation Score

Initial heuristic:

```text
score =
preferenceWeight
+
reinforcementWeight
+
usefulNewSkillWeight
-
difficultyGapPenalty
-
unknownSkillPenalty
```

Desired behavior:

Prefer songs where:

```text
80–90% of required skills are familiar

10–20% represent useful new learning
```

Make thresholds configurable.

---

# 58. Curriculum Output

```ts
interface PracticePlan {
  playerId: string;

  sessions: PracticeSession[];
}
```

Example:

```json
{
  "sessions": [
    {
      "song": "Song A",
      "arrangementLevel": 1,
      "goals": [
        "Practice G → C",
        "Maintain quarter-note rhythm at 80 BPM"
      ]
    },
    {
      "song": "Song B",
      "arrangementLevel": 2,
      "goals": [
        "Reinforce G, C and D",
        "Introduce eighth-note strumming"
      ]
    }
  ]
}
```

---

# 59. Persistence

V0 requires two storage abstractions.

---

# 60. Metadata Store

Stores:

```text
songs
jobs
analysis metadata
arrangements
players
skill graphs
curriculum
```

Recommended initial implementation:

```text
SQLite
```

Advantages:

- easy CLI development,
- no external service required,
- easy testing,
- portable.

Do not couple business logic to SQLite.

Use repository interfaces so PostgreSQL can replace it later.

---

# 61. Artifact Store

Large artifacts:

```text
audio
stems
MIDI
analysis JSON
tablature JSON
debug output
```

Create:

```ts
interface ArtifactStore {
  put(...): Promise<ArtifactReference>;
  get(...): Promise<Buffer>;
  exists(...): Promise<boolean>;
}
```

Initial provider:

```text
LocalArtifactStore
```

Future:

```text
S3ArtifactStore
```

---

# 62. Suggested Local Data Layout

```text
.data/
  songs/
    <song-id>/
      source/
        original.wav

      analysis/
        tempo.json
        beats.json
        chords.json
        sections.json
        transcription.json

      stems/
        guitar.wav
        vocals.wav
        bass.wav
        drums.wav
        other.wav

      songgraph.json

      arrangements/
        level-0.json
        level-1.json
        level-2.json
        level-3.json
        level-4.json
        level-5.json

      exports/
        level-1.txt
        level-1.mid
```

---

# 63. Repository Structure

Recommended:

```text
src/
  cli/
    commands/
    formatters/
    index.ts

  application/
    prepare-song.ts
    generate-arrangements.ts
    generate-curriculum.ts

  agents/
    analysis/
      agent.ts
      prompt.ts
      schema.ts

    feasibility/
      agent.ts
      prompt.ts
      schema.ts

    arrangement/
      agent.ts
      prompt.ts
      schema.ts

    critic/
      agent.ts
      prompt.ts
      schema.ts

    curriculum/
      agent.ts
      prompt.ts
      schema.ts

    supervisor/
      agent.ts
      prompt.ts
      schema.ts

  workflows/
    song-processing/
      graph.ts
      state.ts
      nodes/
      routing.ts

  domain/
    music/
      song-graph.ts
      note.ts
      chord.ts
      rhythm.ts
      section.ts
      motif.ts

    guitar/
      fretboard.ts
      fingering.ts
      arrangement.ts
      techniques.ts
      capo.ts

    player/
      skill-graph.ts

  engines/
    music-analysis/
    guitar-mapping/
    difficulty/
    fidelity/
    transformations/
    candidate-search/
    curriculum/

  providers/
    audio/
    separation/
    transcription/
    storage/
    llm/

  repositories/
    song-repository.ts
    player-repository.ts
    arrangement-repository.ts

  schemas/

  config/

  utils/

tests/
  unit/
  integration/
  golden/
  agents/
  fixtures/

scripts/

.data/
```

---

# 64. CLI Design

Package executable:

```bash
guitar
```

Development usage:

```bash
pnpm guitar <command>
```

---

# 65. CLI: Health

```bash
pnpm guitar doctor
```

Output:

```text
✓ Node environment
✓ Database
✓ Artifact storage
✓ LLM
✓ Audio analyzer
✓ Transcription provider
✓ Separation provider
```

---

# 66. CLI: Ingest Song

```bash
pnpm guitar song ingest ./song.wav
```

Output:

```text
Song created:
song_123

Duration:
03:42

Stored:
.data/songs/song_123/source/original.wav
```

---

# 67. CLI: Analyze Song

```bash
pnpm guitar song analyze song_123
```

Optional:

```bash
pnpm guitar song analyze song_123 --verbose
```

Output:

```text
Tempo: 118 BPM
Key: G major
Time signature: 4/4

Sections:
Intro
Verse
Chorus
Verse
Chorus
Bridge
Chorus

Guitar detected:
Yes (0.91)

Analysis confidence:
0.86
```

---

# 68. CLI: Inspect SongGraph

```bash
pnpm guitar song graph song_123
```

Options:

```bash
--json

--section chorus

--chords

--melody

--motifs
```

---

# 69. CLI: Evaluate Guitar Feasibility

```bash
pnpm guitar song feasibility song_123
```

Output:

```text
Strategy:
ADAPT_EXISTING_GUITAR

Confidence:
0.91

Reason:
Clear guitar stem detected.
Original part contains advanced barre transitions.
Simplification expected to preserve song identity.
```

---

# 70. CLI: Generate Arrangement

```bash
pnpm guitar song arrange song_123
```

Specific level:

```bash
pnpm guitar song arrange song_123 --level 2
```

Specific player:

```bash
pnpm guitar song arrange song_123 --player player_001
```

---

# 71. CLI: Arrangement Output

```text
Level 2

Difficulty:
3.1 / 10

Fidelity:
0.82

Tempo:
82 BPM practice
118 BPM original

Capo:
2

Changes:
✓ Simplified 2 barre chords
✓ Reduced sixteenth-note rhythm
✓ Preserved chorus riff
✓ Removed 7 low-salience passing notes
```

---

# 72. CLI: Show Tab

```bash
pnpm guitar tab show <arrangement-id>
```

ASCII output is sufficient for V0.

---

# 73. CLI: Compare Arrangements

```bash
pnpm guitar arrangement compare arr_1 arr_2
```

Output:

```text
                 Level 1      Level 2

Difficulty       1.8          3.1
Fidelity         0.73         0.82
Barre chords     0            1
Max fret span    3            4
Note density     0.31         0.58
Rhythm           quarter      eighth
```

---

# 74. CLI: Create Player

```bash
pnpm guitar player create beginner
```

---

# 75. CLI: Inspect Player

```bash
pnpm guitar player show player_001
```

Example:

```text
Overall:
1.8 / 10

Known chords:
Em  0.96
G   0.84
C   0.73
D   0.76

Weak:
G → C
C → D

Not learned:
barre chords
slides
bends
sixteenth-note rhythm
```

---

# 76. CLI: Recommend Songs

```bash
pnpm guitar curriculum recommend player_001
```

Output:

```text
1. Song A / Level 1
   readiness: 94%

   New skill:
   C → G transition

2. Song B / Level 2
   readiness: 88%

   New skill:
   eighth-note strumming
```

---

# 77. CLI: Full Pipeline

Critical developer command:

```bash
pnpm guitar song prepare ./song.wav --player beginner
```

Runs:

```text
ingest
↓
analysis
↓
SongGraph
↓
feasibility
↓
base arrangement
↓
simplification
↓
candidate search
↓
critique
↓
arrangement ladder
↓
player matching
```

---

# 78. Logging

Use structured logs.

Every pipeline execution receives:

```text
jobId
```

Every log entry should optionally contain:

```text
jobId
songId
workflowNode
agent
provider
duration
```

Do not rely on `console.log` inside domain engines.

CLI may format structured application events.

---

# 79. LangSmith

Support LangSmith tracing through environment configuration.

It should be possible to inspect:

- agent calls,
- prompts,
- outputs,
- tool invocations,
- latency,
- retries,
- graph routing,
- failures.

Tracing must not be required to run local tests.

---

# 80. Error Model

Errors must be typed.

Example:

```ts
type ProcessingErrorCode =
  | "UNSUPPORTED_AUDIO"
  | "ANALYSIS_FAILED"
  | "LOW_ANALYSIS_CONFIDENCE"
  | "SEPARATION_FAILED"
  | "TRANSCRIPTION_FAILED"
  | "NO_PLAYABLE_ARRANGEMENT"
  | "AGENT_OUTPUT_INVALID"
  | "PROVIDER_UNAVAILABLE";
```

Do not silently continue when critical processing fails.

---

# 81. Confidence Gates

Every specialist model output should expose confidence when possible.

Example policy:

```text
confidence >= highThreshold
→ continue

confidence between thresholds
→ agent reviews result

confidence < minimumThreshold
→ retry / fallback / defer
```

Thresholds must be configurable.

---

# 82. Retry Policy

Agent and provider failures must be distinct.

Retry:

- transient HTTP errors,
- rate limits,
- model timeouts.

Do not blindly retry:

- invalid audio,
- consistently low transcription confidence,
- impossible arrangement constraints.

LangChain retry middleware should handle model/tool transient failures where appropriate.

---

# 83. LLM Provider Abstraction

No agent should hardcode a model.

Environment:

```text
LLM_DEFAULT_MODEL=

LLM_ANALYSIS_MODEL=

LLM_ARRANGEMENT_MODEL=

LLM_CRITIC_MODEL=

LLM_CURRICULUM_MODEL=
```

Allow all roles to use the same model initially.

---

# 84. Agent Prompt Rule

Prompts should be versioned files.

Example:

```text
agents/
  arrangement/
    prompt.v1.ts
```

Prompts must explicitly state:

```text
You propose transformations.

You do not invent transcription data.

You do not bypass deterministic validation.

Use only SongGraph information supplied to you.

Mark uncertainty explicitly.
```

---

# 85. Testing Strategy

Testing is a first-class product requirement.

Four levels:

```text
1. Unit tests
2. Integration tests
3. Golden-song tests
4. Agent evaluations
```

---

# 86. Unit Tests

Unit tests must cover deterministic music and guitar logic heavily.

---

# 87. Fretboard Tests

Test:

```text
every string
×
every fret
×
capo configurations
```

Properties:

```text
pitch is always correct

enumerated positions actually produce target MIDI note

no invalid fret exists
```

---

# 88. Chord Tests

Fixtures:

```text
C
G
D
Em
Am
F
Bm
Cmaj7
Dm7
G7
```

Test:

- chord notes,
- valid guitar voicings,
- simplification graph,
- difficulty ordering.

Expected:

```text
difficulty(C open)
<
difficulty(F full barre)
```

---

# 89. Capo Tests

Example:

Original harmony:

```text
Bb Eb Gm F
```

Verify that an appropriate capo configuration can produce equivalent sounding harmony using simpler chord shapes.

Assert:

```text
sounding pitch classes remain harmonically equivalent
```

---

# 90. Rhythm Simplification Tests

Given:

```text
sixteenth-note syncopated pattern
```

ensure operators produce progressively simpler valid patterns.

Verify:

```text
event count decreases

downbeat accents remain

difficulty decreases
```

---

# 91. Melody Simplification Tests

Create synthetic melody fixture containing:

- downbeat notes,
- passing notes,
- phrase-ending notes,
- motif notes.

Verify that:

```text
passing notes disappear before motif notes
```

and:

```text
difficulty decreases
```

---

# 92. Arrangement Invariant Tests

For every generated arrangement:

```text
all notes playable

all frets valid

no conflicting same-string notes

difficulty finite

fidelity between 0 and 1

transformation history populated
```

---

# 93. Difficulty Monotonicity Tests

Given increasingly difficult artificial arrangements:

```text
quarter-note open chords
<
eighth-note open chords
<
fast barre chords
<
complex melodic picking
```

difficulty score should increase.

---

# 94. Transformation Property

For every simplification operator:

Expected general behavior:

```text
difficulty(after)
<=
difficulty(before)
```

If not:

the operator should usually reject the transformation.

---

# 95. Golden Song Fixtures

Create a small legally usable evaluation dataset.

Do not use copyrighted commercial tracks in committed tests unless properly licensed.

Create at least five fixtures.

---

## Fixture A — Beginner Guitar Song

Properties:

```text
4/4

simple tempo

open chords

clear guitar

simple rhythm
```

Expected:

```text
EXTRACT_EXISTING_GUITAR
```

---

## Fixture B — Difficult Guitar Song

Properties:

```text
clear guitar

barres

faster transitions

complex rhythm
```

Expected:

```text
ADAPT_EXISTING_GUITAR
```

---

## Fixture C — Piano-Led Song

Properties:

```text
no meaningful guitar

clear melody

clear chords
```

Expected:

```text
GENERATE_GUITAR_ARRANGEMENT
```

---

## Fixture D — Complex but Adaptable Song

Properties:

```text
fast melody

high note density

recognizable motif
```

Expected:

melody reduction preserves motif while removing passing notes.

---

## Fixture E — Low Confidence Song

Properties:

```text
poor/noisy recording

uncertain harmony/transcription
```

Expected:

```text
DEFER_LOW_CONFIDENCE
```

The system must be allowed to say:

```text
I cannot reliably generate this arrangement.
```

---

# 96. Golden Regression Tests

For every golden fixture store expected ranges rather than exact floating-point outputs.

Example:

```ts
expect(level0.difficulty).toBeLessThan(2);
expect(level3.fidelity).toBeGreaterThan(level0.fidelity);
```

Avoid brittle snapshots of full AI-generated responses.

---

# 97. Agent Tests

Agents require separate evaluation.

Each agent gets:

```text
normal case
ambiguous case
conflicting evidence
missing data
bad provider result
low-confidence case
```

---

# 98. Analysis Agent Test

Provide:

```text
BPM candidates:
119.9 = 0.91
60.0 = 0.64
```

Expected:

Agent selects approximately:

```text
120 BPM
```

and explains the half-time candidate.

---

# 99. Feasibility Agent Test

Input:

```text
guitar presence = 0.92

guitar transcription confidence = 0.88

difficulty = high
```

Expected:

```text
ADAPT_EXISTING_GUITAR
```

---

# 100. Critic Agent Test

Create arrangement where:

```text
difficulty improves significantly
```

but:

```text
main chorus motif was removed
```

Expected:

```text
accept = false
```

---

# 101. Hallucination Test

Provide an incomplete SongGraph.

Ask agent to analyze it.

Agent must not invent:

- missing chords,
- missing notes,
- missing sections.

It should request analysis or mark uncertainty.

---

# 102. End-to-End Acceptance Test

Run:

```bash
pnpm guitar song prepare ./tests/fixtures/song-a.wav --player beginner
```

Test passes when:

```text
SongGraph generated

strategy selected

base arrangement generated

>= 3 arrangement levels generated

every arrangement validated

difficulty increases with level

fidelity generally increases with level

beginner recommendation returned

JSON artifacts saved
```

---

# 103. Phase 0 — Repository Foundation

## Goal

Create a production-quality skeleton.

### Tasks

- [ ] Initialize TypeScript project.
- [ ] Strict TypeScript configuration.
- [ ] Add linting.
- [ ] Add formatting.
- [ ] Add test framework.
- [ ] Add LangChain.
- [ ] Add LangGraph.
- [ ] Add Zod.
- [ ] Add CLI framework.
- [ ] Add structured logger.
- [ ] Add environment validation.
- [ ] Add `.data` local artifact directory.
- [ ] Add configuration layer.
- [ ] Add error primitives.
- [ ] Add `doctor` command.

### Tests

- [ ] Build passes.
- [ ] Lint passes.
- [ ] Unit tests execute.
- [ ] CLI starts.
- [ ] Invalid environment produces readable errors.

### Definition of Done

```bash
pnpm test
pnpm build
pnpm guitar doctor
```

all work.

---

# 104. Phase 1 — Music Domain

## Goal

Implement normalized musical representation independently of AI providers.

### Tasks

- [ ] `NoteEvent`
- [ ] `ChordEvent`
- [ ] `BeatEvent`
- [ ] `RhythmEvent`
- [ ] `SongSection`
- [ ] `MusicalMotif`
- [ ] `SongGraph`
- [ ] Zod schemas for every persisted type.
- [ ] Serialization.
- [ ] Validation.

### Tests

- [ ] Valid SongGraph accepted.
- [ ] Invalid timing rejected.
- [ ] Invalid MIDI note rejected.
- [ ] Invalid confidence rejected.
- [ ] Round-trip JSON works.

---

# 105. Phase 2 — Guitar Domain

## Goal

Build a deterministic guitar model.

### Tasks

- [ ] Standard tuning.
- [ ] Fretboard mapping.
- [ ] MIDI → guitar positions.
- [ ] Guitar positions → MIDI.
- [ ] Chord shapes.
- [ ] Fingering representation.
- [ ] Fingering cost.
- [ ] Barre detection.
- [ ] Transition cost.
- [ ] Capo support.
- [ ] Tab representation.

### Tests

- [ ] Exhaustive fretboard pitch test.
- [ ] Open chord fixtures.
- [ ] Barre chord fixtures.
- [ ] Capo equivalence.
- [ ] Position enumeration.

No agents should be required for this phase.

---

# 106. Phase 3 — Audio Analysis Adapters

## Goal

Turn audio into raw structured musical observations.

### Tasks

Define adapters:

- [ ] tempo,
- [ ] beats,
- [ ] key,
- [ ] chords,
- [ ] sections,
- [ ] stems,
- [ ] transcription.

Create fake providers first.

Then connect real providers incrementally.

### Critical Rule

Provider-specific formats must never leak outside:

```text
providers/
```

Normalize outputs.

### Tests

Use prerecorded provider fixtures.

CI must not require expensive external inference calls.

---

# 107. Phase 4 — SongGraph Builder

## Goal

Convert provider outputs into one canonical SongGraph.

### Tasks

- [ ] merge timing information,
- [ ] normalize beat positions,
- [ ] normalize chords,
- [ ] normalize transcription,
- [ ] calculate confidence,
- [ ] detect inconsistencies,
- [ ] identify initial motifs,
- [ ] construct sections.

### CLI

```bash
pnpm guitar song analyze <song>
```

### Definition of Done

A fixture produces inspectable:

```text
songgraph.json
```

---

# 108. Phase 5 — First LangChain Agents

Implement:

- [ ] Analysis Agent.
- [ ] Guitar Feasibility Agent.

Use:

```text
structured outputs only
```

Add LangSmith tracing support.

### Graph

```text
ingest
→ analysis providers
→ SongGraph builder
→ Analysis Agent
→ Feasibility Agent
```

### CLI

```bash
pnpm guitar song feasibility <song>
```

---

# 109. Phase 6 — Base Guitar Arrangement

## Goal

Produce one valid guitar representation before attempting multiple difficulty levels.

### Existing guitar route

```text
guitar stem
→ transcription
→ guitar position optimization
→ GuitarArrangement
```

### Non-guitar route

```text
melody
+
chords
+
rhythm
→ guitar arrangement
```

Start non-guitar arrangement extremely simply:

```text
chord progression
+
optional important melody notes
```

Do not attempt sophisticated fingerstyle generation yet.

---

# 110. Phase 7 — Difficulty Engine

Implement deterministic scoring.

### Tasks

- [ ] chord complexity,
- [ ] fingering,
- [ ] stretch,
- [ ] transition,
- [ ] tempo,
- [ ] rhythm,
- [ ] note density,
- [ ] techniques,
- [ ] picking.

### CLI

```bash
pnpm guitar arrangement difficulty <id>
```

### Definition of Done

Synthetic arrangements are ranked in sensible order.

---

# 111. Phase 8 — Fidelity Engine

Implement:

- [ ] chord similarity,
- [ ] melody similarity,
- [ ] rhythm similarity,
- [ ] motif preservation,
- [ ] structural similarity.

### CLI

```bash
pnpm guitar arrangement fidelity <id>
```

---

# 112. Phase 9 — Simplification Operators

Implement in this exact priority order.

### 9.1

- [ ] Fingering optimization.

### 9.2

- [ ] Capo optimization.

### 9.3

- [ ] Tempo adaptation.

### 9.4

- [ ] Rhythm simplification.

### 9.5

- [ ] Barre simplification.

### 9.6

- [ ] Chord simplification.

### 9.7

- [ ] Technique simplification.

### 9.8

- [ ] Melody reduction.

### 9.9

- [ ] Octave substitution.

### 9.10

- [ ] Voice reduction.

Each transformation must expose:

```ts
interface TransformationResult {
  arrangement: GuitarArrangement;

  difficultyBefore: number;

  difficultyAfter: number;

  fidelityBefore: number;

  fidelityAfter: number;

  transformation: AppliedTransformation;
}
```

---

# 113. Phase 10 — Candidate Search

Implement:

```text
candidate generation
+
beam search
+
Pareto filtering
```

Do not use the LLM to enumerate tabs.

The Arrangement Planner Agent supplies strategy.

The deterministic engine explores valid candidates.

---

# 114. Phase 11 — Arrangement Planner Agent

Input:

```text
SongGraph
base arrangement
target difficulty
available transformations
```

Output:

```text
ArrangementPlan
```

The agent should identify:

```text
protected musical elements

preferred simplification order

target complexity

dangerous simplifications
```

---

# 115. Phase 12 — Critic Agent

The Critic evaluates candidate arrangements after deterministic scoring.

Workflow:

```text
generate
↓
validate
↓
difficulty
↓
fidelity
↓
critic
↓
accept / retry
```

Limit retry loops.

Example:

```text
maxCriticIterations = 2
```

Configuration only.

Never allow unbounded agent loops.

---

# 116. Phase 13 — Arrangement Ladder

Generate:

```text
L0
L1
L2
L3
L4
L5
```

Not all songs need all six.

Minimum MVP requirement:

```text
3 distinct playable levels
```

Ensure:

```text
difficulty monotonicity

reasonable fidelity monotonicity
```

---

# 117. Phase 14 — Player Skill Graph

Implement default profiles:

```text
absolute-beginner

beginner

intermediate
```

Example:

```bash
pnpm guitar player create beginner
```

Initially profiles can be seeded manually.

No microphone is required.

---

# 118. Phase 15 — Player-Aware Difficulty

Modify:

```text
difficulty(arrangement)
```

into:

```text
difficulty(arrangement, player)
```

Account for:

- mastered chords,
- chord transitions,
- techniques,
- rhythm capabilities,
- picking speed.

---

# 119. Phase 16 — Curriculum Agent

Input:

```text
player

songs

arrangements
```

Output:

```text
recommended songs
recommended levels
skills to learn
reason
```

### Test

Player who knows:

```text
G
C
Em
D
```

should generally prefer an arrangement requiring those plus one nearby skill over an arrangement requiring:

```text
F barre
Bm
slides
bends
sixteenth-note picking
```

even when generic song difficulty is similar.

---

# 120. Phase 17 — Full LangGraph Workflow

Final V0 graph:

```text
START
 │
 ▼
INGEST
 │
 ▼
RAW_ANALYSIS
 │
 ▼
BUILD_SONG_GRAPH
 │
 ▼
ANALYSIS_AGENT
 │
 ▼
FEASIBILITY_AGENT
 │
 ├──────────────────────────────┐
 │                              │
existing guitar             generated guitar
 │                              │
 ▼                              ▼
TRANSCRIBE                 GENERATE_BASE
 │                              │
 └──────────────┬───────────────┘
                ▼
        GUITAR_OPTIMIZATION
                │
                ▼
       ARRANGEMENT_PLANNER
                │
                ▼
        CANDIDATE_GENERATOR
                │
                ▼
          DIFFICULTY_SCORE
                │
                ▼
           FIDELITY_SCORE
                │
                ▼
             VALIDATE
                │
                ▼
          CRITIC_AGENT
                │
        ┌───────┴────────┐
        │                │
      retry            accept
        │                │
        └─────────► ARRANGEMENT_LADDER
                         │
                         ▼
                  PLAYER_MATCHING
                         │
                         ▼
                  CURRICULUM_AGENT
                         │
                         ▼
                        END
```

---

# 121. Phase 18 — End-to-End CLI

Implement:

```bash
pnpm guitar song prepare path/to/song.wav --player beginner
```

Output both:

```text
human-readable CLI
```

and:

```text
machine-readable JSON
```

Support:

```bash
--json
```

so future agents/code can consume results easily.

---

# 122. V0 Quality Gates

The V0 backend is considered complete only when all of these hold.

## Architecture

- [ ] TypeScript strict mode.
- [ ] LangChain agents.
- [ ] LangGraph orchestration.
- [ ] Structured agent outputs.
- [ ] Provider abstractions.
- [ ] No LLM-generated unvalidated tabs.
- [ ] No frontend dependency.

## Song Analysis

- [ ] SongGraph generated.
- [ ] BPM represented.
- [ ] beat timeline represented.
- [ ] harmony represented.
- [ ] sections represented.
- [ ] confidence represented.

## Guitar

- [ ] Guitar positions valid.
- [ ] capo supported.
- [ ] chord simplification supported.
- [ ] rhythm simplification supported.
- [ ] melody reduction supported.
- [ ] difficulty calculation supported.
- [ ] fidelity calculation supported.

## Arrangement

- [ ] Candidate generation works.
- [ ] validation works.
- [ ] Pareto filtering works.
- [ ] minimum three levels generated for supported fixtures.
- [ ] arrangement levels become harder progressively.

## Player

- [ ] skill graph exists.
- [ ] player-specific difficulty exists.
- [ ] arrangement recommendation exists.
- [ ] curriculum recommendation exists.

## Developer Experience

- [ ] complete CLI pipeline.
- [ ] unit tests.
- [ ] integration tests.
- [ ] golden-song tests.
- [ ] agent tests.
- [ ] structured logs.
- [ ] traceable jobs.

---

# 123. Do Not Optimize Yet

Avoid these premature projects:

```text
custom neural source-separation model

custom transcription foundation model

learned difficulty model

learned fidelity model

real-time microphone recognition

GPU infrastructure

mobile application

microservice decomposition
```

Use existing models/providers behind interfaces.

First prove:

```text
Song
↓
SongGraph
↓
Difficulty-aware guitar arrangements
↓
Personalized recommendation
```

If this works, optimize individual ML components later.

---

# 124. Future Phase — Real-Time Guitar Feedback

Not part of V0, but architecture must allow it later.

Future loop:

```text
arrangement
↓
user plays
↓
microphone
↓
performance analyzer
↓
timing/pitch/chord errors
↓
update PlayerSkillGraph
↓
curriculum changes
```

Possible observations:

```text
correct notes

wrong notes

missed notes

timing offset

chord recognition

transition delay

tempo consistency

rhythm accuracy
```

---

# 125. Future Player Learning Loop

Eventually:

```text
PlayerSkillGraph(t)
+
performance
→
PlayerSkillGraph(t+1)
```

Example:

```text
Before practice

G → C:
mastery 0.41
comfortable BPM 54

After successful sessions

G → C:
mastery 0.63
comfortable BPM 68
```

Now previously difficult songs may automatically become available.

---

# 126. Future Unlock System

Each arrangement can expose:

```text
Current Version
74% Fidelity
```

Next unlock:

```text
82% Fidelity

Requires:
✓ improve G → C to 76 BPM
✓ learn eighth-note upstroke
```

After mastery:

```text
Unlocked:
Original chorus rhythm
```

This should become a major future product mechanic.

---

# 127. Future Playlist Curriculum

Later support:

```text
Spotify playlist metadata
Apple Music library metadata
manual song lists
```

Playlist services should initially provide:

```text
taste
song identity
ranking
metadata
```

not unrestricted audio processing.

The system analyses songs it has legally usable audio access to.

---

# 128. Future Playlist Analysis

Given:

```text
300 favorite songs
```

output:

```text
123 currently supported

37 immediately playable

41 require one small new skill

25 intermediate

20 advanced

54 unsupported / unavailable
```

Then construct a learning path from the supported songs.

---

# 129. Core Product Metrics to Instrument

Even during CLI development store metrics.

Per song:

```text
analysis confidence

processing failures

strategy selected

candidate count

accepted candidate count

difficulty range

fidelity range

simplification operators used

critic rejections
```

Per arrangement:

```text
difficulty

player-specific difficulty

fidelity

number of notes

number of chord transitions

barre count

max fret span

note density

technique count
```

Later these become training/evaluation data.

---

# 130. Long-Term Research Dataset

Every arrangement should maintain provenance.

Store:

```text
original representation

candidate arrangement

transformations

difficulty

fidelity

critic judgment

human rating

player result
```

Future dataset:

```text
Song
+
Original Arrangement
+
Simplification
+
Human Perceived Similarity
+
Difficulty
+
Actual Learning Performance
```

This can eventually train proprietary:

```text
Difficulty Model

Fidelity Model

Arrangement Ranking Model

Player Readiness Model
```

---

# 131. Key Architectural Invariant

The following boundary must remain intact:

```text
RAW AUDIO
   │
   ▼
SPECIALIST MUSIC ANALYSIS
   │
   ▼
SONGGRAPH
   │
   ▼
MUSICAL / GUITAR ALGORITHMS
   │
   ▼
ARRANGEMENT CANDIDATES
   │
   ▼
AGENT REASONING
   │
   ▼
DETERMINISTIC VALIDATION
   │
   ▼
FINAL ARRANGEMENTS
```

Never change this into:

```text
RAW AUDIO
↓
LLM
↓
TAB
```

---

# 132. Product's Core Technical Asset

The most important module is ultimately:

```ts
compileSongForPlayer(
  song: SongGraph,
  player: PlayerSkillGraph,
): Promise<ArrangementLadder>
```

Conceptually:

```text
compile(
    music,
    human ability
)
→
easiest recognizable playable music
```

Everything else should support this function.

---

# 133. Initial Technical Milestone

Before adding any sophisticated agent behavior, prove this example:

Input:

```text
Song:

Key: Bb
Tempo: 120 BPM

Chords:
Bb
Eb
Gm
F

Rhythm:
syncopated eighth/sixteenth pattern
```

Player:

```text
knows G
knows C
knows Em
knows D

cannot play barre chords
comfortable around 80 BPM
```

Expected generated arrangement:

```text
Capo 3

G
C
Em
D

Practice tempo:
80 BPM

Simplified rhythm:
straight eighth notes
```

Requirements:

```text
same sounding harmonic progression

lower difficulty

valid guitar fingering

higher player compatibility
```

If this deterministic case does not work reliably, do not progress to complex source-separation or agent work.

---

# 134. Second Technical Milestone

Input:

```text
fast melody containing 16 notes
```

with:

```text
4 high-salience motif notes
```

Generate:

```text
16-note original

10-note intermediate

6-note beginner

4-note recognition version
```

Required:

```text
difficulty decreases

motif notes survive every version

melodic contour remains recognizable
```

---

# 135. Third Technical Milestone

Take one complete supported audio fixture.

Run:

```bash
pnpm guitar song prepare fixture.wav --player beginner
```

Produce:

```text
SongGraph

original guitar representation

three or more arrangements

difficulty scores

fidelity scores

recommended arrangement

required next skills
```

At that moment, the first complete product hypothesis has been technically demonstrated.

---

# 136. Implementation Priority

Coding agent should execute work in this order:

```text
P0
Repository + types + testing

P1
Music domain

P2
Guitar domain

P3
Deterministic difficulty

P4
Deterministic simplification

P5
Fidelity

P6
Candidate search

P7
Audio provider interfaces

P8
SongGraph generation

P9
Analysis + Feasibility Agents

P10
Arrangement Planner + Critic

P11
PlayerSkillGraph

P12
Curriculum Agent

P13
Complete LangGraph

P14
Complete CLI

P15
Golden evaluation suite
```

Do not reverse this and begin by implementing six agents.

The deterministic musical foundation comes first.

---

# 137. Final Product Definition

The backend is not:

```text
an AI tab generator
```

and it is not:

```text
an AI guitar chatbot
```

It is:

> A system that understands music, understands a guitarist's current abilities, and continuously recompiles the music that person loves into the most faithful version they can successfully play.

The core pipeline is:

```text
FAVORITE MUSIC
      │
      ▼
  SONGGRAPH
      │
      ▼
GUITAR COMPILER
      │
      ▼
ARRANGEMENT LADDER
      │
      ▼
PLAYER SKILL GRAPH
      │
      ▼
BEST PLAYABLE VERSION
      │
      ▼
NEXT SKILLS
      │
      ▼
NEXT SONG / HARDER VERSION
```

Everything implemented in V0 should directly contribute to making that loop work.