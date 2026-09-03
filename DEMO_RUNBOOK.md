# Hackathon Demo Runbook

## Environment

```bash
gcloud auth application-default login

export GOOGLE_CLOUD_PROJECT="project-db894788-54d4-453d-b8a"
export GOOGLE_CLOUD_LOCATION="global"
export LLM_DEFAULT_MODEL="gemini-3.7-flash"
export LLM_ANALYSIS_MODEL="gemini-3.7-flash"
export LLM_FEASIBILITY_MODEL="gemini-3.7-flash"
```

## ADC check

```bash
gcloud auth application-default print-access-token
pnpm guitar doctor
```

## Hero song ID

`song_5c0d7b45538b` (WebMCP Demo Song — original generated fixture, see README
"Demo mode"). Development-only alternative: `song_07c596988b8d` (Perfect — Ed
Sheeran; never ship or record it). The WebMCP hero flow needs no warm-up and no
Google credentials — `pnpm demo:all` is enough.

## Warm-up (run once before judging)

```bash
pnpm guitar song process song_5c0d7b45538b --force-agents --level beginner --show-trace
```

## Demo command (fast — uses agent cache)

```bash
pnpm guitar song process song_5c0d7b45538b --level beginner --show-trace
```

## Web UI

```bash
pnpm demo
# open http://localhost:3847
```

## Fallback

If Vertex fails during demo, the web UI serves `.demo/demo-result.json` (last real successful run).

Regenerate:

```bash
pnpm guitar song process song_5c0d7b45538b --level beginner --json > .demo/demo-result.json
```
