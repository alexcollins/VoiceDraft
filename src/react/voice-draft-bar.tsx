"use client";

import type { VoiceDraftBarProps } from "./types.js";
import { formatElapsed } from "../utils/format.js";

function cx(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

export function VoiceDraftBar({
  listening,
  canTranscribe,
  waveform,
  elapsed,
  disabled,
  className,
  onStart,
  onCancel,
  onConfirm,
  labels,
}: VoiceDraftBarProps) {
  const startLabel = labels?.start ?? "Voice input";
  const cancelLabel = labels?.cancel ?? "Cancel recording";
  const confirmLabel = labels?.confirm ?? "Confirm recording";
  const unsupportedLabel = labels?.unsupported ?? "Transcription is not available in this browser.";

  if (!listening) {
    return (
      <div className={cx("vd-bar", "vd-bar-idle", className)}>
        <button
          type="button"
          className="vd-button vd-button-start"
          onClick={onStart}
          disabled={disabled || !canTranscribe}
          aria-label={startLabel}
          title={!canTranscribe ? unsupportedLabel : startLabel}
        >
          Mic
        </button>
        {!canTranscribe && <span className="vd-hint">{unsupportedLabel}</span>}
      </div>
    );
  }

  return (
    <div className={cx("vd-bar", "vd-bar-listening", className)}>
      <button
        type="button"
        className="vd-button vd-button-cancel"
        onClick={onCancel}
        disabled={disabled}
        aria-label={cancelLabel}
        title={cancelLabel}
      >
        X
      </button>
      <div className="vd-waveform" aria-hidden>
        {waveform.map((level, index) => (
          <span
            // Using index is acceptable here because bars represent transient visualization.
            key={index}
            className="vd-wave"
            style={{
              height: `${Math.max(2, level * 40)}px`,
              opacity: level > 0.01 ? 0.85 : 0.18,
            }}
          />
        ))}
      </div>
      <span className="vd-time">{formatElapsed(elapsed)}</span>
      <button
        type="button"
        className="vd-button vd-button-confirm"
        onClick={onConfirm}
        disabled={disabled}
        aria-label={confirmLabel}
        title={confirmLabel}
      >
        OK
      </button>
    </div>
  );
}
