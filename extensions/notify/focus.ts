/**
 * Focus detection for the notify extension.
 *
 * The extension enables OSC 1004 focus reporting (`\x1b[?1004h`), after which
 * the terminal emits `\x1b[I` when the window gains focus and `\x1b[O` when it
 * loses it. Those bytes arrive on stdin alongside ordinary user input, so this
 * module owns two pure jobs:
 *
 * - `parseFocusEvents` strips focus sequences out of a chunk of raw input,
 *   tolerating sequences split across chunks and leaving every other escape
 *   (arrows, OSC, SS3, the lone Escape key) untouched.
 * - `stepFocus` runs that parser against a small state machine and yields the
 *   `onTerminalInput` return value that tells pi what (if anything) to keep.
 *
 * Keeping this pure lets `focus.test.ts` assert exact chunking and escaping
 * without a TTY. The impure seams (writing the enable/disable sequence,
 * registering the input listener) live in `index.ts`.
 */

/** OSC 1004 focus-reporting mode enable sequence. */
export const FOCUS_REPORT_ENABLE = "\x1b[?1004h";
/** OSC 1004 focus-reporting mode disable sequence. */
export const FOCUS_REPORT_DISABLE = "\x1b[?1004l";

/** A focus transition reported by the terminal. */
export type FocusEvent = "focus-in" | "focus-out";

/** Result of stripping focus sequences from one chunk of input. */
export interface FocusParseResult {
  /** Input with focus sequences removed; pass this through to the TUI. */
  readonly output: string;
  /** Buffered partial escape (a trailing `\x1b[`) to prepend to the next chunk. */
  readonly pending: string;
  /** Focus transitions found in this chunk, in order. */
  readonly events: readonly FocusEvent[];
}

const FOCUS_IN = "\x1b[I";
const FOCUS_OUT = "\x1b[O";

/**
 * Strip OSC 1004 focus sequences from a chunk of raw terminal input. `pending`
 * carries a partial `\x1b[` left over from the previous chunk so a focus event
 * split across chunks is still recognised. Other escape sequences (arrow keys,
 * OSC, SS3) and a lone Escape key pass through verbatim - only `\x1b[I` and
 * `\x1b[O` are ever removed.
 */
export function parseFocusEvents(input: string, pending: string): FocusParseResult {
  const s = pending + input;
  const events: FocusEvent[] = [];
  let out = "";
  let i = 0;
  const n = s.length;
  while (i < n) {
    if (s[i] === "\x1b") {
      if (s.startsWith(FOCUS_IN, i)) {
        events.push("focus-in");
        i += 3;
        continue;
      }
      if (s.startsWith(FOCUS_OUT, i)) {
        events.push("focus-out");
        i += 3;
        continue;
      }
      // A trailing "\x1b[" with no terminator yet: buffer it so a focus event
      // split across chunks is completed on the next call. A lone "\x1b" is NOT
      // buffered - it may be the Escape key, which must reach the TUI promptly.
      if (s[i + 1] === "[" && i + 2 === n) {
        return { output: out, pending: "\x1b[", events };
      }
    }
    out += s[i];
    i++;
  }
  return { output: out, pending: "", events };
}

/** Focus tracker state, evolved by `stepFocus`. */
export interface FocusState {
  /** Last reported focus. Defaults to true (assume present) until contradicted. */
  readonly focused: boolean;
  /** Whether any focus event has ever been observed (i.e. OSC 1004 is supported). */
  readonly focusKnown: boolean;
  /** Buffered partial escape carried across input chunks. */
  readonly pending: string;
}

/** Fresh state: focused, no focus events seen yet, nothing buffered. */
export const INITIAL_FOCUS_STATE: FocusState = {
  focused: true,
  focusKnown: false,
  pending: "",
};

/** Return value shape expected by pi's `onTerminalInput` handler. */
export type TerminalInputResult = { consume?: boolean; data?: string } | undefined;

/** Result of stepping the focus state with one chunk of input. */
export interface FocusStepResult {
  readonly state: FocusState;
  /** What to tell pi about this chunk: consume it, replace it, or pass it through. */
  readonly result: TerminalInputResult;
}

/**
 * Advance focus state with a chunk of raw terminal input and decide what pi
 * should do with the chunk. Focus sequences are consumed (pi never sees them);
 * everything else passes through unchanged. When a partial `\x1b[` is buffered,
 * the already-reassembled remainder is handed back via `result.data` so pi does
 * not double-process the buffered bytes.
 */
export function stepFocus(state: FocusState, data: string): FocusStepResult {
  const parsed = parseFocusEvents(data, state.pending);
  let focused = state.focused;
  let focusKnown = state.focusKnown;
  for (const event of parsed.events) {
    focused = event === "focus-in";
    focusKnown = true;
  }
  const nextState: FocusState = {
    focused,
    focusKnown,
    pending: parsed.pending,
  };
  const touched = state.pending !== "" || parsed.events.length > 0 || parsed.pending !== "";
  let result: TerminalInputResult;
  if (!touched) {
    result = undefined;
  } else if (parsed.output.length === 0) {
    result = { consume: true };
  } else {
    result = { data: parsed.output };
  }
  return { state: nextState, result };
}
