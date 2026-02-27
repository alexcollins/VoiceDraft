# VoiceDraft

Native-first voice input composer for web apps.

VoiceDraft is an open-source STT UX layer built for real product usage:

- native speech recognition first (browser/device stack)
- recording bar UI with live waveform
- explicit cancel / confirm flow
- capture controls for noise gate and silence behavior

VoiceDraft is focused on **voice input UX**, not on model training/inference.

---

## Why VoiceDraft

Many speech projects are model engines or API wrappers.
VoiceDraft solves the product layer teams actually need:

- reliable compose-time voice input
- predictable interaction (no accidental auto-send)
- lower baseline cost by preferring native STT
- cleaner transcripts in noisy environments via configurable gating

---

## Feature Set

- `useVoiceDraft` React hook
- `VoiceDraftBar` UI component
- native speech recognition support detection
- mic waveform/activity visualization
- elapsed recording timer
- confirm and cancel actions
- configurable noise gate:
  - activation threshold
  - gain / curve shape
  - minimum active bar level
- configurable silence behavior:
  - auto-stop timeout
  - minimum speech duration
  - active-level threshold

---

## Positioning (How It Differs)

VoiceDraft complements engine/model repos. It can sit above them.

- Engine/model repos handle inference.
- VoiceDraft handles user interaction, capture behavior, and app integration.

Compared with lightweight dictation widgets, VoiceDraft is opinionated around:

- compose UX contract (`record -> review -> confirm/cancel`)
- native-first cost profile
- tuning knobs needed in production input bars

---

## Installation

```bash
npm install voicedraft
```

---

## Quick Start

```tsx
import { useState } from "react";
import { VoiceDraftBar, useVoiceDraft } from "voicedraft/react";
import "voicedraft/styles.css";

export function PromptComposer() {
  const [value, setValue] = useState("");

  const voice = useVoiceDraft({
    locale: "en-US",
    noiseGate: {
      activationThreshold: 0.25,
      minActiveLevel: 0.06,
    },
    silence: {
      enabled: true,
      autoStopMs: 1200,
      minSpeechMs: 300,
    },
  });

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={5} />
      <VoiceDraftBar
        listening={voice.listening}
        canTranscribe={voice.canTranscribe}
        waveform={voice.waveform}
        elapsed={voice.elapsed}
        onStart={voice.start}
        onCancel={voice.cancel}
        onConfirm={async () => {
          const text = await voice.stopAndGetText();
          if (text) {
            setValue((previous) => (previous ? `${previous} ${text}` : text));
          }
        }}
      />
    </div>
  );
}
```

---

## API

### `useVoiceDraft(options?)`

Options:

- `locale?: string` (default: `en-US`)
- `sampleIntervalMs?: number` (default: `70`)
- `maxHistory?: number` (default: `400`)
- `finalizeDelayMs?: number` (default: `400`)
- `noiseGate?:`
  - `activationThreshold?: number` (default: `0.25`)
  - `minActiveLevel?: number` (default: `0.06`)
  - `gain?: number` (default: `8`)
  - `curveExponent?: number` (default: `0.6`)
- `silence?:`
  - `enabled?: boolean` (default: `false`)
  - `autoStopMs?: number` (default: `1200`)
  - `minSpeechMs?: number` (default: `300`)
  - `minLevel?: number` (default: `noiseGate.minActiveLevel`)
- `onAutoStop?: (text: string) => void`
- `onError?: (error: Error) => void`

Return value:

- `canTranscribe: boolean`
- `listening: boolean`
- `waveform: number[]`
- `elapsed: number`
- `draftText: string`
- `start(): void`
- `stopAndGetText(): Promise<string>`
- `cancel(): void`
- `clearDraft(): void`

### `VoiceDraftBar`

Props:

- `listening`
- `canTranscribe`
- `waveform`
- `elapsed`
- `onStart`
- `onCancel`
- `onConfirm`
- optional `disabled`, `className`, `labels`

---

## Browser Support

VoiceDraft currently depends on Web Speech support for native STT.

- Works best in browsers/platforms exposing `SpeechRecognition` or `webkitSpeechRecognition`.
- `canTranscribe` is provided so your app can gracefully disable the mic path when unavailable.

---

## Privacy and Cost Notes

- Native-first operation can reduce cloud transcription costs.
- If you add cloud adapters, VoiceDraft still provides the same UX shell.
- Confirm/cancel flow helps prevent accidental transcript submission.

---

## Local Development

```bash
npm install
npm run typecheck
```

## Benchmark Toolkit

This folder also includes a provider benchmark kit for your own audio set:

- `scripts/benchmark-stt.mjs`
- `benchmarks/transcription/*`
- `docs/voice-transcription-competitor-matrix-template.md`

Run:

```bash
npm run benchmark:stt -- --dataset benchmarks/transcription/dataset.example.jsonl --providers benchmarks/transcription/providers.example.json
```

---

## Repository Bootstrap Checklist

When copying this folder into a standalone GitHub repo:

1. Move everything in this folder to the new repo root.
2. Run `npm install`.
3. Run `npm run typecheck`.
4. Update package metadata (`author`, `repository`, etc.) in `package.json`.
5. Publish initial tag.

---

## License

MIT
