import { browserLang } from "./speech.js";

/*
 * Per-browser preferences, in localStorage, shared by every mic on the page
 * and across tabs. Storage that throws (private mode, blocked) falls back to
 * memory for this tab.
 */

export interface DictationPrefs {
  /** A BCP 47 tag, or null for the browser's own language. */
  lang: string | null;
  /** Refuse the browser's online engine when the device can't do the language. */
  deviceOnly: boolean;
  /** Holding the mic records until it is let go; a click still toggles. */
  holdToRecord: boolean;
  /** A microphone's deviceId, or null for the system default. */
  deviceId: string | null;
}

export const DEFAULT_PREFS: DictationPrefs = { lang: null, deviceOnly: false, holdToRecord: true, deviceId: null };

const EVENT = "voicedraft:prefs";
let storageKey = "voicedraft";
let cachedRaw: string | null | undefined;
let cachedPrefs: DictationPrefs = DEFAULT_PREFS;

/** Use a different localStorage key, e.g. to keep an existing app's saved choices. */
export function setPrefsKey(key: string) {
  storageKey = key;
  cachedRaw = undefined;
}

export function readPrefs(): DictationPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(storageKey);
  } catch {
    return cachedPrefs;
  }
  if (raw === cachedRaw) return cachedPrefs;
  cachedRaw = raw;
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<DictationPrefs>) : {};
    cachedPrefs = {
      lang: typeof parsed.lang === "string" && parsed.lang ? parsed.lang : null,
      deviceOnly: parsed.deviceOnly === true,
      holdToRecord: parsed.holdToRecord !== false,
      deviceId: typeof parsed.deviceId === "string" && parsed.deviceId ? parsed.deviceId : null,
    };
  } catch {
    cachedPrefs = DEFAULT_PREFS;
  }
  return cachedPrefs;
}

export function writePrefs(next: Partial<DictationPrefs>) {
  const merged = { ...readPrefs(), ...next };
  const raw = JSON.stringify(merged);
  try {
    localStorage.setItem(storageKey, raw);
  } catch {
    /* storage blocked: this tab still takes it */
  }
  cachedRaw = raw;
  cachedPrefs = merged;
  window.dispatchEvent(new Event(EVENT));
}

export function subscribePrefs(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey) onChange();
  };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** The language dictation listens for. */
export function dictationLang(prefs: DictationPrefs = readPrefs()): string {
  return prefs.lang ?? browserLang();
}
