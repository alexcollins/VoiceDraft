"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { readPrefs, subscribePrefs, DEFAULT_PREFS } from "../core/prefs.js";
import { getServerSnapshot, getSnapshot, subscribe } from "../core/session.js";
import { recognitionConstructor } from "../core/speech.js";

/** The running session, wherever it is on the page. */
export function useDictation() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** The per-browser preferences: language, microphone, hold to record, on-device only. */
export function useDictationPrefs() {
  return useSyncExternalStore(subscribePrefs, readPrefs, () => DEFAULT_PREFS);
}

/* The server cannot know, so this is false until mounted and then true only
   where the browser has a recogniser — no hydration mismatch. */
export function useCanDictate(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => setCan(recognitionConstructor() !== null), []);
  return can;
}
