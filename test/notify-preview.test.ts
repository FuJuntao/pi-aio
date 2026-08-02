import { expect, test } from "vitest";

import type {
  CompactionEntry,
  SessionEntry,
  SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai/compat";

import {
  PREVIEW_FALLBACK,
  PREVIEW_GRAPHEMES,
  buildPreviewBody,
  extractLastAssistantText,
  sanitize,
  truncateGraphemes,
} from "../extensions/notify/preview.ts";

// The popup-body preview pipeline is pure over a session branch: extract the
// last assistant reply's text, sanitize it, truncate to PREVIEW_GRAPHEMES
// graphemes, fall back to PREVIEW_FALLBACK when nothing usable remains. The only
// impure seam (`ctx.sessionManager.getBranch()`) lives in index.ts and is
// covered end-to-end in notify-e2e.test.ts; this file pins each stage directly.

let n = 0;
const nextId = (): string => `e${++n}`;

function messageEntry(
  message: SessionMessageEntry["message"],
  parentId: string | null = null,
): SessionMessageEntry {
  return { type: "message", id: nextId(), parentId, timestamp: "2025-01-01T00:00:00Z", message };
}

function compactionEntry(parentId: string | null = null): CompactionEntry {
  return {
    type: "compaction",
    id: nextId(),
    parentId,
    timestamp: "2025-01-01T00:00:00Z",
    summary: "earlier turns summarized",
    firstKeptEntryId: "kept",
    tokensBefore: 1000,
  };
}

const userMsg = (text: string, parentId: string | null = null): SessionMessageEntry =>
  messageEntry({ role: "user", content: text, timestamp: 0 }, parentId);

const assistantMsg = (text: string, parentId: string | null = null): SessionMessageEntry =>
  messageEntry(fauxAssistantMessage(text), parentId);

const toolResultMsg = (parentId: string | null = null): SessionMessageEntry =>
  messageEntry(
    {
      role: "toolResult",
      toolCallId: "t1",
      toolName: "read",
      content: [fauxText("file contents")],
      isError: false,
      timestamp: 0,
    },
    parentId,
  );

// --- extractLastAssistantText ---------------------------------------------

test("extractLastAssistantText: empty branch yields empty string", () => {
  expect(extractLastAssistantText([])).toBe("");
});

test("extractLastAssistantText: only a user message yields empty string", () => {
  expect(extractLastAssistantText([userMsg("hi")])).toBe("");
});

test("extractLastAssistantText: single assistant text block is returned", () => {
  expect(extractLastAssistantText([userMsg("hi"), assistantMsg("done")])).toBe("done");
});

test("extractLastAssistantText: the LAST assistant message wins (not the first)", () => {
  const branch: SessionEntry[] = [
    userMsg("hi"),
    assistantMsg("first reply"),
    userMsg("again"),
    assistantMsg("second reply"),
  ];
  expect(extractLastAssistantText(branch)).toBe("second reply");
});

test("extractLastAssistantText: only text blocks are concatenated (thinking/toolCall dropped)", () => {
  const branch: SessionEntry[] = [
    userMsg("hi"),
    messageEntry(
      fauxAssistantMessage([
        fauxText("hello "),
        fauxThinking("internal"),
        fauxToolCall("read", { path: "x" }),
        fauxText("world"),
      ]),
    ),
  ];
  expect(extractLastAssistantText(branch)).toBe("hello world");
});

test("extractLastAssistantText: assistant with no text blocks yields empty string", () => {
  const branch: SessionEntry[] = [
    userMsg("hi"),
    messageEntry(fauxAssistantMessage([fauxThinking("only thinking"), fauxToolCall("read", {})])),
  ];
  expect(extractLastAssistantText(branch)).toBe("");
});

test("extractLastAssistantText: compaction entries are skipped, last assistant still found", () => {
  const branch: SessionEntry[] = [
    assistantMsg("before compaction"),
    compactionEntry(),
    assistantMsg("after compaction"),
  ];
  expect(extractLastAssistantText(branch)).toBe("after compaction");
});

test("extractLastAssistantText: toolResult entries are skipped", () => {
  const branch: SessionEntry[] = [
    userMsg("hi"),
    messageEntry(fauxAssistantMessage([fauxToolCall("read", {})])),
    toolResultMsg(),
    assistantMsg("real reply"),
  ];
  expect(extractLastAssistantText(branch)).toBe("real reply");
});

// --- sanitize -------------------------------------------------------------

test("sanitize: plain prose passes through with whitespace collapsed", () => {
  expect(sanitize("Hello   world\n\nnext line")).toBe("Hello world next line");
});

test("sanitize: fenced code blocks (backticks) are removed entirely", () => {
  expect(sanitize("before\n```ts\nconst x = 1;\n```\nafter")).toBe("before after");
});

test("sanitize: fenced code blocks (tildes) are removed entirely", () => {
  expect(sanitize("before\n~~~\ncode\n~~~\nafter")).toBe("before after");
});

test("sanitize: an unmatched opening fence swallows the rest", () => {
  expect(sanitize("before\n```ts\ncode without close")).toBe("before");
});

test("sanitize: inline backticks are stripped, inner text kept", () => {
  expect(sanitize("use `foo` and `bar` here")).toBe("use foo and bar here");
});

test("sanitize: a lone backtick is removed", () => {
  expect(sanitize("a ` b")).toBe("a b");
});

test("sanitize: JS/Node stack-frame lines are dropped", () => {
  const text =
    "Error occurred\n    at foo (bar.js:1:2)\n    at Object.<anonymous> (bar.js:5:6)\nrecovered";
  expect(sanitize(text)).toBe("Error occurred recovered");
});

test("sanitize: Python traceback frame lines are dropped", () => {
  const text = 'Traceback (most recent call last):\n  File "x.py", line 10, in <module>\nAll done';
  expect(sanitize(text)).toBe("All done");
});

test("sanitize: Ruby stack-frame lines are dropped", () => {
  const text = "from /app/lib.rb:10:in `foo'\n/app/lib.rb:20:in `bar'\nrecovered";
  expect(sanitize(text)).toBe("recovered");
});

test("sanitize: Rust panic/backtrace lines are dropped", () => {
  const text =
    "panicked at 'overflow', src/main.rs:10:5\nstack backtrace:\n   0: std::backtrace::Backtrace::capture\nrecovered";
  expect(sanitize(text)).toBe("recovered");
});

test("sanitize: Go panic/goroutine/frame lines are dropped", () => {
  const text =
    "panic: runtime error: index out of range\ngoroutine 1 [running]:\n\t/path/file.go:42 +0x100\n\t/path/file.go:10 +0x20\nrecovered";
  expect(sanitize(text)).toBe("recovered");
});

test("sanitize: Node UnhandledPromiseRejection lines are dropped", () => {
  const text = "UnhandledPromiseRejection: this rejection was not handled\nrecovered";
  expect(sanitize(text)).toBe("recovered");
});

test("sanitize: shell-prompt lines ($ and >) are dropped", () => {
  expect(sanitize("$ ls -la\n> echo hi\nactual output")).toBe("actual output");
});

test("sanitize: a code block plus a real sentence keeps only the sentence", () => {
  expect(sanitize("I ran the tests:\n```sh\npnpm test\n```\nAll green.")).toBe(
    "I ran the tests: All green.",
  );
});

test("sanitize: only a fenced code block yields empty string", () => {
  expect(sanitize("```\ncode\n```")).toBe("");
});

test("sanitize: mixed stack trace and prose keeps the prose", () => {
  const text =
    "Something failed:\n    at foo (bar.js:1:2)\n    at baz (bar.js:3:4)\nBut I retried and it worked.";
  expect(sanitize(text)).toBe("Something failed: But I retried and it worked.");
});

// --- truncateGraphemes ----------------------------------------------------

test("truncateGraphemes: empty string is empty", () => {
  expect(truncateGraphemes("", 200)).toBe("");
});

test("truncateGraphemes: text under the limit is unchanged", () => {
  expect(truncateGraphemes("hello", 200)).toBe("hello");
});

test("truncateGraphemes: exactly the limit is unchanged (no ellipsis)", () => {
  const text = "x".repeat(200);
  expect(truncateGraphemes(text, 200)).toBe(text);
});

test("truncateGraphemes: over the limit is cut to the limit plus an ellipsis", () => {
  const text = "x".repeat(201);
  expect(truncateGraphemes(text, 200)).toBe(`${"x".repeat(200)}\u2026`);
});

test("truncateGraphemes: grapheme-aware, does not split a ZWJ family emoji", () => {
  // "a" + family emoji (one grapheme, several code points) + "b" = 3 graphemes.
  const text = `a\u{1F468}\u200D\u{1F469}\u200D\u{1F467}b`;
  expect(truncateGraphemes(text, 2)).toBe(`a\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u2026`);
});

test("truncateGraphemes: grapheme-aware, keeps a combining-character sequence together", () => {
  // "e" + combining acute is one grapheme (two code points); a code-unit split
  // would leave a bare "e" and orphan the combining mark.
  expect(truncateGraphemes("e\u0301", 1)).toBe("e\u0301");
});

// --- buildPreviewBody (pipeline) -----------------------------------------

test("buildPreviewBody: assistant text becomes the body", () => {
  expect(buildPreviewBody([userMsg("hi"), assistantMsg("done")])).toBe("done");
});

test("buildPreviewBody: empty branch falls back to the static string", () => {
  expect(buildPreviewBody([])).toBe(PREVIEW_FALLBACK);
});

test("buildPreviewBody: a reply that is only a code block falls back", () => {
  const branch: SessionEntry[] = [assistantMsg("```\ncode only\n```")];
  expect(buildPreviewBody(branch)).toBe(PREVIEW_FALLBACK);
});

test("buildPreviewBody: a tool-call-only reply falls back", () => {
  const branch: SessionEntry[] = [messageEntry(fauxAssistantMessage([fauxToolCall("read", {})]))];
  expect(buildPreviewBody(branch)).toBe(PREVIEW_FALLBACK);
});

test("buildPreviewBody: long reply is truncated to PREVIEW_GRAPHEMES plus ellipsis", () => {
  const long = "x".repeat(500);
  expect(buildPreviewBody([assistantMsg(long)])).toBe(`${"x".repeat(PREVIEW_GRAPHEMES)}\u2026`);
});

test("buildPreviewBody: a reply with a stack trace keeps only the prose", () => {
  const text = "Failed:\n    at foo (bar.js:1:2)\nRetried and succeeded.";
  expect(buildPreviewBody([assistantMsg(text)])).toBe("Failed: Retried and succeeded.");
});

test("PREVIEW_GRAPHEMES is 200 (matches Codex)", () => {
  expect(PREVIEW_GRAPHEMES).toBe(200);
});

test("PREVIEW_FALLBACK is the static finished string", () => {
  expect(PREVIEW_FALLBACK).toBe("Finished - waiting for input");
});
