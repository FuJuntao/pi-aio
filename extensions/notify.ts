/**
 * Notify extension for `@fujuntao/pi-aio`.
 *
 * Delivers cross-platform notifications when pi needs the user - when it settles
 * and is waiting for input (`agent_settled`) and when a tool errors
 * (`tool_result` with `isError`). It auto-selects a native desktop notification
 * when local, or a terminal-protocol notification (OSC 777/9/99) over SSH or
 * when no desktop binary is present - plus a bell and window-title cue. A 10s
 * minimum-duration threshold keeps quick turns quiet.
 *
 * Config: a single `enabled` field in `~/.pi/agent/notify.json` (global) merged
 * with `<cwd>/.pi/notify.json` (project wins). Absent config defaults to
 * enabled.
 *
 * Inspired by pi's `examples/extensions/notify.ts`, rewritten to fire on
 * `agent_settled` (not `agent_end`, which fires prematurely during auto-retry /
 * auto-compact-and-retry) and to add macOS/Linux native notifications plus
 * min-duration gating.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env, platform, stdout } from "node:process";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

/** Minimum agent-run duration (ms) before a "settled" notification fires. */
const MIN_DURATION_MS = 10_000;

interface NotifyPayload {
  readonly title: string;
  readonly body: string;
  readonly urgency: "info" | "error";
}

interface NotifyChannel {
  readonly name: string;
  available(): boolean;
  send(payload: NotifyPayload): void;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface NotifyConfig {
  enabled?: unknown;
}

interface LoadedConfig {
  enabled: boolean;
  warning: string | undefined;
}

/**
 * Load `enabled` from config files. Project-local (`<cwd>/.pi/notify.json`)
 * overrides global (`~/.pi/agent/notify.json`); absent config defaults to
 * enabled. A malformed file falls back to enabled and surfaces a warning.
 */
function loadConfig(cwd: string): LoadedConfig {
  const globalPath = join(getAgentDir(), "notify.json");
  const projectPath = join(cwd, CONFIG_DIR_NAME, "notify.json");
  let merged: NotifyConfig = {};
  let warning: string | undefined;

  for (const path of [globalPath, projectPath]) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
      if (parsed !== null && typeof parsed === "object") {
        merged = { ...merged, ...(parsed as NotifyConfig) };
      } else {
        warning = `notify: ${path} is not a JSON object; ignoring it`;
      }
    } catch (error) {
      warning = `notify: failed to parse ${path}: ${(error as Error).message}`;
    }
  }

  return { enabled: merged.enabled !== false, warning };
}

// ---------------------------------------------------------------------------
// Desktop channels
// ---------------------------------------------------------------------------

/** True when `cmd` exists on PATH (probed once, then memoized by the caller). */
function probeAvailable(cmd: string, probeArgs: readonly string[]): boolean {
  const result = spawnSync(cmd, probeArgs, { stdio: "ignore", timeout: 2_000 });
  return result.error === undefined && typeof result.status === "number";
}

function memoizeAvailability(cmd: string, probeArgs: readonly string[]): () => boolean {
  let cached: boolean | undefined;
  return () => {
    if (cached === undefined) cached = probeAvailable(cmd, probeArgs);
    return cached;
  };
}

/** Fire a notification binary without blocking or keeping the event loop alive. */
function spawnDetached(cmd: string, args: readonly string[]): void {
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => {
      // A missing or failing binary must not disturb the session.
    })
    .unref();
}

/** Quote a string for an AppleScript double-quoted literal. */
function quoteAppleScript(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

const terminalNotifierChannel: NotifyChannel = {
  name: "terminal-notifier",
  available: memoizeAvailability("terminal-notifier", ["-help"]),
  send({ title, body, urgency }) {
    spawnDetached("terminal-notifier", [
      "-title",
      title,
      "-message",
      body,
      "-sound",
      urgency === "error" ? "Basso" : "default",
    ]);
  },
};

const osascriptChannel: NotifyChannel = {
  name: "osascript",
  available: memoizeAvailability("osascript", ["-e", "1"]),
  send({ title, body, urgency }) {
    const sound = urgency === "error" ? "Basso" : "default";
    const script =
      `display notification ${quoteAppleScript(body)}` +
      ` with title ${quoteAppleScript(title)}` +
      ` sound name ${quoteAppleScript(sound)}`;
    spawnDetached("osascript", ["-e", script]);
  },
};

const notifySendChannel: NotifyChannel = {
  name: "notify-send",
  available: memoizeAvailability("notify-send", ["--version"]),
  send({ title, body, urgency }) {
    spawnDetached("notify-send", [
      "--urgency",
      urgency === "error" ? "critical" : "normal",
      "--app-name",
      "pi",
      title,
      body,
    ]);
  },
};

/** PowerShell WinRT toast script (single-quoted args are escaped by doubling). */
function windowsToastScript(title: string, body: string): string {
  const type = "Windows.UI.Notifications";
  const app = title.replaceAll("'", "''");
  const message = body.replaceAll("'", "''");
  return [
    `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime] > $null`,
    `$xml = [${type}.ToastNotificationManager]::GetTemplateContent([${type}.ToastTemplateType]::ToastText01)`,
    `$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${message}')) > $null`,
    `[${type}.ToastNotificationManager]::CreateToastNotifier('${app}').Show([${type}.ToastNotification]::new($xml))`,
  ].join("; ");
}

const powershellChannel: NotifyChannel = {
  name: "powershell",
  available: memoizeAvailability("powershell.exe", ["-NoProfile", "-Command", "exit"]),
  send({ title, body }) {
    spawnDetached("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(title, body)]);
  },
};

// ---------------------------------------------------------------------------
// Terminal-protocol channels (require a TTY)
// ---------------------------------------------------------------------------

const kittyChannel: NotifyChannel = {
  name: "kitty-osc99",
  available: () => true,
  send({ title, body }) {
    // Kitty OSC 99: title (held) then body (completes the notification).
    const st = "\x1b\\";
    stdout.write(`\x1b]99;i=1:d=0;${title}${st}`);
    stdout.write(`\x1b]99;i=1:p=body;${body}${st}`);
  },
};

const itermChannel: NotifyChannel = {
  name: "iterm2-osc9",
  available: () => true,
  send({ title, body }) {
    // iTerm2 OSC 9 takes a single message string.
    stdout.write(`\x1b]9;${title}: ${body}\x07`);
  },
};

const osc777Channel: NotifyChannel = {
  name: "osc777",
  available: () => true,
  send({ title, body }) {
    // Generic OSC 777 (Ghostty, rxvt, WezTerm, ...).
    stdout.write(`\x1b]777;notify;${title};${body}\x07`);
  },
};

// ---------------------------------------------------------------------------
// Channel selection
// ---------------------------------------------------------------------------

function isOverSsh(): boolean {
  return Boolean(env["SSH_CONNECTION"]) || Boolean(env["SSH_TTY"]);
}

/**
 * Whether a graphical/dbus session is present. `notify-send` needs one on
 * Linux; macOS/Windows always have one when their binary is available.
 */
function desktopSessionPresent(): boolean {
  if (platform === "linux") {
    return Boolean(env["DISPLAY"]) || Boolean(env["WAYLAND_DISPLAY"]);
  }
  return true;
}

function desktopChannelForPlatform(): NotifyChannel | undefined {
  switch (platform) {
    case "darwin": {
      return terminalNotifierChannel.available() ? terminalNotifierChannel : osascriptChannel;
    }
    case "linux": {
      return notifySendChannel;
    }
    case "win32": {
      return powershellChannel;
    }
    default: {
      return undefined;
    }
  }
}

function pickTerminalChannel(): NotifyChannel | undefined {
  if (!stdout.isTTY) return undefined;
  if (env["KITTY_WINDOW_ID"]) return kittyChannel;
  if (env["ITERM_SESSION_ID"]) return itermChannel;
  return osc777Channel;
}

/**
 * Pick exactly one popup channel: a native desktop notification when local and
 * a binary is present, otherwise a terminal-protocol notification. Never both.
 */
function pickPopupChannel(): NotifyChannel | undefined {
  if (isOverSsh()) return pickTerminalChannel();
  const desktop = desktopChannelForPlatform();
  if (desktop && desktop.available() && desktopSessionPresent()) {
    return desktop;
  }
  return pickTerminalChannel();
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

function ringBell(): void {
  if (stdout.isTTY) {
    stdout.write("\x07");
  }
}

/** Deliver the popup plus the ambient bell and window-title cue. */
function notify(ctx: ExtensionContext, payload: NotifyPayload): void {
  const popup = pickPopupChannel();
  if (popup) {
    try {
      popup.send(payload);
    } catch {
      // Fire-and-forget: never let a notification disturb the session.
    }
  }
  ringBell();
  ctx.ui.setTitle(`Pi: ${payload.body}`);
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function notifyExtension(pi: ExtensionAPI): void {
  let enabled = true;
  let runStartTime: number | undefined;

  pi.on("session_start", (_event, ctx) => {
    const config = loadConfig(ctx.cwd);
    enabled = config.enabled;
    if (config.warning) {
      ctx.ui.notify(config.warning, "warning");
    }
  });

  pi.on("agent_start", () => {
    // Capture the baseline once per agent run. Retries re-fire agent_start
    // but must not reset it, so the duration reflects total user wait time.
    if (runStartTime === undefined) {
      runStartTime = Date.now();
    }
  });

  pi.on("agent_settled", (_event, ctx) => {
    const startedAt = runStartTime;
    runStartTime = undefined;
    if (!enabled) return;
    if (startedAt === undefined) return;
    if (Date.now() - startedAt < MIN_DURATION_MS) return;
    notify(ctx, {
      title: "Pi",
      body: "Finished - waiting for input",
      urgency: "info",
    });
  });

  pi.on("tool_result", (event, ctx) => {
    if (!enabled) return;
    if (!event.isError) return;
    notify(ctx, {
      title: "Pi",
      body: `Tool "${event.toolName}" failed`,
      urgency: "error",
    });
  });
}
