export interface VoiceDraftNoiseGateOptions {
  activationThreshold?: number;
  minActiveLevel?: number;
  gain?: number;
  curveExponent?: number;
}

export interface VoiceDraftSilenceOptions {
  enabled?: boolean;
  autoStopMs?: number;
  minSpeechMs?: number;
  minLevel?: number;
}

export interface UseVoiceDraftOptions {
  locale?: string;
  sampleIntervalMs?: number;
  maxHistory?: number;
  finalizeDelayMs?: number;
  noiseGate?: VoiceDraftNoiseGateOptions;
  silence?: VoiceDraftSilenceOptions;
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
