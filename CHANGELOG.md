# Changelog

## 0.2.0

A rebuild around a shared dictation session, from the version running in SPCTRL OS.

### Added

- `DictateButton`: a mic for any textarea, input or ProseMirror/Tiptap editor. Words are written at the caret as they're heard. Click for long-form, press and hold to record until release, Escape to discard, typing or Enter to keep. Right-click settings for the microphone, the language and Hold to record. Optional rolling waveform. Themed with `--vd-*` custom properties, light and dark.
- `voicedraft/core`, with no React dependency: `startDictation` / `stopDictation` / `cancelDictation`, one session at a time, sinks (`fieldSink`, `editorViewSink`, `memorySink`), per-browser preferences, on-device helpers (`onDeviceStatus`, `installOnDevice`), `listMicrophones`, `setAvailability`.
- On-device recognition (`processLocally`) wherever the browser has the language pack, and an "on-device only" mode.
- Microphone choice: the chosen device's track is handed to `recognition.start(track)` where the engine supports it.
- Error codes alongside English messages.
- Tests: 39 cases with jsdom, a fake recogniser and real ProseMirror (0.1 had one, for the timer format).
- npm release workflow with provenance.

### Fixed

- **Silence auto-stop never fired.** The animation loop kept the `listening` value from before recording started, so the check always returned early.
- **The host re-rendered about 14 times a second while listening**, copying the waveform array each time. The button's meter now writes transforms on refs. `useVoiceDraft`'s `waveform` is still state for compatibility, and `VoiceDraftBar` draws only the last 64 samples.
- **A second microphone stream on phones** broke recognition on Android and iOS. The meter now runs on desktop pointers only (or `meter: "on"`), and reuses the chosen microphone's stream.
- **`VoiceDraftAdapter` was exported but never used.** It now replaces the recogniser when passed as `adapter`.
- **Hydration mismatch in SSR frameworks:** support was read during the first render.
- **Android continuous mode repeated words;** each utterance is now its own run there.
- **Network and permission errors** were swallowed or surfaced raw.
- **The bar's "Mic" / "X" / "OK" text buttons** are now icons, and the colours are theme variables.
- **The README's install command** pointed at a package that wasn't published.

### Changed

- `locale` defaults to the saved language, then the browser's, instead of `en-US`.
- `finalizeDelayMs` is deprecated and has no effect: the text shown is the text kept.
- CI runs on Node 22.
