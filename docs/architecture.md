# Architecture Notes

## Provider boundaries

All third-party technology is isolated behind provider interfaces in
`src/providers/`. Application, domain, and engine code never import a provider
implementation (or its types) directly:

| Boundary | Interface | Implementations |
|---|---|---|
| Audio download | `AudioDownloader` | yt-dlp, local file |
| Audio normalization | `AudioNormalizer` | ffmpeg |
| Music analysis | `MusicAnalysisProvider` (capability-based) | Essentia (WASM baseline), All-In-One via Python worker, madmom-infer deepchroma/CNN-CRF via Python worker, Fake (tests) |
| Stem separation | `StemSeparationProvider` | demucs (htdemucs) via Python worker |

Music analysis providers are **replaceable by design**. The Python MIR worker
(`mir/`, uv environment) owns specialist model inference only — it speaks JSON
over a subprocess (`uv run mir-worker <cmd>`) and never sees SongGraph, guitar,
or application logic. Provider output is the provider-neutral
`PartialRawMusicAnalysis` (`src/domain/analysis/`), never a SongGraph and never
provider-specific types. Evidence-based consensus (`src/engines/analysis-consensus/`)
combines providers; the SongGraph builder is the only consumer of resolved output.

Essentia.js is AGPL-licensed; keeping it behind `MusicAnalysisProvider` means
the licensing boundary is a single directory (`providers/music-analysis/essentia/`).

## Analysis data flow

```
audio/analysis.wav (44.1 kHz PCM16, produced at ingest)
  -> MusicAnalysisProvider.analyze()
     -> RawMusicAnalysis (rhythm / key / chord observations + warnings)
       -> persisted at analysis/raw/<provider>.json (debugging)
       -> persisted at analysis/normalized.json (cache: pipeline version + provider + audio sha256)
         -> buildSongGraph()
           -> graph.json (SongGraph + provenance + heuristic confidence)
```

Cache invalidation is content-based: a change to `ANALYSIS_PIPELINE_VERSION`,
the provider (name or version), or the source audio bytes invalidates the
stored analysis. `guitar song analyze --force` bypasses it.

## Confidence policy

Every automatically inferred value carries confidence. Overall analysis
confidence is a documented weighted heuristic (rhythm 0.3 / key 0.3 / chord
0.4), not a calibrated probability. Low-confidence chord observations become
explicit NO_CHORD gaps rather than guessed chords; meter is labeled
`DEFAULT` until actually detected.
