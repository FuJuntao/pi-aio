/**
 * Notify extension entry point for `@fujuntao/pi-aio`.
 *
 * Delivers cross-platform notifications when pi needs the user - when it settles
 * and is waiting for input (`agent_settled`) and when a tool errors
 * (`tool_result` with `isError`). It auto-selects a native desktop notification
 * when local, or a terminal-protocol notification (OSC 777/9/99) over SSH or
 * when no desktop binary is present - plus a bell and window-title cue.
 *
 * Gating: a "settled" notification fires only when the terminal is **not
 * focused** (the user has switched away). Focus is tracked via OSC 1004 focus
 * events in interactive (TUI) mode. If focus cannot be detected - the terminal
 * doesn't speak OSC 1004, or the session is non-interactive - the notification
 * fires regardless (better to over-notify than to swallow a "done" signal).
 * Tool errors are never focus-gated; they always surface. There is no duration
 * threshold.
 *
 * Config: a single `enabled` field in `~/.pi/agent/notify.json` (global) merged
 * with `<cwd>/.pi/notify.json` (project wins). Absent config defaults to
 * enabled.
 *
 * Pure routing/escaping logic lives in `select.ts`, `channels.ts`, and
 * `focus.ts`; this module owns the impure seams (spawning, probing, writing OSC,
 * the input listener) and the event wiring. `NotifyDeps` lets tests inject
 * fakes for those seams.
 *
 * Inspired by pi's `examples/extensions/notify.ts`, rewritten to fire on
 * `agent_settled` (not `agent_end`, which fires prematurely during auto-retry /
 * auto-compact-and-retry) and to gate on terminal focus instead of a fixed
 * duration.
 */

import { spawn, spawnSync } from "node:child_process";
import { env, platform, stdout } from "node:process";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type ChannelDeps,
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
import { choosePopupKind } from "./select.ts";

/** Impure seams. Tests inject fakes; production uses the real defaults. */
export interface NotifyDeps {
  readonly loadConfig: (cwd: string) => LoadedConfig;
  readonly pickPopupChannel: () => NotifyChannel | undefined;
  readonly ringBell: () => void;
  /** Write a raw OSC control sequence to the terminal (e.g. focus-reporting enable). */
  readonly writeOsc: (data: string) => void;
}

// --- Real impure implementations ------------------------------------------

function realSpawnDetached(cmd: string, args: readonly string[]): void {
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => {
      // A missing or failing binary must not disturb the session.
    })
    .unref();
}

function realProbe(cmd: string, args: readonly string[]): boolean {
  const result = spawnSync(cmd, args, { stdio: "ignore", timeout: 2_000 });
  return result.error === undefined && typeof result.status === "number";
}

function realChannelDeps(): ChannelDeps {
  return {
    spawn: realSpawnDetached,
    probe: realProbe,
    write: (data) => {
      stdout.write(data);
    },
  };
}

function realPickPopupChannel(): NotifyChannel | undefined {
  const channels = createChannels(realChannelDeps());
  const kind = choosePopupKind({
    env,
    platform,
    isTTY: Boolean(stdout.isTTY),
    desktopAvailable: (k: ChannelKind) => channels[k].available(),
  });
  return kind ? channels[kind] : undefined;
}

function realRingBell(): void {
  if (stdout.isTTY) {
    stdout.write("\x07");
  }
}

function realWriteOsc(data: string): void {
  stdout.write(data);
}

function realLoadConfig(cwd: string): LoadedConfig {
  return loadConfig({ cwd, globalDir: getAgentDir(), configDirName: CONFIG_DIR_NAME });
}

function defaultDeps(): NotifyDeps {
  return {
    loadConfig: realLoadConfig,
    pickPopupChannel: realPickPopupChannel,
    ringBell: realRingBell,
    writeOsc: realWriteOsc,
  };
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

// --- Delivery -------------------------------------------------------------

/** Deliver the popup plus the ambient bell and window-title cue. */
function notify(ctx: ExtensionContext, payload: NotifyPayload, deps: NotifyDeps): void {
  const popup = deps.pickPopupChannel();
  if (popup) {
    try {
      popup.send(payload);
    } catch {
      // Fire-and-forget: never let a notification disturb the session.
    }
  }
  deps.ringBell();
  ctx.ui.setTitle(`Pi: ${payload.body}`);
}

// --- Extension factory ----------------------------------------------------

export default function notifyExtension(
  pi: Pick<ExtensionAPI, "on">,
  deps?: Partial<NotifyDeps>,
): void {
  const base = defaultDeps();
  const d: NotifyDeps = {
    loadConfig: deps?.loadConfig ?? base.loadConfig,
    pickPopupChannel: deps?.pickPopupChannel ?? base.pickPopupChannel,
    ringBell: deps?.ringBell ?? base.ringBell,
    writeOsc: deps?.writeOsc ?? base.writeOsc,
  };
  let enabled = true;
  let focusState: FocusState = INITIAL_FOCUS_STATE;
  let unsubscribeInput: (() => void) | undefined;
  let focusReportingOn = false;

  pi.on("session_start", (_event, ctx) => {
    const config = d.loadConfig(ctx.cwd);
    enabled = config.enabled;
    if (config.warning) {
      ctx.ui.notify(config.warning, "warning");
    }
    // Focus detection only works in interactive TTY mode, where pi feeds raw
    // terminal input to onTerminalInput. Elsewhere focusState stays at its
    // initial "unknown" value, which means "notify" per the gating rule.
    if (ctx.mode !== "tui") return;
    if (unsubscribeInput) {
      unsubscribeInput();
      unsubscribeInput = undefined;
    }
    focusState = INITIAL_FOCUS_STATE;
    d.writeOsc(FOCUS_REPORT_ENABLE);
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
      d.writeOsc(FOCUS_REPORT_DISABLE);
      focusReportingOn = false;
    }
    focusState = INITIAL_FOCUS_STATE;
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (
      !shouldNotifySettled({
        enabled,
        focusKnown: focusState.focusKnown,
        focused: focusState.focused,
      })
    ) {
      return;
    }
    notify(ctx, { title: "Pi", body: "Finished - waiting for input", urgency: "info" }, d);
  });

  pi.on("tool_result", (event, ctx) => {
    if (!enabled) return;
    if (!event.isError) return;
    notify(ctx, { title: "Pi", body: `Tool "${event.toolName}" failed`, urgency: "error" }, d);
  });
}
