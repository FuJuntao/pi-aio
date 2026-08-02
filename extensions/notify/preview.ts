/**
 * Pure preview-pipeline for the notify extension's popup body.
 *
 * On `agent_settled`, the popup body is a short verbatim preview of pi's last
 * assistant reply - sanitized and truncated - instead of a static string. This
 * module owns that pipeline as pure functions, sibling to the existing
 * focus/channel/config helpers; the only impure seam (`ctx.sessionManager.
 * getBranch()`) lives in `index.ts`. Keeping it pure lets `notify-preview.test.ts`
 * assert extraction, sanitization, and grapheme truncation without a session.
 *
 * Pipeline (matches Codex's `AGENT_NOTIFICATION_PREVIEW_GRAPHEMES = 200`):
 *
 * ```text
 * body = truncate(sanitize(extractLastAssistantText(branch)), 200)
 *      || "Finished - waiting for input"
 * ```
 *
 * No LLM: the preview is a verbatim snippet, not a model-generated summary - no
 * extra API calls, keys, latency, or model config. Sanitization is intentionally
 * aggressive because popup bodies are tiny; a wall of code or a stack trace is
 * useless there. The full assistant text remains in the transcript.
 */

import type { SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";

/** Fallback popup body when the last assistant reply has no usable text. */
export const PREVIEW_FALLBACK = "Finished - waiting for input";

/** Max graphemes in the preview body (matches Codex's preview length). */
export const PREVIEW_GRAPHEMES = 200;

/** Ellipsis appended when the preview is truncated. */
const ELLIPSIS = "\u2026";

/** Grapheme segmenter reused across calls (grapheme boundaries are not locale-dependent). */
const GRAPHEME_SEGMENTER = new Intl.Segmenter("en", { granularity: "grapheme" });

/** True when `entry` carries an `AgentMessage` (as opposed to compaction, model-change, ...). */
function isMessageEntry(entry: SessionEntry): entry is SessionMessageEntry {
  return entry.type === "message";
}

// --- Extraction ------------------------------------------------------------

/**
 * Concatenate the text content blocks of the **last** assistant message on the
 * branch. Non-message entries (compaction, model changes, labels, custom state)
 * and non-assistant messages (user, toolResult) are skipped, so a compaction or
 * tool-result entry between two assistant turns never shadows the real reply.
 * Returns `""` when there is no assistant message or it has no text blocks
 * (e.g. a tool-call-only or thinking-only reply). `entries` is read in
 * root-to-leaf order (as `getBranch()` yields it); the last assistant message
 * wins.
 *
 * Pure over its inputs.
 */
export function extractLastAssistantText(entries: readonly SessionEntry[]): string {
  let text = "";
  for (const entry of entries) {
    if (!isMessageEntry(entry)) continue;
    const message = entry.message;
    if (message.role !== "assistant") continue;
    // `message` is narrowed to AssistantMessage here; keep only text blocks
    // (drop thinking and toolCall blocks).
    text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  }
  return text;
}

// --- Sanitization ----------------------------------------------------------

/** Match the opening fence of a fenced code block: 3+ backticks or 3+ tildes. */
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
/** A closing fence is 3+ of the *same* char as the opening fence, trailing whitespace only. */
const FENCE_CLOSE_BACKTICK = /^ {0,3}`{3,}\s*$/;
const FENCE_CLOSE_TILDE = /^ {0,3}~{3,}\s*$/;

/**
 * Remove fenced code blocks (``` / ~~~) entirely - opening fence, info string,
 * content, and closing fence - leaving other lines in place. An unmatched
 * opening fence swallows the rest of the input (treated as fenced), which is
 * fine for a popup preview. Line-based so it can't be fooled by backticks that
 * happen to share a line with prose.
 */
function stripFencedBlocks(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept: string[] = [];
  let fence: "`" | "~" | null = null;
  for (const line of lines) {
    if (fence === null) {
      const match = FENCE_OPEN.exec(line);
      if (match) {
        // The capture group is always present when FENCE_OPEN matches ({3,} is non-empty).
        fence = (match[1] ?? "").startsWith("`") ? "`" : "~";
      } else {
        kept.push(line);
      }
    } else if ((fence === "`" ? FENCE_CLOSE_BACKTICK : FENCE_CLOSE_TILDE).test(line)) {
      fence = null;
    }
    // else: line is inside a fence -> drop it.
  }
  return kept.join("\n");
}

/**
 * Stack-frame line patterns for the languages pi's transcripts tend to embed:
 * Python, JS/Node, Java, Ruby, Rust, and Go, plus Node's
 * `UnhandledPromiseRejection`. Each is anchored to a line and specific enough
 * that ordinary prose rarely trips it. Intentionally aggressive - dropping a
 * stray prose line only shortens the preview; the full text stays in the
 * transcript.
 */
const STACK_FRAME_PATTERNS: readonly RegExp[] = [
  /^\s*at\s/, // JS/Node/Java stack frames ("    at foo (bar.js:1:2)")
  /^\s*from\s/, // Ruby "from path:line:in method"
  /^\s*File "[^"]*", line \d+/, // Python 'File "path", line N, in func'
  /^\s*Traceback \(most recent call last\):/, // Python traceback header
  /^\s*panic:/, // Go "panic: ..."
  /^\s*goroutine \d+/, // Go "goroutine N [running]:"
  /\.go:\d+/, // Go stack frame file refs ("foo.go:42")
  /^\s*panicked at /, // Rust "panicked at 'msg', src/main.rs:1:2"
  /^\s*stack backtrace:/, // Rust backtrace header
  /^\s*\d+:\s/, // Rust/numbered backtrace frames ("   0: std::backtrace::...")
  /:\d+:in\s/, // Ruby "path:line:in method"
  /UnhandledPromiseRejection/, // Node unhandled-rejection marker
];

/** Shell-prompt lines: a leading `$` or `>` (after optional indent). */
const SHELL_PROMPT = /^\s*[$>]/;

/** True when a line is a stack frame, a shell prompt, or another trace marker. */
function isNoiseLine(line: string): boolean {
  if (SHELL_PROMPT.test(line)) return true;
  return STACK_FRAME_PATTERNS.some((pattern) => pattern.test(line));
}

/**
 * Sanitize assistant text for a tiny popup body: remove fenced code blocks and
 * stack-trace / shell-prompt lines, strip inline-backtick delimiters (keeping
 * the inner text), then collapse all whitespace to single spaces and trim.
 * Lone backticks are removed along with paired ones. Returns `""` when nothing
 * usable remains (e.g. the reply was only a fenced code block).
 *
 * Pure over its inputs.
 */
export function sanitize(text: string): string {
  const stripped = stripFencedBlocks(text).replaceAll("`", "");
  const kept = stripped
    .split(/\r?\n/)
    .filter((line) => !isNoiseLine(line))
    .join("\n");
  return kept.replace(/\s+/g, " ").trim();
}

// --- Truncation ------------------------------------------------------------

/**
 * Truncate `text` to at most `max` graphemes (grapheme-aware via
 * `Intl.Segmenter`, Node ≥24), appending an ellipsis when cut. Returns `""`
 * for empty input unchanged. When truncated the result is `max` graphemes plus
 * the ellipsis (one grapheme). Pure over its inputs.
 */
export function truncateGraphemes(text: string, max: number): string {
  if (text === "") return "";
  const graphemes = [...GRAPHEME_SEGMENTER.segment(text)];
  if (graphemes.length <= max) return text;
  return `${graphemes
    .slice(0, max)
    .map((g) => g.segment)
    .join("")}${ELLIPSIS}`;
}

// --- Pipeline --------------------------------------------------------------

/**
 * Build the popup body from a session branch: extract the last assistant
 * reply's text, sanitize it, truncate to {@link PREVIEW_GRAPHEMES} graphemes,
 * and fall back to {@link PREVIEW_FALLBACK} when nothing usable remains. Pure
 * over its inputs; the caller reads the branch via `ctx.sessionManager.
 * getBranch()`.
 */
export function buildPreviewBody(entries: readonly SessionEntry[]): string {
  const body = truncateGraphemes(sanitize(extractLastAssistantText(entries)), PREVIEW_GRAPHEMES);
  return body || PREVIEW_FALLBACK;
}
