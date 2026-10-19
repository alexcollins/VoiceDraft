/*
 * The browser's speech recogniser.
 *
 * VoiceDraft uses the Web Speech API the browser ships. Where the browser
 * can run it on the device (Chrome and Edge with a downloaded language pack,
 * `processLocally`) it does; otherwise it is the browser's own engine —
 * Safari's is Apple's speech service, Chrome's without a pack is Google's.
 * Firefox has none.
 */

export interface RecognitionResult {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}

export interface RecognitionResultEvent {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: RecognitionResult };
}

export interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  /** Chrome 139+, Edge: run on the device. Absent elsewhere. */
  processLocally?: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  /** Newer engines take the track to listen to; older ones ignore it and use the default mic. */
  start(audioTrack?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
}

/** What the browser says about running a language on the device. */
export type OnDevice = "available" | "downloadable" | "downloading" | "unavailable";

interface LocalOptions {
  langs: string[];
  processLocally: true;
}

export interface RecognitionConstructor {
  new (): Recognition;
  available?: (options: LocalOptions) => Promise<OnDevice>;
  install?: (options: LocalOptions) => Promise<boolean>;
}

let isAvailable: () => boolean = () => true;

/**
 * Turn the recogniser off where it exists but cannot work — an embedded
 * webview without a speech service, say. Every button then renders nothing.
 */
export function setAvailability(check: () => boolean) {
  isAvailable = check;
}

/** The recogniser, or null where there is none to use. */
export function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined" || !isAvailable()) return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether the browser can say anything about on-device recognition at all. */
export function canAskOnDevice(): boolean {
  return typeof recognitionConstructor()?.available === "function";
}

/* Asked once per language: the answer only changes on a download, which
   clears it. The start path reads the cache so the press that starts
   dictation does not wait on a promise when it can help it. */
const asked = new Map<string, Promise<OnDevice | null>>();
const known = new Map<string, OnDevice | null>();

/** null when the browser has no on-device API to ask. */
export function onDeviceStatus(lang: string): Promise<OnDevice | null> {
  const Recognition = recognitionConstructor();
  if (!Recognition?.available) return Promise.resolve(null);
  let pending = asked.get(lang);
  if (!pending) {
    pending = Recognition.available({ langs: [lang], processLocally: true })
      .catch(() => null)
      .then((status) => {
        known.set(lang, status);
        return status;
      });
    asked.set(lang, pending);
  }
  return pending;
}

/** The cached answer, if the language has been asked about. */
export function knownOnDevice(lang: string): OnDevice | null | undefined {
  if (!canAskOnDevice()) return null;
  return known.has(lang) ? known.get(lang) : undefined;
}

/** Download the language pack. Resolves true once it is installed. */
export async function installOnDevice(lang: string): Promise<boolean> {
  const Recognition = recognitionConstructor();
  if (!Recognition?.install) return false;
  asked.delete(lang);
  known.delete(lang);
  try {
    return await Recognition.install({ langs: [lang], processLocally: true });
  } catch {
    return false;
  } finally {
    asked.delete(lang);
    known.delete(lang);
  }
}

export interface Microphone {
  deviceId: string;
  label: string;
}

/* The browser only names microphones once the page has been allowed one;
   before that the list is anonymous and only the default can be offered. */
export async function listMicrophones(): Promise<Microphone[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(
        (d) =>
          d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications" && d.label,
      )
      .map((d) => ({ deviceId: d.deviceId, label: d.label }));
  } catch {
    return [];
  }
}

/** Languages worth offering: the browser's own first, then common ones. */
export function offeredLangs(): string[] {
  const common = [
    "en-US",
    "en-GB",
    "es-ES",
    "fr-FR",
    "de-DE",
    "it-IT",
    "pt-PT",
    "pt-BR",
    "nl-NL",
    "sv-SE",
    "nb-NO",
    "da-DK",
    "pl-PL",
    "ko-KR",
    "ja-JP",
  ];
  const own = typeof navigator === "undefined" ? [] : [...(navigator.languages ?? [])].filter((l) => l.includes("-"));
  return [...new Set([...own, ...common])];
}

export function langName(tag: string): string {
  try {
    return new Intl.DisplayNames(undefined, { type: "language" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

export function browserLang(): string {
  return (typeof navigator !== "undefined" && navigator.language) || "en-US";
}
