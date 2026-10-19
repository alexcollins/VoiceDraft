import type { VoiceDraftAdapter } from "../core/adapters.js";
import type { NoiseGateOptions, SilenceOptions } from "../core/gate.js";

export type VoiceDraftNoiseGateOptions = NoiseGateOptions;
export type VoiceDraftSilenceOptions = SilenceOptions;

export interface UseVoiceDraftOptions {
  /** Defaults to the saved language, then the browser's. */
  locale?: string;
  /** How often the waveform array takes a sample. Default 70. */
  sampleIntervalMs?: number;
  /** Waveform length. Default 400. */
  maxHistory?: number;
  /** @deprecated No effect: the text shown is the text kept, so there is nothing to wait for. */
  finalizeDelayMs?: number;
  noiseGate?: VoiceDraftNoiseGateOptions;
  silence?: VoiceDraftSilenceOptions;
  /** A different engine in place of the browser's (a cloud transcriber). */
  adapter?: VoiceDraftAdapter;
  onAutoStop?: (text: string) => void;
  onError?: (error: Error) => void;
}

export interface VoiceDraftState {
  canTranscribe: boolean;
  listening: boolean;
  waveform: number[];
  elapsed: number;
  draftText: string;
  start: () => void;
  stopAndGetText: () => Promise<string>;
  cancel: () => void;
  clearDraft: () => void;
}

export interface VoiceDraftBarProps {
  listening: boolean;
  canTranscribe: boolean;
  waveform: number[];
  elapsed: number;
  disabled?: boolean;
  className?: string;
  onStart: () => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  labels?: {
    start?: string;
    cancel?: string;
    confirm?: string;
    unsupported?: string;
  };
}
