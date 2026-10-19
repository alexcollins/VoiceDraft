import assert from "node:assert/strict";
import { test } from "node:test";

import { createGate, rmsOf } from "../dist/core/gate.js";

test("nothing shows until the person starts speaking", () => {
  const gate = createGate();
  assert.deepEqual(gate.push(0.01, 0), { level: 0, activated: false, shouldStop: false });
  const loud = gate.push(0.2, 10);
  assert.equal(loud.activated, true);
  assert.ok(loud.level > 0.25);
});

test("after speech starts, quiet sound sits on the floor, true silence reads zero", () => {
  const gate = createGate({ minActiveLevel: 0.06 });
  gate.push(0.2, 0);
  assert.equal(gate.push(0.0005, 10).level, 0.06);
  assert.equal(gate.push(0, 20).level, 0);
});

test("silence auto-stop fires only after the pause, and only after enough speech", () => {
  const gate = createGate({}, { enabled: true, autoStopMs: 1000, minSpeechMs: 300 });
  gate.push(0.2, 0);
  assert.equal(gate.push(0, 999).shouldStop, false);
  assert.equal(gate.push(0, 1000).shouldStop, true);

  const brief = createGate({}, { enabled: true, autoStopMs: 100, minSpeechMs: 500 });
  brief.push(0.2, 0);
  assert.equal(brief.push(0, 200).shouldStop, false, "not before minSpeechMs");
  assert.equal(brief.push(0, 500).shouldStop, true);
});

test("speech keeps resetting the silence clock", () => {
  const gate = createGate({}, { enabled: true, autoStopMs: 500 });
  gate.push(0.2, 0);
  gate.push(0.2, 400);
  assert.equal(gate.push(0, 800).shouldStop, false);
  assert.equal(gate.push(0, 900).shouldStop, true);
});

test("silence detection is off by default", () => {
  const gate = createGate();
  gate.push(0.2, 0);
  assert.equal(gate.push(0, 60_000).shouldStop, false);
});

test("rmsOf reads 8-bit time-domain samples", () => {
  assert.equal(rmsOf(new Uint8Array([128, 128, 128])), 0);
  assert.equal(rmsOf(new Uint8Array([0, 0])), 1);
});
