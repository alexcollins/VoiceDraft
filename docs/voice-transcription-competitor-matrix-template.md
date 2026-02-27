# Voice Transcription Competitor Matrix (Template)

Use this to decide whether your Antimateria transcription should be open-sourced and how it compares to existing options.

## 1. Define your target

Fill this first. Do not compare tools without a specific target.

- Primary use case:
- Typical audio length:
- Languages:
- Environments: (clean office / mobile / noisy / call center / etc.)
- Privacy requirement: (cloud allowed / local only / hybrid)
- Realtime requirement: (yes/no, target ms)
- Budget ceiling per audio hour:

## 2. Candidate discovery playbook

Use these searches to collect candidates:

- GitHub: `speech to text realtime open source`
- GitHub: `whisper streaming diarization`
- GitHub: `web speech recognition transcription`
- Product/API docs: OpenAI, Groq, Deepgram, AssemblyAI, Google, AWS

Filter candidates with:

- active in last 90 days
- clear licensing
- docs + examples + API stability
- issue responsiveness

## 3. Weighted score setup

Default weights (edit if needed):

- Accuracy: `40`
- Latency: `25`
- Cost: `20`
- DX / integration effort: `15`

Total score formula:

`Total = AccuracyScore*0.40 + LatencyScore*0.25 + CostScore*0.20 + DXScore*0.15`

## 4. Benchmark matrix

| Tool | OSS? | License | Cloud/Local | Realtime | Diarization | Avg WER | Avg latency (ms) | Cost/hr (USD) | DX effort (1-5) | Maintainer signal | Total score | Notes |
|---|---|---|---|---|---|---:|---:|---:|---:|---|---:|---|
| Antimateria (current) |  |  |  |  |  |  |  |  |  |  |  |  |
| Candidate 1 |  |  |  |  |  |  |  |  |  |  |  |  |
| Candidate 2 |  |  |  |  |  |  |  |  |  |  |  |  |
| Candidate 3 |  |  |  |  |  |  |  |  |  |  |  |  |
| Candidate 4 |  |  |  |  |  |  |  |  |  |  |  |  |

## 5. Decision rubric

Open source now if at least one is true:

- You are best in a narrow but valuable segment (for example: privacy-first browser workflow).
- You are not best on raw WER, but best on integration speed and developer experience.
- You can become the reference implementation for your exact stack and UX pattern.

Delay open source if:

- no clear differentiation yet
- heavy hidden maintenance burden
- compliance/security concerns not resolved
