import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { installDom, installFakeRecognition, tick } from "./helpers/dom.mjs";

const window = installDom();
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { renderToString } = await import("react-dom/server");
const { DictateButton, useVoiceDraft } = await import("../dist/react/index.js");
const session = await import("../dist/core/session.js");
const h = React.createElement;

let root;
let container;
afterEach(async () => {
  session.cancelDictation();
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  delete window.SpeechRecognition;
});

async function mount(element) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(element));
  await act(async () => tick());
}

function Field(props) {
  const ref = React.useRef(null);
  return h("div", null, h("textarea", { ref, defaultValue: "" }), h(DictateButton, { field: ref, ...props }));
}

const button = () => container.querySelector(".vd-dictate-button");
const area = () => container.querySelector("textarea");
const pointer = (type, init = {}) =>
  act(async () => {
    button().dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }));
  });

test("renders nothing on the server and where there is no recogniser", async () => {
  installFakeRecognition(window);
  assert.equal(renderToString(h(Field)).includes("vd-dictate-button"), false, "no hydration mismatch");
  delete window.SpeechRecognition;
  await mount(h(Field));
  assert.equal(button(), null);
});

test("a click is long-form: listening survives the release, the next press stops", async () => {
  const speech = installFakeRecognition(window);
  await mount(h(Field));
  await pointer("pointerdown");
  await pointer("pointerup");
  assert.equal(session.getSnapshot().status, "listening");
  assert.equal(button().getAttribute("aria-pressed"), "true");
  await act(async () => speech.say(["typed by voice"]));
  assert.equal(area().value, "Typed by voice");
  await pointer("pointerdown");
  await pointer("pointerup");
  assert.equal(session.getSnapshot().status, "idle");
  assert.equal(area().value, "Typed by voice");
});

test("press and hold stops on release", async () => {
  const speech = installFakeRecognition(window);
  await mount(h(Field));
  await pointer("pointerdown");
  await act(async () => speech.say(["held"]));
  await act(async () => tick(400));
  await pointer("pointerup");
  assert.equal(session.getSnapshot().status, "idle");
  assert.equal(area().value, "Held");
});

test("with Hold to record off, a long press stays on", async () => {
  installFakeRecognition(window);
  localStorage.setItem("voicedraft", JSON.stringify({ holdToRecord: false }));
  await mount(h(Field));
  await pointer("pointerdown");
  await act(async () => tick(400));
  await pointer("pointerup");
  assert.equal(session.getSnapshot().status, "listening");
});

test("the keyboard toggles through click", async () => {
  installFakeRecognition(window);
  await mount(h(Field));
  await act(async () => button().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
  assert.equal(session.getSnapshot().status, "listening");
  await act(async () => button().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })));
  assert.equal(session.getSnapshot().status, "idle");
});

test("right-click opens the settings without starting, and they save", async () => {
  installFakeRecognition(window);
  await mount(h(Field));
  await act(async () => button().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 })));
  const dialog = container.querySelector('[role="dialog"]');
  assert.ok(dialog, "menu open");
  assert.match(dialog.textContent, /Microphone/);
  assert.match(dialog.textContent, /Language/);
  assert.match(dialog.textContent, /Hold to record/);
  assert.equal(session.getSnapshot().status, "idle");
  const hold = dialog.querySelector('input[role="switch"]');
  assert.equal(hold.checked, true);
  await act(async () => hold.click());
  assert.equal(JSON.parse(localStorage.getItem("voicedraft")).holdToRecord, false);
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  assert.equal(container.querySelector('[role="dialog"]'), null);
});

test("useVoiceDraft keeps its 0.1 shape on the new session", async () => {
  const speech = installFakeRecognition(window);
  let voice;
  function Legacy() {
    voice = useVoiceDraft({ locale: "en-US" });
    return null;
  }
  await mount(h(Legacy));
  assert.equal(voice.canTranscribe, true);
  await act(async () => voice.start());
  await act(async () => tick());
  assert.equal(voice.listening, true);
  await act(async () => speech.say(["draft words"]));
  assert.equal(voice.draftText, "Draft words");
  let text;
  await act(async () => {
    text = await voice.stopAndGetText();
  });
  assert.equal(text, "Draft words");
  assert.equal(voice.listening, false);
});
