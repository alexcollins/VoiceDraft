/*
 * A different engine in place of the browser's recogniser — a cloud
 * transcriber for Firefox, say. Pass it as `adapter` to startDictation, the
 * DictateButton or useVoiceDraft. It records between start() and stop(), and
 * its transcript is written into the target when stop() resolves (no live
 * text: an adapter has no interim results). The meter still runs.
 */

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
