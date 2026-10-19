import assert from "node:assert/strict";
import { test } from "node:test";

import { schema } from "prosemirror-schema-basic";
import { EditorState, TextSelection } from "prosemirror-state";

import { installDom } from "./helpers/dom.mjs";

installDom();
const { editorViewSink, fieldSink, memorySink, shapeText } = await import("../dist/core/sinks.js");

test("shapeText collapses whitespace and capitalises a sentence start", () => {
  assert.equal(shapeText("  hello   world ", ""), "Hello world");
  assert.equal(shapeText("and more", "Done. "), "And more");
  assert.equal(shapeText("and more", "Thanks"), "and more");
  assert.equal(shapeText("   ", ""), "");
});

function textarea(value, caret = value.length) {
  const el = document.createElement("textarea");
  document.body.append(el);
  el.value = value;
  el.setSelectionRange(caret, caret);
  return el;
}

test("a field gets the words at the caret, spaced from what is around them", () => {
  const el = textarea("Hello world", 5);
  const inputs = [];
  el.addEventListener("input", () => inputs.push(el.value));
  const session = fieldSink(() => el).begin();
  assert.equal(session.write("there"), true);
  assert.equal(el.value, "Hello there world");
  assert.equal(el.selectionStart, "Hello there".length);
  assert.ok(inputs.length > 0, "fires input so frameworks see it");
  session.write("there friend");
  assert.equal(el.value, "Hello there friend world", "each write replaces the last guess");
});

test("a field's cancel puts it back exactly", () => {
  const el = textarea("Keep this");
  const session = fieldSink(() => el).begin();
  session.write("and that");
  assert.equal(el.value, "Keep this and that");
  session.cancel();
  assert.equal(el.value, "Keep this");
});

test("a field the person changed is not written over", () => {
  const el = textarea("");
  const session = fieldSink(() => el).begin();
  session.write("one");
  el.value = "typed instead";
  assert.equal(session.write("one two"), false);
  assert.equal(el.value, "typed instead");
});

test("a field's maxLength is respected", () => {
  const el = textarea("12345");
  el.maxLength = 10;
  const session = fieldSink(() => el).begin();
  session.write("abcdefghij");
  assert.equal(el.value.length, 10);
});

test("disabled and missing fields open no session", () => {
  const el = textarea("");
  el.disabled = true;
  assert.equal(fieldSink(() => el).begin(), null);
  assert.equal(fieldSink(() => null).begin(), null);
});

test("memorySink reports the shaped draft and clears on cancel", () => {
  const seen = [];
  const session = memorySink((t) => seen.push(t)).begin();
  session.write("hi there");
  session.cancel();
  assert.deepEqual(seen, ["Hi there", ""]);
});

/* A minimal EditorView over a real ProseMirror state. */
function view(text, from, to = from) {
  let state = EditorState.create({ doc: schema.node("doc", null, [schema.node("paragraph", null, text ? [schema.text(text)] : [])]) });
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
  const v = {
    get state() {
      return state;
    },
    dom: document.createElement("div"),
    editable: true,
    dispatch(tr) {
      state = state.apply(tr);
    },
  };
  return v;
}

test("an editor gets the words at the caret, and the caret rides after them", () => {
  const v = view("Hello world", 6); // after "Hello"
  const session = editorViewSink(() => v).begin();
  session.write("there");
  assert.equal(v.state.doc.textContent, "Hello there world");
  session.write("there friend");
  assert.equal(v.state.doc.textContent, "Hello there friend world");
  assert.equal(v.state.selection.from, 1 + "Hello there friend".length);
});

test("an editor selection is replaced, and cancel restores it", () => {
  const v = view("Hello world", 7, 12); // "world"
  const session = editorViewSink(() => v).begin();
  session.write("everyone");
  assert.equal(v.state.doc.textContent, "Hello everyone");
  session.cancel();
  assert.equal(v.state.doc.textContent, "Hello world");
});

test("an editor changed by someone else is not written over", () => {
  const v = view("", 1);
  const session = editorViewSink(() => v).begin();
  session.write("first");
  v.dispatch(v.state.tr.insertText("!", v.state.selection.from));
  assert.equal(session.write("first second"), false);
  assert.equal(v.state.doc.textContent, "First!");
});
