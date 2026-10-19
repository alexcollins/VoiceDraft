import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { installDom, installFakeRecognition, tick } from "./helpers/dom.mjs";

const window = installDom();
const speech = installFakeRecognition(window);
const session = await import("../dist/core/session.js");
const { fieldSink } = await import("../dist/core/sinks.js");
const prefs = await import("../dist/core/prefs.js");

afterEach(() => {
  session.cancelDictation();
  localStorage.clear();
  speech.onDevice = "available";
  document.body.innerHTML = "";
});

function textarea(value = "") {
  const el = document.createElement("textarea");
  document.body.append(el);
  el.value = value;
  el.setSelectionRange(value.length, value.length);
  return el;
}

const key = (target, key) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

test("starts on the device when the language pack is there, and writes live", async () => {
  const el = textarea();
  await session.startDictation("a", fieldSink(() => el), { lang: "en-GB" });
  const rec = speech.last();
  assert.equal(session.getSnapshot().status, "listening");
  assert.equal(session.getSnapshot().onDevice, true);
  assert.equal(rec.processLocally, true);
  assert.equal(rec.lang, "en-GB");
  assert.equal(rec.continuous, true);
  speech.say([], "hello there");
  assert.equal(el.value, "Hello there", "the live guess shows straight away");
  speech.say(["hello there."], "how are");
  assert.equal(el.value, "Hello there. how are");
});

test("without a pack it uses the browser's engine, unless on-device only", async () => {
  speech.onDevice = "downloadable";
  const el = textarea();
  await session.startDictation("b", fieldSink(() => el), { lang: "fr-FR" });
  assert.equal(speech.last().processLocally, false);
  session.cancelDictation();

  await session.startDictation("b", fieldSink(() => el), { lang: "fr-FR", deviceOnly: true });
  const snap = session.getSnapshot();
  assert.equal(snap.status, "idle");
  assert.equal(snap.error?.code, "pack-missing");
  assert.equal(snap.error?.owner, "b");
});

test("Escape puts the field back; a key in the field keeps the words", async () => {
  const el = textarea("Note:");
  await session.startDictation("c", fieldSink(() => el), { lang: "en-US" });
  speech.say(["buy milk"]);
  assert.equal(el.value, "Note: buy milk");
  key(document.body, "Escape");
  assert.equal(el.value, "Note:");
  assert.equal(session.getSnapshot().status, "idle");

  await session.startDictation("c", fieldSink(() => el), { lang: "en-US" });
  speech.say(["buy milk"]);
  key(el, "Enter");
  assert.equal(el.value, "Note: buy milk");
  assert.equal(session.getSnapshot().status, "idle");
  assert.equal(speech.last().aborted, true);
});

test("the recogniser stopping on its own restarts and keeps what it had", async () => {
  const el = textarea();
  await session.startDictation("d", fieldSink(() => el), { lang: "en-US" });
  const rec = speech.last();
  speech.say(["first part"]);
  rec.onend();
  assert.equal(rec.starts, 2);
  speech.say(["second part"]);
  assert.equal(el.value, "First part second part");
});

test("a recogniser that keeps dying gives up with an error", async () => {
  const el = textarea();
  await session.startDictation("e", fieldSink(() => el), { lang: "en-US" });
  const rec = speech.last();
  for (let i = 0; i < 5; i += 1) rec.onend?.();
  assert.equal(session.getSnapshot().status, "idle");
  assert.equal(session.getSnapshot().error?.code, "failed");
});

test("errors carry a code to translate from", async () => {
  const el = textarea();
  await session.startDictation("f", fieldSink(() => el), { lang: "en-US" });
  speech.last().onerror({ error: "not-allowed" });
  assert.equal(session.getSnapshot().error?.code, "not-allowed");
  assert.match(session.getSnapshot().error?.message, /Microphone access is blocked/);
});

test("silence and our own abort are not errors", async () => {
  const el = textarea();
  await session.startDictation("g", fieldSink(() => el), { lang: "en-US" });
  speech.last().onerror({ error: "no-speech" });
  assert.equal(session.getSnapshot().status, "listening");
  assert.equal(session.getSnapshot().error, null);
});

test("one session at a time: a second start keeps the first one's words", async () => {
  const one = textarea();
  const two = textarea();
  await session.startDictation("h1", fieldSink(() => one), { lang: "en-US" });
  speech.say(["for the first"]);
  await session.startDictation("h2", fieldSink(() => two), { lang: "en-US" });
  assert.equal(one.value, "For the first");
  assert.equal(session.getSnapshot().owner, "h2");
});

test("stopDictation resolves with the text kept", async () => {
  const el = textarea();
  await session.startDictation("i", fieldSink(() => el), { lang: "en-US" });
  speech.say(["all of it"]);
  assert.equal(await session.stopDictation(), "all of it");
});

test("on Android each utterance is its own run", async () => {
  Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile", configurable: true });
  const el = textarea();
  await session.startDictation("j", fieldSink(() => el), { lang: "en-US" });
  assert.equal(speech.last().continuous, false);
  Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0", configurable: true });
});

test("a chosen microphone is opened once and its track handed to the recogniser", async () => {
  const track = { kind: "audio", stop() {} };
  const calls = [];
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async (constraints) => {
        calls.push(constraints);
        return { getAudioTracks: () => [track], getTracks: () => [track] };
      },
    },
  });
  const el = textarea();
  await session.startDictation("k", fieldSink(() => el), { lang: "en-US", deviceId: "usb-mic" });
  assert.deepEqual(calls[0].audio.deviceId, { exact: "usb-mic" });
  assert.equal(speech.last().track, track);
  speech.last().onend();
  assert.equal(speech.last().track, track, "restarts keep the same track");
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
});

test("saved preferences apply when the caller does not override them", async () => {
  prefs.writePrefs({ lang: "es-ES" });
  const el = textarea();
  await session.startDictation("l", fieldSink(() => el));
  assert.equal(speech.last().lang, "es-ES");
});

test("an adapter replaces the recogniser and writes its transcript at the end", async () => {
  const el = textarea();
  const calls = [];
  const adapter = {
    start: (ctx) => calls.push(["start", ctx.locale]),
    stop: async () => {
      calls.push(["stop"]);
      await tick(5);
      return { transcript: "from the cloud" };
    },
    cancel: () => calls.push(["cancel"]),
  };
  const before = speech.instances.length;
  await session.startDictation("m", fieldSink(() => el), { lang: "en-US", adapter });
  assert.equal(speech.instances.length, before, "no browser recogniser");
  assert.equal(session.getSnapshot().status, "listening");
  const stopping = session.stopDictation();
  assert.equal(session.getSnapshot().status, "processing");
  assert.equal(await session.stopDictation(), "", "a second stop while processing is ignored");
  assert.equal(await stopping, "from the cloud");
  assert.equal(el.value, "From the cloud");
  assert.deepEqual(calls, [["start", "en-US"], ["stop"]]);

  await session.startDictation("m", fieldSink(() => el), { lang: "en-US", adapter });
  session.cancelDictation();
  assert.deepEqual(calls.at(-1), ["cancel"]);
});

test("leaving a field ends the session and keeps the words", async () => {
  const el = textarea();
  const other = textarea();
  await session.startDictation("n", fieldSink(() => el), { lang: "en-US" });
  speech.say(["saved on blur"]);
  other.focus();
  await tick();
  assert.equal(session.getSnapshot().status, "idle");
  assert.equal(el.value, "Saved on blur");
});

test("silence auto-stop actually fires through the meter, and hands over the text", async () => {
  let amplitude = 60; // loud: samples swing ±60 around 128
  const track = { kind: "audio", stop() {} };
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }) },
  });
  globalThis.AudioContext = class {
    createAnalyser() {
      return {
        fftSize: 512,
        smoothingTimeConstant: 0,
        getByteTimeDomainData(array) {
          for (let i = 0; i < array.length; i += 1) array[i] = 128 + (i % 2 ? amplitude : -amplitude);
        },
      };
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    close() {
      return Promise.resolve();
    }
  };
  const levels = [];
  const stopLevels = session.onLevel((l) => levels.push(l));
  let autoStopped = null;
  const el = textarea();
  await session.startDictation("o", fieldSink(() => el), {
    lang: "en-US",
    meter: "on",
    silence: { enabled: true, autoStopMs: 150, minSpeechMs: 50 },
    onAutoStop: (text) => (autoStopped = text),
  });
  speech.say(["stopped by silence"]);
  await tick(120);
  assert.equal(session.getSnapshot().metered, true);
  assert.ok(levels.some((l) => l > 0.25), "the meter saw speech");
  amplitude = 0;
  await tick(400);
  stopLevels();
  assert.equal(session.getSnapshot().status, "idle", "silence stopped it");
  assert.equal(autoStopped, "stopped by silence");
  assert.equal(el.value, "Stopped by silence");
  delete globalThis.AudioContext;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
});

test("without a chosen microphone, start() gets no argument (Chrome throws on start(undefined))", async () => {
  const el = textarea();
  await session.startDictation("p", fieldSink(() => el), { lang: "en-US" });
  assert.equal(session.getSnapshot().status, "listening");
  assert.equal(session.getSnapshot().error, null);
  speech.last().onend();
  assert.equal(speech.last().starts, 2, "the restart also starts cleanly");
});
