/**
 * Notify extension entry point for `@fujuntao/pi-aio`.
 *
 * Delivers cross-platform notifications when pi needs the user - when it settles
 * and is waiting for input (`agent_settled`). The popup body is a short verbatim
 * preview of pi's last assistant reply (sanitized and truncated, falling back
 * to a static string when there's no usable text). It auto-selects a native
 * desktop notification when local - or the terminal's own OSC notification when
 * running inside iTerm2 or Kitty - and a terminal-protocol notification (OSC
 * 777/9/99) over SSH or when no desktop binary is present. A live structural
 * terminal title `Pi · {project} · {activity}` flips to `working` on
 * `agent_start` and `waiting` on `agent_settled`.
 *
 * Gating: the popup fires only when the terminal is **not focused** (the user
 * has switched away); the title is a passive cue and is **not** focus-gated, so
 * it updates on every `agent_start`/`agent_settled` even while the user is
 * watching. Focus is tracked via OSC 1004 focus events in interactive (TUI)
 * mode. If focus cannot be detected - the terminal doesn't speak OSC 1004, or
 * the session is non-interactive - the popup fires regardless (better to
 * over-notify than to swallow a "done" signal). There is no duration threshold.
 *
 * Config: a single `enabled` field in `~/.pi/agent/notify.json` (global) merged
 * with `<cwd>/.pi/notify.json` (project wins). Absent config defaults to
 * enabled.
 *
 * Pure routing/escaping/preview logic lives in `select.ts`, `channels.ts`,
 * `focus.ts`, and `preview.ts`; this module owns the impure seams (spawning,
 * probing, writing OSC, the input listener) and the event wiring. Impure
 * behavior is exercised end-to-end through pi's real runtime in
 * `test/notify-e2e.test.ts` (loaded via `DefaultResourceLoader`, driven by the
 * faux provider); the pure helpers are unit-tested directly. There is no
 * test-injection seam here.
 *
 * Inspired by pi's `examples/extensions/notify.ts`, rewritten to fire on
 * `agent_settled` (not `agent_end`, which fires prematurely during auto-retry /
 * auto-compact-and-retry) and to gate on terminal focus instead of a fixed
 * duration.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { env, platform, stdout } from "node:process";
import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type ChannelKind,
  type NotifyChannel,
  type NotifyPayload,
  createChannels,
} from "./channels.ts";
import { type LoadedConfig, loadConfig } from "./config.ts";
import {
  FOCUS_REPORT_DISABLE,
  FOCUS_REPORT_ENABLE,
  INITIAL_FOCUS_STATE,
  type FocusState,
  stepFocus,
} from "./focus.ts";
import { buildPreviewBody } from "./preview.ts";
import { choosePopupKind, desktopPlatform } from "./select.ts";

// --- Impure seams (real implementations) ----------------------------------

/**
 * Read `/proc/version`, or undefined when unreadable (non-Linux or missing).
 * Fed to `desktopPlatform` so the WSL check resolves without a filesystem hit at
 * module load.
 */
function readProcVersion(): string | undefined {
  try {
    return readFileSync("/proc/version", "utf8");
  } catch {
    return undefined;
  }
}

function pickPopupChannel(): NotifyChannel | undefined {
  const channels = createChannels();
  const kind = choosePopupKind({
    env,
    platform: desktopPlatform({ platform, readProcVersion }),
    isTTY: Boolean(stdout.isTTY),
    desktopAvailable: (k: ChannelKind) => channels[k].available(),
  });
  return kind ? channels[kind] : undefined;
}

function writeOsc(data: string): void {
  stdout.write(data);
}

function loadNotifyConfig(cwd: string): LoadedConfig {
  return loadConfig({ cwd, globalDir: getAgentDir(), configDirName: CONFIG_DIR_NAME });
}

// --- Pure gating ----------------------------------------------------------

/** Inputs to `shouldNotifySettled`. */
export interface ShouldNotifySettledInput {
  readonly enabled: boolean;
  /** Whether the terminal's focus state is known (OSC 1004 observed at least once). */
  readonly focusKnown: boolean;
  /** Whether the terminal is currently focused. */
  readonly focused: boolean;
}

/**
 * Whether a "settled" notification should fire. Requires the extension to be
 * enabled, and either the focus state to be unknown (can't detect -> notify) or
 * the terminal to be unfocused. Pure over its inputs.
 */
export function shouldNotifySettled(input: ShouldNotifySettledInput): boolean {
  if (!input.enabled) return false;
  if (input.focusKnown && input.focused) return false;
  return true;
}

// --- Pure title builder ---------------------------------------------------

/** The two activities the live terminal title reflects. */
export type TitleActivity = "working" | "waiting";

/**
 * Build the live structural terminal title `Pi · {project} · {activity}`, where
 * `{project}` is the basename of the session cwd and `{activity}` is "working"
 * (agent loop running) or "waiting" (settled, awaiting input). Pure over its
 * inputs; the event handlers set it on `agent_start` / `agent_settled`,
 * decoupled from the popup.
 */
export function buildTitle(cwd: string, activity: TitleActivity): string {
  return `Pi · ${basename(cwd)} · ${activity}`;
}

// --- Delivery -------------------------------------------------------------

/** Deliver the popup only. The window title is owned by the event handlers
 *  (see `buildTitle`); this sender no longer sets it.
 *
 *  No bell: iTerm (and other terminals that turn BEL into a notification) would
 *  show a second notification alongside the popup - see #45. Inside iTerm2 or
 *  Kitty the popup is the terminal's native OSC notification (the BEL that
 *  closes an OSC is its string terminator, not a bell); elsewhere a desktop
 *  binary or generic OSC fires. The popup is the only cue this sender emits. */
function sendPopup(payload: NotifyPayload): void {
  const popup = pickPopupChannel();
  if (popup) {
    try {
      popup.send(payload);
    } catch {
      // Fire-and-forget: never let a notification disturb the session.
    }
  }
}

// --- Extension factory ----------------------------------------------------

export default function notifyExtension(pi: Pick<ExtensionAPI, "on">): void {
  let enabled = true;
  let focusState: FocusState = INITIAL_FOCUS_STATE;
  let unsubscribeInput: (() => void) | undefined;
  let focusReportingOn = false;

  pi.on("session_start", (_event, ctx) => {
    const config = loadNotifyConfig(ctx.cwd);
    enabled = config.enabled;
    if (config.warning) {
      ctx.ui.notify(config.warning, "warning");
    }
    // A disabled extension must be inert: no terminal mode change, no input
    // parsing. Config is still re-read above so a later /reload can re-enable.
    if (!enabled) return;
    // Focus detection only works in interactive TTY mode, where pi feeds raw
    // terminal input to onTerminalInput. Elsewhere focusState stays at its
    // initial "unknown" value, which means "notify" per the gating rule.
    if (ctx.mode !== "tui") return;
    if (unsubscribeInput) {
      unsubscribeInput();
      unsubscribeInput = undefined;
    }
    focusState = INITIAL_FOCUS_STATE;
    writeOsc(FOCUS_REPORT_ENABLE);
    focusReportingOn = true;
    unsubscribeInput = ctx.ui.onTerminalInput((data) => {
      const step = stepFocus(focusState, data);
      focusState = step.state;
      return step.result;
    });
  });

  pi.on("session_shutdown", () => {
    if (unsubscribeInput) {
      unsubscribeInput();
      unsubscribeInput = undefined;
    }
    if (focusReportingOn) {
      writeOsc(FOCUS_REPORT_DISABLE);
      focusReportingOn = false;
    }
    focusState = INITIAL_FOCUS_STATE;
  });

  pi.on("agent_start", (_event, ctx) => {
    // A disabled extension is fully inert: no title updates either.
    if (!enabled) return;
    ctx.ui.setTitle(buildTitle(ctx.cwd, "working"));
  });

  pi.on("agent_settled", (_event, ctx) => {
    // A disabled extension is fully inert: no title updates either.
    if (!enabled) return;
    // The title is a passive cue, useful while watching too, so it is NOT
    // focus-gated: it flips to "waiting" on every settle regardless of focus.
    ctx.ui.setTitle(buildTitle(ctx.cwd, "waiting"));
    // The popup is focus-gated (only when the user has stepped away, or focus
    // is unknown) and now carries a verbatim preview of pi's last reply.
    if (
      !shouldNotifySettled({
        enabled,
        focusKnown: focusState.focusKnown,
        focused: focusState.focused,
      })
    ) {
      return;
    }
    sendPopup({ title: "Pi", body: buildPreviewBody(ctx.sessionManager.getBranch()) });
  });
}
