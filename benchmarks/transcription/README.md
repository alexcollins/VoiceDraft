# STT Benchmark Kit

Use this folder to benchmark your Antimateria voice transcription against other tools on the same audio dataset.

## 1. Build your dataset

Create a JSONL file (one JSON object per line) with:

- `id` (string): sample identifier
- `audioFile` (string): path to audio file (relative to this JSONL file, or absolute)
- `reference` (string): human-correct transcript (ground truth)
- `tags` (array, optional): accents/noise/domain labels
- `hypotheses` (object, optional): existing transcripts for `datasetHypothesis` providers

Start from `dataset.example.jsonl`.

## 2. Configure providers

Copy `providers.example.json` and enable what you want to test.

Supported provider types in `scripts/benchmark-stt.mjs`:

- `datasetHypothesis`: reads transcript from dataset line (`hypotheses[field]`)
- `command`: runs local command and reads transcript from stdout
- `openai`: OpenAI-compatible transcription endpoint
- `groq`: Groq OpenAI-compatible transcription endpoint
- `deepgram`: Deepgram `/v1/listen` endpoint

Optional manual scoring fields for matrix:

- `costPerHourUsd` (number)
- `integrationEffort` (1-5, where 1 is easiest)

## 3. Run benchmark

From repo root:

```bash
npm run benchmark:stt -- --dataset benchmarks/transcription/dataset.example.jsonl --providers benchmarks/transcription/providers.example.json
```

Useful flags:

- `--maxSamples 50`
- `--timeoutMs 120000`
- `--outDir benchmarks/transcription/results`
- `--weights "accuracy=40,latency=25,cost=20,dx=15"`

## 4. Read outputs

The benchmark writes:

- detailed per-sample JSON
- provider-level summary CSV
- provider-level summary Markdown table

Use the summary in `docs/voice-transcription-competitor-matrix-template.md`.
