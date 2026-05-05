import assert from "node:assert/strict";
import { formatElapsed } from "../dist/utils/format.js";

assert.equal(formatElapsed(0), "0:00");
assert.equal(formatElapsed(65), "1:05");
assert.equal(formatElapsed(600), "10:00");
assert.equal(formatElapsed(-1), "0:00");
assert.equal(formatElapsed(Number.NaN), "0:00");

console.log("format tests passed");
