export interface VoiceDraftAdapterStartContext {
  locale: string;
}

export interface VoiceDraftAdapterStopResult {
  transcript: string;
}

export interface VoiceDraftAdapter {
  start: (context: VoiceDraftAdapterStartContext) => Promise<void> | void;
  stop: () => Promise<VoiceDraftAdapterStopResult> | VoiceDraftAdapterStopResult;
  cancel?: () => Promise<void> | void;
}
