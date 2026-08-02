import { expect, test } from "vitest";

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
  expect(r.output).toBe("hello");
  expect(r.pending).toBe("");
  expect(r.events).toEqual([]);
});

test("parseFocusEvents: empty input yields empty output", () => {
  const r = parseFocusEvents("", "");
  expect(r.output).toBe("");
  expect(r.pending).toBe("");
  expect(r.events).toEqual([]);
});

// --- parseFocusEvents: focus sequences ------------------------------------

test("parseFocusEvents: a lone focus-in is consumed", () => {
  const r = parseFocusEvents("\x1b[I", "");
  expect(r.output).toBe("");
  expect(r.pending).toBe("");
  expect(r.events).toEqual(["focus-in"]);
});

test("parseFocusEvents: a lone focus-out is consumed", () => {
  const r = parseFocusEvents("\x1b[O", "");
  expect(r.output).toBe("");
  expect(r.events).toEqual(["focus-out"]);
});

test("parseFocusEvents: focus-in followed by text keeps the text", () => {
  const r = parseFocusEvents("\x1b[Ihello", "");
  expect(r.output).toBe("hello");
  expect(r.events).toEqual(["focus-in"]);
});

test("parseFocusEvents: text followed by focus-out keeps the text", () => {
  const r = parseFocusEvents("hi\x1b[O", "");
  expect(r.output).toBe("hi");
  expect(r.events).toEqual(["focus-out"]);
});

test("parseFocusEvents: both focus events in one chunk", () => {
  const r = parseFocusEvents("\x1b[I\x1b[O", "");
  expect(r.output).toBe("");
  expect(r.events).toEqual(["focus-in", "focus-out"]);
});

// --- parseFocusEvents: other escapes pass through -------------------------

test("parseFocusEvents: arrow keys pass through", () => {
  for (const seq of ["\x1b[A", "\x1b[B", "\x1b[C", "\x1b[D"]) {
    const r = parseFocusEvents(seq, "");
    expect(r.output).toBe(seq);
    expect(r.events).toEqual([]);
  }
});

test("parseFocusEvents: a parameterised CSI sequence (Ctrl+Right) passes through", () => {
  const r = parseFocusEvents("\x1b[1;5C", "");
  expect(r.output).toBe("\x1b[1;5C");
  expect(r.events).toEqual([]);
});

test("parseFocusEvents: an OSC sequence passes through", () => {
  const r = parseFocusEvents("\x1b]11;rgb:00/00/00\x07", "");
  expect(r.output).toBe("\x1b]11;rgb:00/00/00\x07");
  expect(r.events).toEqual([]);
});

test("parseFocusEvents: a lone Escape is not buffered and passes through", () => {
  const r = parseFocusEvents("\x1b", "");
  expect(r.output).toBe("\x1b");
  expect(r.pending).toBe("");
  expect(r.events).toEqual([]);
});

// --- parseFocusEvents: chunk boundaries -----------------------------------

test("parseFocusEvents: a trailing ESC[ is buffered for the next chunk", () => {
  const r = parseFocusEvents("\x1b[", "");
  expect(r.output).toBe("");
  expect(r.pending).toBe("\x1b[");
  expect(r.events).toEqual([]);
});

test("parseFocusEvents: a buffered ESC[ completes a focus-in on the next chunk", () => {
  const r = parseFocusEvents("I", "\x1b[");
  expect(r.output).toBe("");
  expect(r.pending).toBe("");
  expect(r.events).toEqual(["focus-in"]);
});

test("parseFocusEvents: a buffered ESC[ completing an arrow key passes it through", () => {
  const r = parseFocusEvents("A", "\x1b[");
  expect(r.output).toBe("\x1b[A");
  expect(r.pending).toBe("");
  expect(r.events).toEqual([]);
});

test("parseFocusEvents: text before a trailing ESC[ passes through, ESC[ buffers", () => {
  const r = parseFocusEvents("abc\x1b[", "");
  expect(r.output).toBe("abc");
  expect(r.pending).toBe("\x1b[");
});

test("parseFocusEvents: arrow key then split focus event across chunks", () => {
  const first = parseFocusEvents("\x1b[A\x1b[", "");
  expect(first.output).toBe("\x1b[A");
  expect(first.pending).toBe("\x1b[");
  const second = parseFocusEvents("O", first.pending);
  expect(second.output).toBe("");
  expect(second.events).toEqual(["focus-out"]);
});

// --- constants ------------------------------------------------------------

test("FOCUS_REPORT_ENABLE is the OSC 1004 set sequence", () => {
  expect(FOCUS_REPORT_ENABLE).toBe("\x1b[?1004h");
});

test("FOCUS_REPORT_DISABLE is the OSC 1004 reset sequence", () => {
  expect(FOCUS_REPORT_DISABLE).toBe("\x1b[?1004l");
});

test("INITIAL_FOCUS_STATE is focused, unknown, unbuffered", () => {
  expect(INITIAL_FOCUS_STATE).toEqual({ focused: true, focusKnown: false, pending: "" });
});

// --- stepFocus ------------------------------------------------------------

test("stepFocus: input without focus events passes through unchanged", () => {
  const r = stepFocus(INITIAL_FOCUS_STATE, "hello");
  expect(r.result).toBe(undefined);
  expect(r.state.focused).toBe(true);
  expect(r.state.focusKnown).toBe(false);
  expect(r.state.pending).toBe("");
});

test("stepFocus: a focus-in marks focus known and focused, and is consumed", () => {
  const r = stepFocus(INITIAL_FOCUS_STATE, "\x1b[I");
  expect(r.result).toEqual({ consume: true });
  expect(r.state.focusKnown).toBe(true);
  expect(r.state.focused).toBe(true);
});

test("stepFocus: a focus-out marks focus known and unfocused, and is consumed", () => {
  const r = stepFocus(INITIAL_FOCUS_STATE, "\x1b[O");
  expect(r.result).toEqual({ consume: true });
  expect(r.state.focusKnown).toBe(true);
  expect(r.state.focused).toBe(false);
});

test("stepFocus: focus-in with trailing text replaces the chunk with the text", () => {
  const r = stepFocus(INITIAL_FOCUS_STATE, "\x1b[Ix");
  expect(r.result).toEqual({ data: "x" });
  expect(r.state.focused).toBe(true);
  expect(r.state.focusKnown).toBe(true);
});

test("stepFocus: a trailing ESC[ is buffered and the chunk is consumed", () => {
  const r = stepFocus(INITIAL_FOCUS_STATE, "\x1b[");
  expect(r.result).toEqual({ consume: true });
  expect(r.state.pending).toBe("\x1b[");
  expect(r.state.focusKnown).toBe(false);
});

test("stepFocus: a buffered ESC[ completing an arrow key passes it through as data", () => {
  const buffered = stepFocus(INITIAL_FOCUS_STATE, "\x1b[");
  const r = stepFocus(buffered.state, "A");
  expect(r.result).toEqual({ data: "\x1b[A" });
  expect(r.state.pending).toBe("");
  expect(r.state.focusKnown).toBe(false);
});

test("stepFocus: a buffered ESC[ completing a focus-out updates state and consumes", () => {
  const buffered = stepFocus(INITIAL_FOCUS_STATE, "\x1b[");
  const r = stepFocus(buffered.state, "O");
  expect(r.result).toEqual({ consume: true });
  expect(r.state.focusKnown).toBe(true);
  expect(r.state.focused).toBe(false);
});

test("stepFocus: two focus events in one chunk apply in order (last wins)", () => {
  const r = stepFocus(INITIAL_FOCUS_STATE, "\x1b[I\x1b[O");
  expect(r.state.focusKnown).toBe(true);
  expect(r.state.focused).toBe(false);
});

test("stepFocus: arrow key split across chunks is reassembled and passed through", () => {
  const first = stepFocus(INITIAL_FOCUS_STATE, "x\x1b[");
  expect(first.result).toEqual({ data: "x" });
  const second = stepFocus(first.state, "B");
  expect(second.result).toEqual({ data: "\x1b[B" });
  expect(second.state.focusKnown).toBe(false);
  expect(second.state.pending).toBe("");
});
