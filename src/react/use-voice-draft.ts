"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { cancelDictation, onLevel, releaseDictation, startDictation, stopDictation } from "../core/session.js";
import { memorySink, shapeText } from "../core/sinks.js";
import type { UseVoiceDraftOptions, VoiceDraftState } from "./types.js";
import { useCanDictate, useDictation } from "./use-dictation.js";

/*
 * The record → review → confirm hook from 0.1, on the shared session. The
 * transcript is held as `draftText` (live while listening) for the caller to
 * place; `stopAndGetText` resolves with it. For writing straight into a field
 * at the caret, use DictateButton.
 *
 * `waveform` is React state, sampled every `sampleIntervalMs`, so the host
 * re-renders while listening; DictateButton's meter does not.
 */
export function useVoiceDraft(options: UseVoiceDraftOptions = {}): VoiceDraftState {
  const owner = useId();
  const state = useDictation();
  const can = useCanDictate() || !!options.adapter;
  const [draftText, setDraftText] = useState("");
  const [waveform, setWaveform] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const mine = state.owner === owner;
  const listening = mine && state.status !== "idle";
  const startedAt = mine ? state.startedAt : null;
  const sampleIntervalMs = options.sampleIntervalMs ?? 70;
  const maxHistory = options.maxHistory ?? 400;

  useEffect(() => () => releaseDictation(owner), [owner]);

  useEffect(() => {
    if (state.error?.owner !== owner) return;
    const error = new Error(state.error.message);
    if (optionsRef.current.onError) optionsRef.current.onError(error);
    else console.error("[VoiceDraft]", error);
  }, [state.error, owner]);

  useEffect(() => {
    if (startedAt === null) return;
    const tick = () => setElapsed(Math.floor((performance.now() - startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    if (!listening) return;
    let latest = 0;
    let history: number[] = [];
    const stopLevels = onLevel((level) => {
      latest = level;
    });
    const timer = setInterval(() => {
      history = [...history, latest].slice(-maxHistory);
      setWaveform(history);
    }, sampleIntervalMs);
    return () => {
      stopLevels();
      clearInterval(timer);
    };
  }, [listening, maxHistory, sampleIntervalMs]);

  const start = useCallback(() => {
    const current = optionsRef.current;
    setDraftText("");
    setWaveform([]);
    setElapsed(0);
    void startDictation(owner, memorySink(setDraftText), {
      lang: current.locale,
      adapter: current.adapter,
      noiseGate: current.noiseGate,
      silence: current.silence,
      onAutoStop: (text) => optionsRef.current.onAutoStop?.(shapeText(text, "")),
    });
  }, [owner]);

  const stopAndGetText = useCallback(async () => {
    if (!mine) return draftText;
    return shapeText(await stopDictation(), "");
  }, [draftText, mine]);

  const cancel = useCallback(() => {
    if (mine) cancelDictation();
    setDraftText("");
    setWaveform([]);
    setElapsed(0);
  }, [mine]);

  const clearDraft = useCallback(() => setDraftText(""), []);

  return {
    canTranscribe: can,
    listening,
    waveform,
    elapsed,
    draftText,
    start,
    stopAndGetText,
    cancel,
    clearDraft,
  };
}
