"use client";

/*
 * The mic button, with Claude's gestures:
 *
 *   - click: long-form. It listens until the mic is clicked again, Enter is
 *     pressed (which keeps the words and submits), or a key is typed; Escape
 *     puts the target back as it was;
 *   - press and hold: listens while held, stops on release ("Hold to
 *     record", on by default);
 *   - right-click (or the context-menu key): the microphone, the language
 *     and Hold to record.
 *
 * The words appear in the target as they are heard. While it listens the
 * button fills in; with `wave` a rolling waveform runs beside it, without one
 * four bars move inside it. The meter writes transforms on refs: listening
 * never re-renders the host. It renders nothing until mounted, and nothing
 * where there is no recogniser and no adapter.
 *
 * Styled by voicedraft/styles.css, themed through --vd-* custom properties.
 */

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { dictationLang, writePrefs } from "../core/prefs.js";
import {
  clearError,
  onLevel,
  releaseDictation,
  startDictation,
  stopDictation,
  type StartOptions,
} from "../core/session.js";
import { editorViewSink, fieldSink, type DictationSink, type EditorViewLike } from "../core/sinks.js";
import { browserLang, langName, listMicrophones, offeredLangs, onDeviceStatus, type Microphone } from "../core/speech.js";
import { useCanDictate, useDictation, useDictationPrefs } from "./use-dictation.js";

export interface DictateButtonLabels {
  /** Accessible name when idle. Default "Dictate". */
  start?: string;
  stop?: string;
  holdHint?: string;
  menuHint?: string;
  microphone?: string;
  systemDefault?: string;
  language?: string;
  auto?: string;
  holdToRecord?: string;
  listening?: string;
  onDevice?: string;
}

export interface DictateButtonProps {
  /** A textarea or input to write into. */
  field?: RefObject<HTMLInputElement | HTMLTextAreaElement | null>;
  /** A ProseMirror view to write into (Tiptap: `() => editor.view`). */
  editorView?: () => EditorViewLike | null | undefined;
  /** Anywhere else: a sink of your own. */
  sink?: DictationSink;
  /** Passed to every session: adapter, silence, noise gate, lang, meter. */
  options?: StartOptions;
  size?: "sm" | "md";
  /** A rolling waveform beside the button while it listens — for a composer footer. */
  wave?: boolean;
  /** The right-click settings. Default true. */
  menu?: boolean;
  disabled?: boolean;
  className?: string;
  /** Where the tooltip and menu open. Default "top". */
  side?: "top" | "bottom";
  labels?: DictateButtonLabels;
}

export interface DictateButtonHandle {
  /** Start, or stop and keep — what a click does. For a slash command or a shortcut. */
  toggle: () => void;
}

const BARS = [
  { lag: 3, weight: 0.6 },
  { lag: 0, weight: 1 },
  { lag: 1, weight: 0.85 },
  { lag: 5, weight: 0.5 },
];
/* At rest the bars still read as a waveform, not as four dots. */
const rest = (weight: number) => 0.3 + 0.35 * weight;
const WAVE_BARS = 28;
/* Held at least this long, a press is a hold: letting go stops. */
const HOLD_MS = 350;
const TIP_DELAY_MS = 300;
const ERROR_FOR_MS = 7000;

const DEFAULT_LABELS: Required<DictateButtonLabels> = {
  start: "Dictate",
  stop: "Stop dictation",
  holdHint: "Press and hold to record",
  menuHint: "Right-click for microphone settings",
  microphone: "Microphone",
  systemDefault: "System default",
  language: "Language",
  auto: "Auto",
  holdToRecord: "Hold to record",
  listening: "Listening",
  onDevice: "on this device",
};

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </svg>
  );
}

export const DictateButton = forwardRef<DictateButtonHandle, DictateButtonProps>(function DictateButton(
  { field, editorView, sink, options, size = "md", wave = false, menu = true, disabled, className, side = "top", labels },
  ref,
) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const owner = useId();
  const tipId = useId();
  const can = useCanDictate() || !!options?.adapter;
  const state = useDictation();
  const prefs = useDictationPrefs();
  const [tip, setTip] = useState(false);
  const [pressing, setPressing] = useState(false);
  const [touch, setTouch] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const waveBars = useRef<(HTMLSpanElement | null)[]>([]);
  const press = useRef<{ at: number; started: boolean } | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mine = state.owner === owner;
  const active = mine && state.status !== "idle";
  const listening = mine && state.status === "listening";
  const metered = listening && state.metered;
  const error = state.error?.owner === owner ? state.error.message : null;
  const lang = options?.lang ?? dictationLang(prefs);

  useEffect(() => setTouch(window.matchMedia?.("(pointer: coarse)").matches ?? false), []);

  /* Ask about on-device ahead of the press, so the press can start the
     recogniser without waiting on the answer. */
  useEffect(() => {
    if (can && !options?.adapter) void onDeviceStatus(lang);
  }, [can, lang, options?.adapter]);

  /* Unmounting keeps what was said. */
  useEffect(() => () => releaseDictation(owner), [owner]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => clearError(owner), ERROR_FOR_MS);
    return () => clearTimeout(timer);
  }, [error, owner]);

  useEffect(() => {
    if (!metered) return;
    const history: number[] = [];
    return onLevel((level) => {
      history.unshift(level);
      history.length = Math.min(history.length, WAVE_BARS);
      BARS.forEach((bar, i) => {
        const el = bars.current[i];
        if (el) el.style.transform = `scaleY(${rest(bar.weight) + (1 - rest(bar.weight)) * (history[bar.lag] ?? 0) * bar.weight})`;
      });
      for (let i = 0; i < WAVE_BARS; i += 1) {
        const el = waveBars.current[WAVE_BARS - 1 - i];
        if (el) el.style.transform = `scaleY(${0.15 + 0.85 * (history[i] ?? 0)})`;
      }
    });
  }, [metered]);

  useEffect(() => () => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
  }, []);

  const targetSink = (): DictationSink | null =>
    sink ?? (field ? fieldSink(() => field.current) : editorView ? editorViewSink(editorView) : null);

  const begin = () => {
    clearError(owner);
    const target = targetSink();
    if (target) void startDictation(owner, target, options);
  };

  const toggle = () => {
    if (active) return void stopDictation();
    if (!can || disabled) return;
    begin();
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useImperativeHandle(ref, () => ({ toggle: () => toggleRef.current() }), []);

  if (!can) return null;

  const showTip = (on: boolean) => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    tipTimer.current = null;
    if (!on) return setTip(false);
    tipTimer.current = setTimeout(() => setTip(true), TIP_DELAY_MS);
  };

  /* Pointer presses decide click against hold; the click event is left to
     the keyboard (Enter, Space), where there is no hold. */
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || (event.ctrlKey && !touch)) return;
    /* Letting go off the button still ends a hold. */
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPressing(true);
    showTip(false);
    if (active) {
      press.current = { at: event.timeStamp, started: false };
      void stopDictation();
      return;
    }
    if (disabled) return;
    press.current = { at: event.timeStamp, started: true };
    begin();
  };
  const onPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const down = press.current;
    press.current = null;
    setPressing(false);
    if (!down?.started || !prefs.holdToRecord) return;
    if (event.timeStamp - down.at >= HOLD_MS) void stopDictation();
  };

  const tipContent: ReactNode = error ? (
    error
  ) : active ? (
    state.onDevice ? `${text.stop} · ${text.onDevice}` : text.stop
  ) : (
    <>
      <span className="vd-tip-line">{prefs.holdToRecord ? text.holdHint : text.start}</span>
      <span className="vd-tip-line vd-tip-sub">{touch || !menu ? langName(lang) : text.menuHint}</span>
    </>
  );
  const tipVisible = (tip || !!error) && !pressing && !menuOpen;

  return (
    <span className={["vd-dictate", className].filter(Boolean).join(" ")} data-size={size} data-side={side}>
      {wave && listening && (
        <span aria-hidden className="vd-dictate-wave" data-idle={!metered || undefined}>
          {Array.from({ length: WAVE_BARS }, (_, i) => (
            <span
              key={i}
              ref={(el) => {
                waveBars.current[i] = el;
              }}
              className="vd-dictate-wave-bar"
            />
          ))}
        </span>
      )}
      <button
        ref={button}
        type="button"
        className="vd-dictate-button"
        data-active={active || undefined}
        disabled={disabled && !active}
        aria-label={active ? text.stop : text.start}
        aria-pressed={active}
        aria-describedby={tipVisible ? tipId : undefined}
        /* Keep the caret in the field: the words go where it is. */
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerEnter={() => showTip(true)}
        onPointerLeave={() => showTip(false)}
        onFocus={() => showTip(true)}
        onBlur={() => showTip(false)}
        onClick={(event) => {
          if (event.detail === 0) toggle();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          /* On a touch screen a long press is the hold. */
          if (menu && !touch) setMenuOpen(true);
        }}
      >
        {active && !wave ? (
          <span aria-hidden className="vd-dictate-bars" data-idle={!metered || undefined}>
            {BARS.map((bar, i) => (
              <span
                key={i}
                ref={(el) => {
                  bars.current[i] = el;
                }}
                className="vd-dictate-bar"
                style={{ transform: `scaleY(${rest(bar.weight)})` }}
              />
            ))}
          </span>
        ) : (
          <MicIcon />
        )}
      </button>
      {tipVisible && (
        <span role="tooltip" id={tipId} className="vd-tip" data-error={!!error || undefined}>
          {tipContent}
        </span>
      )}
      {menuOpen && <SettingsMenu text={text} onClose={() => setMenuOpen(false)} returnFocus={button} />}
      <span role="status" className="vd-sr-only">
        {error ?? (listening ? text.listening : "")}
      </span>
    </span>
  );
});

/* The right-click settings, from native controls: radios for the
   microphone, a select for the language, a switch for Hold to record.
   Escape or a press outside closes it, and focus goes back to the mic. */
function SettingsMenu({
  text,
  onClose,
  returnFocus,
}: {
  text: Required<DictateButtonLabels>;
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const prefs = useDictationPrefs();
  const panel = useRef<HTMLDivElement>(null);
  const [mics, setMics] = useState<Microphone[]>([]);
  const [langs] = useState(offeredLangs);
  const [flip, setFlip] = useState<{ y: boolean; x: boolean }>({ y: false, x: false });
  const name = useId();

  useEffect(() => {
    void listMicrophones().then(setMics);
  }, []);

  /* Open toward the side with room. */
  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setFlip({ y: rect.top < 8 || rect.bottom > window.innerHeight - 8, x: rect.left < 8 });
    el.querySelector<HTMLElement>("input, select")?.focus();
  }, []);

  useEffect(() => {
    const close = () => {
      onClose();
      returnFocus.current?.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    const onDown = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose, returnFocus]);

  const options = prefs.lang && !langs.includes(prefs.lang) ? [prefs.lang, ...langs] : langs;
  const chosenMic = prefs.deviceId && mics.some((m) => m.deviceId === prefs.deviceId) ? prefs.deviceId : "";

  return (
    <div ref={panel} role="dialog" aria-label={text.microphone} className="vd-menu" data-flip-y={flip.y || undefined} data-flip-x={flip.x || undefined}>
      <fieldset className="vd-menu-group">
        <legend className="vd-menu-label">{text.microphone}</legend>
        <label className="vd-menu-option">
          <input type="radio" name={name} checked={chosenMic === ""} onChange={() => writePrefs({ deviceId: null })} />
          <span>{text.systemDefault}</span>
        </label>
        {mics.map((mic) => (
          <label key={mic.deviceId} className="vd-menu-option">
            <input type="radio" name={name} checked={chosenMic === mic.deviceId} onChange={() => writePrefs({ deviceId: mic.deviceId })} />
            <span className="vd-menu-truncate">{mic.label}</span>
          </label>
        ))}
      </fieldset>
      <hr className="vd-menu-separator" />
      <label className="vd-menu-row">
        <span>{text.language}</span>
        <select value={prefs.lang ?? ""} onChange={(event) => writePrefs({ lang: event.target.value || null })}>
          <option value="">
            {text.auto} · {langName(browserLang())}
          </option>
          {options.map((tag) => (
            <option key={tag} value={tag}>
              {langName(tag)}
            </option>
          ))}
        </select>
      </label>
      <hr className="vd-menu-separator" />
      <label className="vd-menu-row">
        <span>{text.holdToRecord}</span>
        <input
          type="checkbox"
          role="switch"
          className="vd-switch"
          checked={prefs.holdToRecord}
          onChange={(event) => writePrefs({ holdToRecord: event.target.checked })}
        />
      </label>
    </div>
  );
}
