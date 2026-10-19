// A browser for the tests: jsdom's window as the globals VoiceDraft reads, and
// a fake SpeechRecognition the test drives by hand.
import { JSDOM } from "jsdom";

export function installDom({ userAgent = "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0" } = {}) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://example.test/",
    pretendToBeVisual: true,
    userAgent,
  });
  const { window } = dom;
  const keys = [
    "window",
    "document",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "HTMLButtonElement",
    "Element",
    "Node",
    "Event",
    "KeyboardEvent",
    "MouseEvent",
    "FocusEvent",
    "StorageEvent",
    "localStorage",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getComputedStyle",
  ];
  for (const key of keys) {
    Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
  }
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true, writable: true });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return window;
}

/** Installs a fake recogniser on window; returns a handle to drive it. */
export function installFakeRecognition(window, { onDevice = "available" } = {}) {
  const handle = { instances: [], onDevice, installs: 0 };
  class FakeRecognition {
    constructor() {
      this.continuous = false;
      this.interimResults = false;
      this.lang = "";
      this.processLocally = false;
      this.running = false;
      this.aborted = false;
      this.track = undefined;
      this.starts = 0;
      handle.instances.push(this);
    }
    start(track) {
      this.running = true;
      this.track = track;
      this.starts += 1;
    }
    stop() {
      this.running = false;
    }
    abort() {
      this.running = false;
      this.aborted = true;
    }
    static available() {
      return Promise.resolve(handle.onDevice);
    }
    static install() {
      handle.installs += 1;
      handle.onDevice = "available";
      return Promise.resolve(true);
    }
  }
  window.SpeechRecognition = FakeRecognition;
  handle.last = () => handle.instances[handle.instances.length - 1];
  /** Deliver results to the running recogniser: finals, then one interim. */
  handle.say = (finals, interim) => {
    const results = finals.map((t) => ({ isFinal: true, 0: { transcript: t } }));
    if (interim) results.push({ isFinal: false, 0: { transcript: interim } });
    handle.last().onresult?.({ resultIndex: 0, results });
  };
  return handle;
}

export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
