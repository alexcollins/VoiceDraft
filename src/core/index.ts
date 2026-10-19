export type { VoiceDraftAdapter, VoiceDraftAdapterStartContext, VoiceDraftAdapterStopResult } from "./adapters.js";
export { createGate, rmsOf, type Gate, type GateReading, type NoiseGateOptions, type SilenceOptions } from "./gate.js";
export {
  DEFAULT_PREFS,
  dictationLang,
  readPrefs,
  setPrefsKey,
  subscribePrefs,
  writePrefs,
  type DictationPrefs,
} from "./prefs.js";
export {
  cancelDictation,
  clearError,
  getServerSnapshot,
  getSnapshot,
  onLevel,
  releaseDictation,
  startDictation,
  stopDictation,
  subscribe,
  type DictationError,
  type DictationErrorCode,
  type DictationSnapshot,
  type DictationStatus,
  type StartOptions,
} from "./session.js";
export {
  editorViewSink,
  fieldSink,
  memorySink,
  shapeText,
  type DictationSink,
  type EditorViewLike,
  type SinkSession,
} from "./sinks.js";
export {
  browserLang,
  canAskOnDevice,
  installOnDevice,
  knownOnDevice,
  langName,
  listMicrophones,
  offeredLangs,
  onDeviceStatus,
  recognitionConstructor,
  setAvailability,
  type Microphone,
  type OnDevice,
} from "./speech.js";
