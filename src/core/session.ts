import type { VoiceDraftAdapter } from "./adapters.js";
import { createGate, rmsOf, type NoiseGateOptions, type SilenceOptions } from "./gate.js";
import { dictationLang, readPrefs } from "./prefs.js";
import type { DictationSink, SinkSession } from "./sinks.js";
import { knownOnDevice, langName, onDeviceStatus, recognitionConstructor, type OnDevice, type Recognition } from "./speech.js";

/*
 * The session: one at a time, across the page. Starting a second one stops
 * the first and keeps what it wrote. Text is written into the sink as it is
 * heard, the recogniser's live guess included, so what the target shows is
 * what the session ends with.
 *
 *   - stopDictation(), or a key pressed in the target: stop and keep it
 *     (typing takes over, and Enter still submits);
 *   - Escape, anywhere: stop and put the target back as it was;
 *   - the tab hidden, the target blurred (fields), or the owner releasing:
 *     stop and keep.
 *
 * The level meter opens its own microphone stream beside the recogniser's on
 * a desktop pointer only: phones hand the mic to one taker, and a second one
 * is what kills recognition there. With a chosen microphone the stream is
 * opened first and its track handed to the recogniser, so there is only one.
 */

export type DictationStatus = "idle" | "starting" | "listening" | "processing";

export type DictationErrorCode =
  | "not-allowed"
  | "audio-capture"
  | "network"
  | "language-not-supported"
  | "pack-missing"
  | "device-unavailable"
  | "failed";

export interface DictationError {
  owner: string;
  code: DictationErrorCode;
  /** English; translate from `code` if you need to. */
  message: string;
}

export interface DictationSnapshot {
  status: DictationStatus;
  /** Who started the running session (a button's id). */
  owner: string | null;
  /** Recognition is running on the device. */
  onDevice: boolean;
  /** The level meter is live. */
  metered: boolean;
  /** performance.now() when listening began, for a timer. */
  startedAt: number | null;
  error: DictationError | null;
}

export interface StartOptions {
  /** Overrides the saved language. */
  lang?: string;
  /** Overrides the saved "on-device only". */
  deviceOnly?: boolean;
  /** Overrides the saved microphone; null for the system default. */
  deviceId?: string | null;
  /** A different engine — a cloud transcriber, say — in place of the browser's. */
  adapter?: VoiceDraftAdapter;
  noiseGate?: NoiseGateOptions;
  /** Stop on its own after a pause. Off by default. */
  silence?: SilenceOptions;
  /** "auto": desktop pointers only (the default). */
  meter?: "auto" | "on" | "off";
  /** Escape cancels, keys in the target take over. Default true. */
  keys?: boolean;
  /** Silence stopped it; the text it kept. */
  onAutoStop?: (text: string) => void;
}

const IDLE: DictationSnapshot = {
  status: "idle",
  owner: null,
  onDevice: false,
  metered: false,
  startedAt: null,
  error: null,
};

let snapshot = IDLE;
const listeners = new Set<() => void>();
const levelListeners = new Set<(level: number) => void>();

function set(next: Partial<DictationSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export const getSnapshot = () => snapshot;
export const getServerSnapshot = () => IDLE;

/** The meter's level, 0–1, about thirty times a second while it runs. */
export function onLevel(listener: (level: number) => void) {
  levelListeners.add(listener);
  return () => {
    levelListeners.delete(listener);
  };
}

export function clearError(owner: string) {
  if (snapshot.error?.owner === owner) set({ error: null });
}

interface Session {
  owner: string;
  sink: SinkSession;
  rec: Recognition | null;
  adapter: VoiceDraftAdapter | null;
  options: StartOptions;
  /** Final text from recogniser runs that have ended. */
  kept: string;
  /** This run's final and interim text. */
  final: string;
  interim: string;
  restarts: number[];
  /** The chosen microphone's track, handed to every recogniser run. */
  track: MediaStreamTrack | undefined;
  stream: MediaStream | null;
  audio: AudioContext | null;
  frame: number;
  cleanup: () => void;
}

let session: Session | null = null;

const join = (...parts: string[]) =>
  parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(" ");

const textOf = (s: Session) => join(s.kept, s.final, s.interim);

/* Chrome overloads start() with start(track), and an explicit undefined
   picks the track overload and throws a TypeError. Pass a track only when
   a microphone was chosen. */
function listen(rec: Recognition, track: MediaStreamTrack | undefined) {
  if (track) rec.start(track);
  else rec.start();
}

function describe(code: DictationErrorCode, lang: string): string {
  switch (code) {
    case "not-allowed":
      return "Microphone access is blocked. Allow it in the browser’s site settings, then try again.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "The browser’s speech service could not be reached.";
    case "language-not-supported":
      return `Dictation in ${langName(lang)} isn’t available in this browser.`;
    case "pack-missing":
      return `${langName(lang)} isn’t downloaded for on-device dictation yet.`;
    case "device-unavailable":
      return `This browser can’t transcribe ${langName(lang)} on the device.`;
    default:
      return "Dictation stopped unexpectedly.";
  }
}

function codeOf(error: string): DictationErrorCode {
  if (error === "not-allowed" || error === "service-not-allowed") return "not-allowed";
  if (error === "audio-capture" || error === "network" || error === "language-not-supported") return error;
  return "failed";
}

function fail(owner: string, code: DictationErrorCode, lang: string) {
  teardown(true);
  set({ error: { owner, code, message: describe(code, lang) } });
}

function render() {
  const s = session;
  if (!s) return;
  /* The target moved on without us: keep what is there and stop. */
  if (!s.sink.write(textOf(s))) teardown(true);
}

/* Ends the session now. The adapter path's stop goes through finish(). */
function teardown(keep: boolean): string {
  const s = session;
  if (!s) {
    /* Stopped while still starting: nothing to undo. */
    if (snapshot.status === "starting") set({ status: "idle", owner: null, startedAt: null });
    return "";
  }
  session = null;
  const text = textOf(s);
  if (s.rec) {
    s.rec.onresult = null;
    s.rec.onerror = null;
    s.rec.onend = null;
    try {
      s.rec.abort();
    } catch {
      /* not running */
    }
  }
  if (!keep) void s.adapter?.cancel?.();
  cancelAnimationFrame(s.frame);
  s.stream?.getTracks().forEach((track) => track.stop());
  void s.audio?.close().catch(() => {});
  s.cleanup();
  if (keep) s.sink.commit();
  else s.sink.cancel();
  for (const listener of levelListeners) listener(0);
  set({ status: "idle", owner: null, onDevice: false, metered: false, startedAt: null });
  return keep ? text : "";
}

/** Stop and keep what was said. Resolves with the text kept. */
export async function stopDictation(): Promise<string> {
  const s = session;
  /* Already handing over: the first stop delivers the text. */
  if (snapshot.status === "processing") return "";
  if (!s?.adapter || snapshot.status !== "listening") return teardown(true);
  /* A custom engine hands its transcript over at the end. */
  set({ status: "processing" });
  cancelAnimationFrame(s.frame);
  s.stream?.getTracks().forEach((track) => track.stop());
  try {
    const { transcript } = await s.adapter.stop();
    if (session !== s) return "";
    s.kept = transcript;
    s.sink.write(transcript);
    return teardown(true);
  } catch {
    if (session === s) fail(s.owner, "failed", dictationLang());
    return "";
  }
}

/** Stop and put the target back. */
export function cancelDictation() {
  teardown(false);
}

/** Stop and keep, only if this owner's session is the one running (e.g. on unmount). */
export function releaseDictation(owner: string) {
  if (snapshot.owner === owner) void stopDictation();
}

export async function startDictation(owner: string, sink: DictationSink, options: StartOptions = {}) {
  teardown(true);
  const Recognition = options.adapter ? null : recognitionConstructor();
  if (!Recognition && !options.adapter) return;
  set({ error: null });

  const prefs = readPrefs();
  const lang = options.lang ?? dictationLang(prefs);
  const deviceOnly = options.deviceOnly ?? prefs.deviceOnly;
  const deviceId = options.deviceId !== undefined ? options.deviceId : prefs.deviceId;

  let onDevice = false;
  if (Recognition) {
    /* The cached answer keeps start() inside the press; the first ask in a
       page has to wait for it. */
    let local: OnDevice | null | undefined = knownOnDevice(lang);
    if (local === undefined) {
      set({ status: "starting", owner });
      local = await onDeviceStatus(lang);
      if (snapshot.owner !== owner || snapshot.status !== "starting") return;
    }
    onDevice = local === "available";
    if (deviceOnly && !onDevice) {
      const code = local === "downloadable" || local === "downloading" ? "pack-missing" : "device-unavailable";
      set({ status: "idle", owner: null, error: { owner, code, message: describe(code, lang) } });
      return;
    }
  }

  const sinkSession = sink.begin();
  if (!sinkSession) {
    set({ status: "idle", owner: null });
    return;
  }

  let rec: Recognition | null = null;
  if (Recognition) {
    rec = new Recognition();
    /* Android's recogniser repeats itself in continuous mode; there, each
       utterance is its own run and onend starts the next. */
    rec.continuous = !/android/i.test(navigator.userAgent);
    rec.interimResults = true;
    rec.lang = lang;
    if (onDevice) rec.processLocally = true;
  }

  const keys = options.keys !== false;
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      teardown(false);
      return;
    }
    if (event.isComposing || ["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(event.key)) return;
    if (event.target instanceof Node && sinkSession.element?.contains(event.target)) void stopDictation();
  };
  const onHide = () => {
    if (document.visibilityState === "hidden") void stopDictation();
  };
  const onBlur = () => void stopDictation();
  /* Capture, on window: ahead of the target's own handlers, so Escape never
     reaches a dialog and Enter submits the words already in the box. */
  if (keys) window.addEventListener("keydown", onKey, true);
  document.addEventListener("visibilitychange", onHide);
  if (sinkSession.endOnBlur) sinkSession.element?.addEventListener("blur", onBlur);

  const s: Session = {
    owner,
    sink: sinkSession,
    rec,
    adapter: options.adapter ?? null,
    options,
    kept: "",
    final: "",
    interim: "",
    restarts: [],
    track: undefined,
    stream: null,
    audio: null,
    frame: 0,
    cleanup: () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("visibilitychange", onHide);
      sinkSession.element?.removeEventListener("blur", onBlur);
    },
  };
  session = s;

  if (rec) {
    rec.onresult = (event) => {
      if (session !== s) return;
      let final = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) final += ` ${result[0].transcript}`;
        else interim += ` ${result[0].transcript}`;
      }
      s.final = final;
      s.interim = interim;
      render();
    };
    rec.onerror = (event) => {
      if (session !== s) return;
      /* Silence and our own abort end the run; onend starts another. */
      if (event.error === "no-speech" || event.error === "aborted") return;
      fail(owner, codeOf(event.error), lang);
    };
    rec.onend = () => {
      if (session !== s) return;
      /* The recogniser stops on its own after a pause or a minute. Keep
         going, unless it keeps stopping straight away. */
      s.kept = textOf(s);
      s.final = "";
      s.interim = "";
      const now = performance.now();
      s.restarts = [...s.restarts.filter((t) => now - t < 4000), now];
      if (s.restarts.length > 4) return fail(owner, "failed", lang);
      try {
        listen(rec, s.track);
      } catch {
        teardown(true);
      }
    };
  }

  /* A chosen microphone is opened first and its track handed to the
     recogniser, and the meter reads the same stream. Engines that do not
     take a track ignore it and hear the system default. */
  if (deviceId && rec && navigator.mediaDevices?.getUserMedia) {
    set({ status: "starting", owner });
    const stream = await navigator.mediaDevices
      .getUserMedia({ audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true } })
      .catch(() => null);
    if (session !== s) {
      stream?.getTracks().forEach((track) => track.stop());
      return;
    }
    s.stream = stream;
    s.track = stream?.getAudioTracks()[0];
  }

  try {
    if (rec) listen(rec, s.track);
    else await s.adapter!.start({ locale: lang });
  } catch {
    if (session === s) fail(owner, "failed", lang);
    return;
  }
  if (session !== s) return;
  set({ status: "listening", owner, onDevice, metered: false, startedAt: performance.now(), error: null });
  startMeter(s);
}

/* ── The meter ─────────────────────────────────────────────────────────── */

const FRAME_MS = 33;

function startMeter(s: Session) {
  const mode = s.options.meter ?? "auto";
  if (mode === "off") return;
  const fine = window.matchMedia?.("(pointer: fine)").matches;
  const phone = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
  /* A custom engine records on its own; it never shares the recogniser's mic problem. */
  const allowed = mode === "on" || s.adapter || (fine && !phone);
  if (!s.stream && (!allowed || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined")) return;

  const opened = s.stream
    ? Promise.resolve(s.stream)
    : navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  opened
    .then((stream) => {
      if (session !== s) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;
      audio.createMediaStreamSource(stream).connect(analyser);
      s.stream = stream;
      s.audio = audio;

      const gate = createGate(s.options.noiseGate, s.options.silence);
      const samples = new Uint8Array(analyser.fftSize);
      let lastAt = 0;
      const tick = (now: number) => {
        if (session !== s) return;
        if (now - lastAt >= FRAME_MS) {
          lastAt = now;
          analyser.getByteTimeDomainData(samples);
          const reading = gate.push(rmsOf(samples), now);
          for (const listener of levelListeners) listener(reading.level);
          if (reading.shouldStop && snapshot.status === "listening") {
            const onAutoStop = s.options.onAutoStop;
            void stopDictation().then((text) => onAutoStop?.(text));
            return;
          }
        }
        s.frame = requestAnimationFrame(tick);
      };
      s.frame = requestAnimationFrame(tick);
      set({ metered: true });
    })
    .catch(() => {
      /* No meter: dictation carries on without one. */
    });
}
