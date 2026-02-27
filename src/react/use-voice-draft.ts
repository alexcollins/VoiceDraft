"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UseVoiceDraftOptions, VoiceDraftState } from "./types.js";

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
}

interface SpeechRecognitionResultListLike {
  [index: number]: SpeechRecognitionResultLike;
  length: number;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
  message?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    SpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const DEFAULT_MAX_HISTORY = 400;
const DEFAULT_SAMPLE_INTERVAL_MS = 70;
const DEFAULT_FINALIZE_DELAY_MS = 400;

const NON_BLOCKING_ERRORS = new Set(["aborted", "no-speech", "network"]);

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function getInitialCanTranscribe(): boolean {
  return Boolean(getRecognitionConstructor());
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

export function useVoiceDraft(options: UseVoiceDraftOptions = {}): VoiceDraftState {
  const locale = options.locale ?? "en-US";
  const sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
  const maxHistory = options.maxHistory ?? DEFAULT_MAX_HISTORY;
  const finalizeDelayMs = options.finalizeDelayMs ?? DEFAULT_FINALIZE_DELAY_MS;

  const noiseGate = useMemo(
    () => ({
      activationThreshold: options.noiseGate?.activationThreshold ?? 0.25,
      minActiveLevel: options.noiseGate?.minActiveLevel ?? 0.06,
      gain: options.noiseGate?.gain ?? 8,
      curveExponent: options.noiseGate?.curveExponent ?? 0.6,
    }),
    [
      options.noiseGate?.activationThreshold,
      options.noiseGate?.curveExponent,
      options.noiseGate?.gain,
      options.noiseGate?.minActiveLevel,
    ],
  );

  const silence = useMemo(
    () => ({
      enabled: options.silence?.enabled ?? false,
      autoStopMs: options.silence?.autoStopMs ?? 1200,
      minSpeechMs: options.silence?.minSpeechMs ?? 300,
      minLevel: options.silence?.minLevel ?? noiseGate.minActiveLevel,
    }),
    [
      noiseGate.minActiveLevel,
      options.silence?.autoStopMs,
      options.silence?.enabled,
      options.silence?.minLevel,
      options.silence?.minSpeechMs,
    ],
  );

  const [canTranscribe] = useState(getInitialCanTranscribe);
  const [listening, setListening] = useState(false);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [draftText, setDraftText] = useState("");

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const lastSampleRef = useRef<number>(0);
  const waveformRef = useRef<number[]>([]);
  const finalTextRef = useRef("");
  const interimTextRef = useRef("");
  const stoppingRef = useRef(false);
  const activatedRef = useRef(false);
  const firstSpeechMsRef = useRef<number | null>(null);
  const lastActiveMsRef = useRef(0);
  const autoStoppingRef = useRef(false);

  const notifyError = useCallback(
    (error: unknown) => {
      const normalized = normalizeError(error);
      options.onError?.(normalized);
      if (!options.onError) {
        console.error("[VoiceDraft]", normalized);
      }
    },
    [options],
  );

  const updateDraftText = useCallback(() => {
    const next = `${finalTextRef.current}${interimTextRef.current ? ` ${interimTextRef.current}` : ""}`.trim();
    setDraftText(next);
  }, []);

  const stopAudio = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    try {
      audioCtxRef.current?.close();
    } catch {
      // ignore cleanup errors
    }

    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  const resetSession = useCallback(
    (clearText: boolean) => {
      stoppingRef.current = false;
      autoStoppingRef.current = false;
      activatedRef.current = false;
      firstSpeechMsRef.current = null;
      lastActiveMsRef.current = 0;
      waveformRef.current = [];
      setWaveform([]);
      setElapsed(0);

      if (clearText) {
        finalTextRef.current = "";
        interimTextRef.current = "";
        setDraftText("");
      }
    },
    [],
  );

  const finalizeTranscript = useCallback(async (): Promise<string> => {
    if (!listening || stoppingRef.current) {
      return draftText;
    }

    stoppingRef.current = true;

    try {
      recRef.current?.stop();
    } catch {
      // Ignore if recognition is not running.
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), finalizeDelayMs);
    });

    const text = `${finalTextRef.current}${interimTextRef.current ? ` ${interimTextRef.current}` : ""}`.trim();

    try {
      recRef.current?.abort();
    } catch {
      // ignore
    }
    recRef.current = null;

    setListening(false);
    stopAudio();
    resetSession(false);
    setDraftText(text);

    return text;
  }, [draftText, finalizeDelayMs, listening, resetSession, stopAudio]);

  const maybeAutoStop = useCallback(() => {
    if (!silence.enabled || !activatedRef.current || autoStoppingRef.current || !listening) {
      return;
    }

    const firstSpeechMs = firstSpeechMsRef.current;
    if (firstSpeechMs === null) {
      return;
    }

    const nowMs = performance.now() - startTimeRef.current;
    const timeSinceLastActive = nowMs - lastActiveMsRef.current;
    const speechDuration = nowMs - firstSpeechMs;

    if (speechDuration < silence.minSpeechMs) {
      return;
    }

    if (timeSinceLastActive < silence.autoStopMs) {
      return;
    }

    autoStoppingRef.current = true;
    void finalizeTranscript()
      .then((text) => {
        options.onAutoStop?.(text);
      })
      .catch((error) => notifyError(error))
      .finally(() => {
        autoStoppingRef.current = false;
      });
  }, [finalizeTranscript, listening, notifyError, options, silence]);

  const startAudioVisualization = useCallback(
    (stream: MediaStream) => {
      streamRef.current = stream;
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();

      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.3;

      source.connect(analyser);

      audioCtxRef.current = audioContext;
      analyserRef.current = analyser;

      const timeDomainData = new Uint8Array(analyser.fftSize);
      startTimeRef.current = performance.now();
      lastSampleRef.current = 0;
      waveformRef.current = [];

      const tick = (now: number) => {
        if (!analyserRef.current) {
          return;
        }

        const elapsedMs = now - startTimeRef.current;
        setElapsed(Math.floor(elapsedMs / 1000));

        if (now - lastSampleRef.current >= sampleIntervalMs) {
          lastSampleRef.current = now;

          analyserRef.current.getByteTimeDomainData(timeDomainData);

          let sum = 0;
          for (let index = 0; index < timeDomainData.length; index += 1) {
            const value = (timeDomainData[index] - 128) / 128;
            sum += value * value;
          }

          const rms = Math.sqrt(sum / timeDomainData.length);
          let level = Math.min(1, Math.pow(rms * noiseGate.gain, noiseGate.curveExponent));

          if (!activatedRef.current && level > noiseGate.activationThreshold) {
            activatedRef.current = true;
            firstSpeechMsRef.current = elapsedMs;
          }

          if (!activatedRef.current) {
            level = 0;
          } else {
            level = Math.max(noiseGate.minActiveLevel, level);
            if (level > silence.minLevel) {
              lastActiveMsRef.current = elapsedMs;
            }
          }

          waveformRef.current.push(level);
          if (waveformRef.current.length > maxHistory) {
            waveformRef.current = waveformRef.current.slice(-maxHistory);
          }
          setWaveform([...waveformRef.current]);
        }

        maybeAutoStop();
        rafRef.current = requestAnimationFrame(tick);
      };

      rafRef.current = requestAnimationFrame(tick);
    },
    [maxHistory, maybeAutoStop, noiseGate, sampleIntervalMs, silence.minLevel],
  );

  const startRecognition = useCallback(() => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      return;
    }

    const rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = locale;

    rec.onend = () => {
      if (stoppingRef.current) {
        return;
      }
      try {
        rec.start();
      } catch (error) {
        notifyError(error);
      }
    };

    rec.onerror = (event) => {
      const code = event.error ?? event.message ?? "";
      if (NON_BLOCKING_ERRORS.has(code)) {
        return;
      }
      notifyError(new Error(`SpeechRecognition error: ${code || "unknown error"}`));
    };

    rec.onresult = (event) => {
      let interimText = "";
      let finalText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const chunk = event.results[index][0].transcript;
        if (event.results[index].isFinal) {
          finalText += chunk;
        } else {
          interimText += chunk;
        }
      }

      if (interimText) {
        interimTextRef.current = interimText;
      }

      if (finalText) {
        const trimmed = finalText.trim();
        finalTextRef.current = finalTextRef.current ? `${finalTextRef.current} ${trimmed}` : trimmed;
        interimTextRef.current = "";
      }

      updateDraftText();
    };

    recRef.current = rec;
    rec.start();
  }, [locale, notifyError, updateDraftText]);

  const start = useCallback(() => {
    if (!canTranscribe) {
      notifyError(new Error("Speech recognition is not available in this browser."));
      return;
    }

    stoppingRef.current = true;
    try {
      recRef.current?.abort();
    } catch {
      // ignore
    }
    stopAudio();

    resetSession(true);
    setListening(true);

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (stoppingRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        startAudioVisualization(stream);
        startRecognition();
      })
      .catch((error) => {
        setListening(false);
        notifyError(error);
      });
  }, [canTranscribe, notifyError, resetSession, startAudioVisualization, startRecognition, stopAudio]);

  const stopAndGetText = useCallback(async () => finalizeTranscript(), [finalizeTranscript]);

  const cancel = useCallback(() => {
    stoppingRef.current = true;

    try {
      recRef.current?.abort();
    } catch {
      // ignore
    }

    recRef.current = null;
    setListening(false);
    stopAudio();
    resetSession(true);
  }, [resetSession, stopAudio]);

  const clearDraft = useCallback(() => {
    finalTextRef.current = "";
    interimTextRef.current = "";
    setDraftText("");
  }, []);

  useEffect(() => {
    return () => {
      stoppingRef.current = true;
      try {
        recRef.current?.abort();
      } catch {
        // ignore
      }
      stopAudio();
    };
  }, [stopAudio]);

  return {
    canTranscribe,
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
