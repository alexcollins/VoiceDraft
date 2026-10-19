# VoiceDraft

![VoiceDraft repository header](https://raw.githubusercontent.com/alexcollins/voicedraft/main/images/repo-header.png)

**Voice dictation for web apps.** A Claude-style mic button that writes into any text field as you speak. On-device speech recognition first, no inference engine and no cloud bill required.

```bash
npm install github:alexcollins/voicedraft
```

It builds itself on install (`prepare`). Not on the npm registry.

---

## What it is

- **A mic button for any field.** Textareas, inputs (controlled or not), and ProseMirror / Tiptap editors. The words appear at the caret as they're heard.
- **Claude's gestures.** Click for long-form (click again, press Enter or start typing to keep the words). Press and hold to record until you let go. Escape puts the field back exactly as it was. Right-click for the microphone, the language and "Hold to record".
- **On-device first.** Uses the browser's Web Speech API, and runs it on the device where Chrome and Edge have the language pack (`processLocally`). An optional "on-device only" mode refuses the browser's online engine.
- **A meter that doesn't hurt.** A ring of ticks around the mic follows the voice, drawn inside the button so it takes no room and nothing moves. It writes to the SVG directly, so listening never re-renders your component. Phones get a breathing indicator instead of a second mic stream, because on Android and iOS that second stream is what kills recognition.
- **Bring your own engine.** Pass an `adapter` to use a cloud transcriber (for Firefox, say) without changing the UI.
- **No UI-kit dependency.** One stylesheet themed through `--vd-*` custom properties, light and dark built in. The core has no React dependency at all.

---

## Quick start

```tsx
import { useRef } from "react";
import { DictateButton } from "voicedraft/react";
import "voicedraft/styles.css";

export function Composer() {
  const field = useRef<HTMLTextAreaElement>(null);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "end" }}>
      <textarea ref={field} rows={3} />
      <DictateButton field={field} />
    </div>
  );
}
```

Controlled fields work as they are: dictation writes through the field's `input` event, so your `onChange` runs as if the person typed.

### Tiptap / ProseMirror

```tsx
<DictateButton editorView={() => editor?.view} labels={{ start: "Dictate into the page" }} />
```

### Your own target

A sink is anything with `begin() → { write(text), commit(), cancel() }`. See `fieldSink`, `editorViewSink` and `memorySink` in `voicedraft/core`.

### Start from code (a slash command, a shortcut)

```tsx
const mic = useRef<DictateButtonHandle>(null);
<DictateButton ref={mic} field={field} />;
// later
mic.current?.toggle();
```

---

## Browser support

| Browser | Engine | Mic shown |
| --- | --- | --- |
| Chrome, Edge (desktop) | On the device once the language pack is downloaded; Google's / Microsoft's online engine otherwise | Yes |
| Safari (macOS, iOS) | Apple's speech service | Yes |
| Chrome (Android) | Google's; one utterance per run (Android repeats itself in continuous mode) | Yes |
| Firefox | None | Only with an `adapter` |

Download a language pack from your settings UI:

```ts
import { onDeviceStatus, installOnDevice } from "voicedraft/core";
if ((await onDeviceStatus("en-GB")) === "downloadable") await installOnDevice("en-GB");
```

In an embedded webview where the API exists but has no speech service behind it (WebView2), turn it off with `setAvailability(() => false)` and the buttons render nothing.

---

## API

### `<DictateButton>`

| Prop | Default | |
| --- | --- | --- |
| `field` | — | Ref to a textarea or input. |
| `editorView` | — | `() => view` for ProseMirror (Tiptap: `editor.view`). |
| `sink` | — | Any other target. |
| `options` | — | `StartOptions`, passed to every session (below). |
| `menu` | `true` | The right-click settings. |
| `size` | `"md"` | `"sm"` is 28px, `"md"` 36px. |
| `side` | `"top"` | Where the tooltip and menu open. |
| `labels` | English | Every string, for translation. |
| `disabled`, `className` | | |

It renders nothing on the server and nothing where there is no recogniser, so there's no hydration mismatch and no mic that can't work.

### `StartOptions`

| Option | Default | |
| --- | --- | --- |
| `lang` | saved, then the browser's | BCP 47 tag. |
| `deviceOnly` | saved (`false`) | Refuse the online engine. |
| `deviceId` | saved (system default) | A microphone. Handed to the recogniser as a track where the engine supports `start(track)`; elsewhere only the meter follows it. |
| `adapter` | — | A custom engine (`VoiceDraftAdapter`). |
| `silence` | off | `{ enabled, autoStopMs: 1200, minSpeechMs: 300, minLevel }`. |
| `noiseGate` | | `{ activationThreshold: 0.25, minActiveLevel: 0.06, gain: 8, curveExponent: 0.6 }`. |
| `meter` | `"auto"` | `"auto"` (desktop pointers), `"on"`, `"off"`. |
| `keys` | `true` | Escape cancels; keys in the target take over. |
| `onAutoStop` | — | Silence stopped it; receives the text. |

### Hooks

- `useDictation()`: the running session (`status`, `owner`, `onDevice`, `metered`, `startedAt`, `error`).
- `useDictationPrefs()`: `{ lang, deviceOnly, holdToRecord, deviceId }`, saved per browser. Write them with `writePrefs()`.
- `useCanDictate()`: false until mounted, then whether a recogniser exists.

Errors carry a `code` (`not-allowed`, `audio-capture`, `network`, `language-not-supported`, `pack-missing`, `device-unavailable`, `failed`) and an English `message`.

### `voicedraft/core`, without React

`startDictation(owner, sink, options)`, `stopDictation() → Promise<text>`, `cancelDictation()`, `subscribe` / `getSnapshot`, `onLevel(listener)`, the sinks, the preferences and the on-device helpers. One session runs at a time across the page.

### 0.1 API

`useVoiceDraft` and `VoiceDraftBar` keep their 0.1 shape, now on the shared session. `draftText` is live while listening, and `silence` auto-stop works. `finalizeDelayMs` no longer does anything. `useVoiceDraft`'s `waveform` is React state, so the host re-renders while listening; `DictateButton` avoids that.

---

## Theming

```css
.my-app {
  --vd-accent: #7c5cff;      /* the active button and tooltips */
  --vd-accent-fg: #ffffff;
  --vd-radius: 12px;
}
```

Also `--vd-fg`, `--vd-muted`, `--vd-surface`, `--vd-hover`, `--vd-border`, `--vd-danger`, `--vd-danger-fg`, `--vd-ease`.

---

## Development

```bash
npm install
npm run typecheck
npm test            # builds, then node:test with jsdom, a fake recogniser and real ProseMirror
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
