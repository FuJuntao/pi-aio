import { test } from "vitest";
import assert from "node:assert/strict";

import {
  INITIAL_FOCUS_STATE,
  FOCUS_REPORT_ENABLE,
  FOCUS_REPORT_DISABLE,
  parseFocusEvents,
  stepFocus,
} from "../extensions/notify/focus.ts";

// --- parseFocusEvents: no focus input -------------------------------------

test("parseFocusEvents: plain text passes through untouched", () => {
  const r = parseFocusEvents("hello", "");
  assert.equal(r.output, "hello");
  assert.equal(r.pending, "");
  assert.deepEqual(r.events, []);
});

test("parseFocusEvents: empty input yields empty output", () => {
  const r = parseFocusEvents("", "");
  assert.equal(r.output, "");
  assert.equal(r.pending, "");
  assert.deepEqual(r.events, []);
});

// --- parseFocusEvents: focus sequences ------------------------------------

test("parseFocusEvents: a lone focus-in is consumed", () => {
  const r = parseFocusEvents("\x1b[I", "");
  assert.equal(r.output, "");
  assert.equal(r.pending, "");
  assert.deepEqual(r.events, ["focus-in"]);
});

test("parseFocusEvents: a lone focus-out is consumed", () => {
  const r = parseFocusEvents("\x1b[O", "");
  assert.equal(r.output, "");
  assert.deepEqual(r.events, ["focus-out"]);
});

test("parseFocusEvents: focus-in followed by text keeps the text", () => {
  const r = parseFocusEvents("\x1b[Ihello", "");
  assert.equal(r.output, "hello");
  assert.deepEqual(r.events, ["focus-in"]);
});

test("parseFocusEvents: text followed by focus-out keeps the text", () => {
  const r = parseFocusEvents("hi\x1b[O", "");
  assert.equal(r.output, "hi");
  assert.deepEqual(r.events, ["focus-out"]);
});

test("parseFocusEvents: both focus events in one chunk", () => {
  const r = parseFocusEvents("\x1b[I\x1b[O", "");
  assert.equal(r.output, "");
  assert.deepEqual(r.events, ["focus-in", "focus-out"]);
});

// --- parseFocusEvents: other escapes pass through -------------------------

test("parseFocusEvents: arrow keys pass through", () => {
  for (const seq of ["\x1b[A", "\x1b[B", "\x1b[C", "\x1b[D"]) {
    const r = parseFocusEvents(seq, "");
    assert.equal(r.output, seq);
    assert.deepEqual(r.events, []);
  }
});

test("parseFocusEvents: a parameterised CSI sequence (Ctrl+Right) passes through", () => {
  const r = parseFocusEvents("\x1b[1;5C", "");
  assert.equal(r.output, "\x1b[1;5C");
  assert.deepEqual(r.events, []);
});

test("parseFocusEvents: an OSC sequence passes through", () => {
  const r = parseFocusEvents("\x1b]11;rgb:00/00/00\x07", "");
  assert.equal(r.output, "\x1b]11;rgb:00/00/00\x07");
  assert.deepEqual(r.events, []);
});

test("parseFocusEvents: a lone Escape is not buffered and passes through", () => {
  const r = parseFocusEvents("\x1b", "");
  assert.equal(r.output, "\x1b");
  assert.equal(r.pending, "");
  assert.deepEqual(r.events, []);
});

// --- parseFocusEvents: chunk boundaries -----------------------------------

test("parseFocusEvents: a trailing ESC[ is buffered for the next chunk", () => {
  const r = parseFocusEvents("\x1b[", "");
  assert.equal(r.output, "");
  assert.equal(r.pending, "\x1b[");
  assert.deepEqual(r.events, []);
});

test("parseFocusEvents: a buffered ESC[ completes a focus-in on the next chunk", () => {
  const r = parseFocusEvents("I", "\x1b[");
  assert.equal(r.output, "");
  assert.equal(r.pending, "");
  assert.deepEqual(r.events, ["focus-in"]);
});

test("parseFocusEvents: a buffered ESC[ completing an arrow key passes it through", () => {
  const r = parseFocusEvents("A", "\x1b[");
  assert.equal(r.output, "\x1b[A");
  assert.equal(r.pending, "");
  assert.deepEqual(r.events, []);
});

test("parseFocusEvents: text before a trailing ESC[ passes through, ESC[ buffers", () => {
  const r = parseFocusEvents("abc\x1b[", "");
  assert.equal(r.output, "abc");
  assert.equal(r.pending, "\x1b[");
});

test("parseFocusEvents: arrow key then split focus event across chunks", () => {
  const first = parseFocusEvents("\x1b[A\x1b[", "");
  assert.equal(first.output, "\x1b[A");
  assert.equal(first.pending, "\x1b[");
  const second = parseFocusEvents("O", first.pending);
  assert.equal(second.output, "");
  assert.deepEqual(second.events, ["focus-out"]);
});

// --- constants ------------------------------------------------------------

test("FOCUS_REPORT_ENABLE is the OSC 1004 set sequence", () => {
  assert.equal(FOCUS_REPORT_ENABLE, "\x1b[?1004h");
});

test("FOCUS_REPORT_DISABLE is the OSC 1004 reset sequence", () => {
  assert.equal(FOCUS_REPORT_DISABLE, "\x1b[?1004l");
});

test("INITIAL_FOCUS_STATE is focused, unknown, unbuffered", () => {
  assert.deepEqual(INITIAL_FOCUS_STATE, { focused: true, focusKnown: false, pending: "" });
});

// --- stepFocus ------------------------------------------------------------

test("stepFocus: input without focus events passes through unchanged", () => {
  const r = stepFocus(INITIAL_FOCUS_STATE, "hello");
  assert.equal(r.result, undefined);
  assert.equal(r.state.focused, true);
  assert.equal(r.state.focusKnown, false);
  assert.equal(r.state.pending, "");
});

test("stepFocus: a focus-in marks focus known and focused, and is consumed", () => {
  const r = stepFocus(INITIAL_FOCUS_STATE, "\x1b[I");
  assert.deepEqual(r.result, { consume: true });
  assert.equal(r.state.focusKnown, true);
  assert.equal(r.state.focused, true);
});

test("stepFocus: a focus-out marks focus known and unfocused, and is consumed", () => {
  const r = stepFocus(INITIAL_FOCUS_STATE, "\x1b[O");
  assert.deepEqual(r.result, { consume: true });
  assert.equal(r.state.focusKnown, true);
  assert.equal(r.state.focused, false);
});

test("stepFocus: focus-in with trailing text replaces the chunk with the text", () => {
  const r = stepFocus(INITIAL_FOCUS_STATE, "\x1b[Ix");
  assert.deepEqual(r.result, { data: "x" });
  assert.equal(r.state.focused, true);
  assert.equal(r.state.focusKnown, true);
});

test("stepFocus: a trailing ESC[ is buffered and the chunk is consumed", () => {
  const r = stepFocus(INITIAL_FOCUS_STATE, "\x1b[");
  assert.deepEqual(r.result, { consume: true });
  assert.equal(r.state.pending, "\x1b[");
  assert.equal(r.state.focusKnown, false);
});

test("stepFocus: a buffered ESC[ completing an arrow key passes it through as data", () => {
  const buffered = stepFocus(INITIAL_FOCUS_STATE, "\x1b[");
  const r = stepFocus(buffered.state, "A");
  assert.deepEqual(r.result, { data: "\x1b[A" });
  assert.equal(r.state.pending, "");
  assert.equal(r.state.focusKnown, false);
});

test("stepFocus: a buffered ESC[ completing a focus-out updates state and consumes", () => {
  const buffered = stepFocus(INITIAL_FOCUS_STATE, "\x1b[");
  const r = stepFocus(buffered.state, "O");
  assert.deepEqual(r.result, { consume: true });
  assert.equal(r.state.focusKnown, true);
  assert.equal(r.state.focused, false);
});

test("stepFocus: two focus events in one chunk apply in order (last wins)", () => {
  const r = stepFocus(INITIAL_FOCUS_STATE, "\x1b[I\x1b[O");
  assert.equal(r.state.focusKnown, true);
  assert.equal(r.state.focused, false);
});

test("stepFocus: arrow key split across chunks is reassembled and passed through", () => {
  const first = stepFocus(INITIAL_FOCUS_STATE, "x\x1b[");
  assert.deepEqual(first.result, { data: "x" });
  const second = stepFocus(first.state, "B");
  assert.deepEqual(second.result, { data: "\x1b[B" });
  assert.equal(second.state.focusKnown, false);
  assert.equal(second.state.pending, "");
});
