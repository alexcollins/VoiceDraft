"use client";

import { formatElapsed } from "../utils/format.js";
import type { VoiceDraftBarProps } from "./types.js";

/* The 0.1 recording bar: mic when idle; cancel, waveform, timer and confirm
   while listening. Draws the last BARS samples, so a long recording costs no
   more to render than a short one. */
const BARS = 64;

function cx(...values: Array<string | undefined | false>): string {
  return values.filter(Boolean).join(" ");
}

const icon = {
  mic: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  ),
  cancel: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  ),
  confirm: (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
};

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
          {icon.mic}
        </button>
        {!canTranscribe && <span className="vd-hint">{unsupportedLabel}</span>}
      </div>
    );
  }

  const shown = waveform.slice(-BARS);

  return (
    <div className={cx("vd-bar", "vd-bar-listening", className)}>
      <button type="button" className="vd-button vd-button-cancel" onClick={onCancel} disabled={disabled} aria-label={cancelLabel} title={cancelLabel}>
        {icon.cancel}
      </button>
      <div className="vd-waveform" aria-hidden>
        {shown.map((level, index) => (
          <span
            // Bars are a transient visualisation; position is identity.
            key={index}
            className="vd-wave"
            style={{ transform: `scaleY(${Math.max(0.06, level)})`, opacity: level > 0.01 ? 0.85 : 0.25 }}
          />
        ))}
      </div>
      <span className="vd-time">{formatElapsed(elapsed)}</span>
      <button type="button" className="vd-button vd-button-confirm" onClick={onConfirm} disabled={disabled} aria-label={confirmLabel} title={confirmLabel}>
        {icon.confirm}
      </button>
    </div>
  );
}
