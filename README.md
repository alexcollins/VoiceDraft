# VoiceDraft

![VoiceDraft repository header](images/repo-header.png)

**Voice input UX for web apps.** Native STT first, no inference engine required.

```bash
npm install voicedraft
```

---

## What it is

VoiceDraft is the product layer that speech projects skip — a React hook + recording bar UI with a real compose flow: **record → review → confirm/cancel**. No accidental auto-send. No cloud dependency by default.

- Native `SpeechRecognition` first (zero cloud cost baseline)
- Live waveform + elapsed timer
- Configurable noise gate and auto-silence detection
- Works above any STT engine — swap in cloud adapters without changing the UX

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
    noiseGate: { activationThreshold: 0.25, minActiveLevel: 0.06 },
    silence: { enabled: true, autoStopMs: 1200, minSpeechMs: 300 },
  });

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={5} />
      <VoiceDraftBar
        listening={voice.listening}
        canTranscribe={voice.canTranscribe}
        waveform={voice.waveform}
        elapsed={voice.elapsed}
        onStart={voice.start}
        onCancel={voice.cancel}
        onConfirm={async () => {
          const text = await voice.stopAndGetText();
          if (text) setValue((prev) => prev ? `${prev} ${text}` : text);
        }}
      />
    </div>
  );
}
```

---

## API

### `useVoiceDraft(options?)`

| Option | Default | Description |
| --- | --- | --- |
| `locale` | `"en-US"` | Recognition locale |
| `sampleIntervalMs` | `70` | Waveform sample rate |
| `maxHistory` | `400` | Waveform history length |
| `finalizeDelayMs` | `400` | Transcript finalization delay |
| `noiseGate.activationThreshold` | `0.25` | Gate open threshold |
| `noiseGate.minActiveLevel` | `0.06` | Minimum bar level |
| `noiseGate.gain` | `8` | Gain applied to signal |
| `noiseGate.curveExponent` | `0.6` | Gate curve shape |
| `silence.enabled` | `false` | Enable auto-stop |
| `silence.autoStopMs` | `1200` | Silence timeout |
| `silence.minSpeechMs` | `300` | Minimum speech before stop |
| `silence.minLevel` | `minActiveLevel` | Silence detection threshold |
| `onAutoStop` | — | Callback on auto-stop with transcript |
| `onError` | — | Error callback |

Returns: `canTranscribe` · `listening` · `waveform` · `elapsed` · `draftText` · `start()` · `stopAndGetText()` · `cancel()` · `clearDraft()`

### `VoiceDraftBar`

Props: `listening` · `canTranscribe` · `waveform` · `elapsed` · `onStart` · `onCancel` · `onConfirm` · `disabled?` · `className?` · `labels?`

---

## Browser Support

Requires `SpeechRecognition` or `webkitSpeechRecognition`. Use `canTranscribe` to gracefully disable the mic path when unavailable.

---

## Development

```bash
npm install
npm run typecheck
```

**Benchmark STT providers** against your own audio set:

```bash
npm run benchmark:stt -- \
  --dataset benchmarks/transcription/dataset.example.jsonl \
  --providers benchmarks/transcription/providers.example.json
```

---

## License

MIT
