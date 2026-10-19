/*
 * Where the words go.
 *
 * A sink opens a session at the caret, and each `write` replaces everything
 * said so far: the recogniser revises its guesses, so the target shows the
 * live best guess rather than a growing pile of them. `cancel` puts the target
 * back exactly as it was; `commit` keeps what is there.
 *
 * `write` answers false once the target has changed under it (the person
 * typed, or the message was sent), and the session stops rather than write
 * over them.
 */

export interface SinkSession {
  /** Keys pressed here end the session: typing takes over. */
  element?: HTMLElement;
  /** Leaving the element ends the session too — for fields that save on blur. */
  endOnBlur?: boolean;
  write: (text: string) => boolean;
  commit: () => void;
  cancel: () => void;
}

export interface DictationSink {
  /** Null when there is nowhere to write (unmounted, disabled). */
  begin: () => SinkSession | null;
}

/** Collapses whitespace, and capitalises a sentence start: "hello" after "Done." reads "Hello". */
export function shapeText(text: string, before: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const startsSentence = !before.trim() || /[.!?]\s*$/.test(before);
  return startsSentence ? trimmed[0].toLocaleUpperCase() + trimmed.slice(1) : trimmed;
}

type Field = HTMLInputElement | HTMLTextAreaElement;

/* React (and most frameworks) track a controlled field's value; setting it
   through the prototype's setter and firing `input` is what makes their
   change handlers run as if the person had typed it. */
function setFieldValue(field: Field, value: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

/** A textarea or a text input, controlled or not. Words go at the caret, or over the selection. */
export function fieldSink(get: () => Field | null | undefined): DictationSink {
  return {
    begin() {
      const field = get();
      if (!field || field.disabled || field.readOnly) return null;
      if (document.activeElement !== field) field.focus({ preventScroll: true });

      const original = field.value;
      const start = field.selectionStart ?? original.length;
      const end = field.selectionEnd ?? start;
      const before = original.slice(0, start);
      const after = original.slice(end);
      let last = original;

      return {
        element: field,
        /* Many fields save themselves on blur; words written after that
           would sit unsaved in a field nobody is in. */
        endOnBlur: true,
        write(text) {
          if (!field.isConnected || field.value !== last) return false;
          let said = shapeText(text, before);
          const lead = said && before && !/\s$/.test(before) ? " " : "";
          const tail = said && after && !/^\s/.test(after) ? " " : "";
          if (field.maxLength > 0) {
            const room = field.maxLength - before.length - after.length - lead.length - tail.length;
            said = said.slice(0, Math.max(0, room));
          }
          const next = said ? before + lead + said + tail + after : original;
          if (next !== field.value) setFieldValue(field, next);
          last = field.value;
          if (document.activeElement === field) {
            const caret = said ? before.length + lead.length + said.length : start;
            try {
              field.setSelectionRange(caret, caret);
            } catch {
              /* an input type without a caret (email, number) */
            }
          }
          return true;
        },
        commit() {},
        cancel() {
          if (field.isConnected && field.value === last && last !== original) setFieldValue(field, original);
        },
      };
    },
  };
}

/** Text held in memory, for callers that place it themselves (useVoiceDraft). */
export function memorySink(onChange: (text: string) => void): DictationSink {
  return {
    begin() {
      let current = "";
      return {
        write(text) {
          current = shapeText(text, "");
          onChange(current);
          return true;
        },
        commit() {},
        cancel() {
          current = "";
          onChange("");
        },
      };
    },
  };
}

/* The parts of a ProseMirror EditorView this needs, typed structurally so
   VoiceDraft carries no ProseMirror dependency. Tiptap: `editor.view`. */
interface PmNode {
  readonly content: { readonly size: number };
  textBetween(from: number, to: number, blockSeparator?: string, leafText?: string): string;
  resolve(pos: number): { start(): number };
  slice(from: number, to: number): PmSlice;
}
interface PmSlice {
  readonly size: number;
}
interface PmTransaction {
  insertText(text: string, from: number, to: number): PmTransaction;
  replaceRange(from: number, to: number, slice: PmSlice): PmTransaction;
  scrollIntoView(): PmTransaction;
}
export interface EditorViewLike {
  readonly state: { readonly doc: PmNode; readonly selection: { readonly from: number; readonly to: number }; readonly tr: PmTransaction };
  readonly dom: Element;
  readonly editable: boolean;
  dispatch(tr: PmTransaction): void;
}

/**
 * A ProseMirror editor (Tiptap: pass `() => editor.view`). Words land at the
 * caret, or over the selection, as plain text. The caret rides at the end of
 * what was said, because ProseMirror maps it there. The document's identity
 * is the check for "someone else changed it".
 */
export function editorViewSink(get: () => EditorViewLike | null | undefined): DictationSink {
  return {
    begin() {
      const view = get();
      if (!view || !view.editable) return null;

      const { doc, selection } = view.state;
      const { from, to } = selection;
      const original = doc.slice(from, to);
      const before = doc.textBetween(doc.resolve(from).start(), from, "\n", " ");
      /* The span the session owns: the selection at first, then what it wrote. */
      let length = to - from;
      let touched = false;
      let last: PmNode = doc;

      const put = (text: string | null) => {
        const tr = view.state.tr;
        if (text === null) tr.replaceRange(from, from + length, original);
        else tr.insertText(text, from, from + length);
        length = text === null ? original.size : text.length;
        view.dispatch(tr.scrollIntoView());
        last = view.state.doc;
      };

      return {
        element: view.dom as HTMLElement,
        write(text) {
          if (view.state.doc !== last) return false;
          const said = shapeText(text, before);
          if (!said && !touched) return true;
          touched = true;
          const lead = said && before && !/\s$/.test(before) ? " " : "";
          put(said ? lead + said : null);
          return true;
        },
        commit() {},
        cancel() {
          if (!touched || view.state.doc !== last) return;
          put(null);
        },
      };
    },
  };
}
