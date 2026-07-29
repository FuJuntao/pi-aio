/**
 * Notification channels for the notify extension.
 *
 * A channel is a delivery mechanism for a popup notification - a native
 * desktop binary (terminal-notifier, osascript, notify-send, powershell) or a
 * terminal escape sequence (Kitty OSC 99, iTerm2 OSC 9, generic OSC 777).
 *
 * The interesting logic - the exact argv each desktop binary is spawned with
 * and the exact escape bytes each terminal protocol writes - lives in **pure
 * builder functions** (`terminalNotifierArgs`, `osascriptArgs`, `kittySequences`,
 * ...), unit-tested directly with no fakes. The `NotifyChannel.send` /
 * `available` methods are thin impure wrappers over `child_process` /
 * `process.stdout` that hand those builders' output to the OS; they are one-line
 * compositions, exercised end-to-end through pi's real runtime where a binary is
 * reachable and trusted elsewhere. There is no injection seam here.
 */

import { spawn, spawnSync } from "node:child_process";
import { stdout } from "node:process";

/** Payload delivered to a channel. */
export interface NotifyPayload {
  readonly title: string;
  readonly body: string;
}

/** A delivery mechanism for popup notifications. */
export interface NotifyChannel {
  readonly name: string;
  available(): boolean;
  send(payload: NotifyPayload): void;
}

/** Canonical channel identifiers, used by selection logic in `select.ts`. */
export type ChannelKind =
  | "terminal-notifier"
  | "osascript"
  | "notify-send"
  | "powershell"
  | "kitty"
  | "iterm"
  | "osc777";

// --- Pure builders --------------------------------------------------------

/** Quote a string for an AppleScript double-quoted literal. */
export function quoteAppleScript(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** PowerShell WinRT toast script (single-quoted args are escaped by doubling). */
export function windowsToastScript(title: string, body: string): string {
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

/** argv for `terminal-notifier`. */
export function terminalNotifierArgs({ title, body }: NotifyPayload): readonly string[] {
  return ["-title", title, "-message", body, "-sound", "default"];
}

/** argv for `osascript` (a `display notification` AppleScript via `-e`). */
export function osascriptArgs({ title, body }: NotifyPayload): readonly string[] {
  const script =
    `display notification ${quoteAppleScript(body)}` +
    ` with title ${quoteAppleScript(title)}` +
    ` sound name ${quoteAppleScript("default")}`;
  return ["-e", script];
}

/** argv for `notify-send`. */
export function notifySendArgs({ title, body }: NotifyPayload): readonly string[] {
  return ["--urgency", "normal", "--app-name", "pi", title, body];
}

/** argv for `powershell.exe` (the WinRT toast script via `-Command`). */
export function powershellArgs({ title, body }: NotifyPayload): readonly string[] {
  return ["-NoProfile", "-Command", windowsToastScript(title, body)];
}

/**
 * Kitty OSC 99 sequences for a notification: a held title, then the body that
 * completes it. Returned in write order.
 */
export function kittySequences({ title, body }: NotifyPayload): readonly string[] {
  const st = "\x1b\\";
  return [`\x1b]99;i=1:d=0;${title}${st}`, `\x1b]99;i=1:p=body;${body}${st}`];
}

/** iTerm2 OSC 9 sequence (a single `title: body` message). */
export function itermSequence({ title, body }: NotifyPayload): string {
  return `\x1b]9;${title}: ${body}\x07`;
}

/** Generic OSC 777 notify sequence (Ghostty, rxvt, WezTerm, ...). */
export function osc777Sequence({ title, body }: NotifyPayload): string {
  return `\x1b]777;notify;${title};${body}\x07`;
}

// --- Impure delivery ------------------------------------------------------

function spawnDetached(cmd: string, args: readonly string[]): void {
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => {
      // A missing or failing binary must not disturb the session.
    })
    .unref();
}

function probeBinary(cmd: string, args: readonly string[]): boolean {
  const result = spawnSync(cmd, args, { stdio: "ignore", timeout: 2_000 });
  return result.error === undefined && typeof result.status === "number";
}

/** Probe once and cache: availability is queried per kind at startup and never
 *  changes mid-session, so avoid repeated `spawnSync` calls. */
function memoizeAvailability(cmd: string, probeArgs: readonly string[]): () => boolean {
  let cached: boolean | undefined;
  return () => {
    if (cached === undefined) cached = probeBinary(cmd, probeArgs);
    return cached;
  };
}

// --- Channel factories ----------------------------------------------------

function createTerminalNotifierChannel(): NotifyChannel {
  return {
    name: "terminal-notifier",
    available: memoizeAvailability("terminal-notifier", ["-help"]),
    send: (payload) => {
      spawnDetached("terminal-notifier", terminalNotifierArgs(payload));
    },
  };
}

function createOsascriptChannel(): NotifyChannel {
  return {
    name: "osascript",
    available: memoizeAvailability("osascript", ["-e", "1"]),
    send: (payload) => {
      spawnDetached("osascript", osascriptArgs(payload));
    },
  };
}

function createNotifySendChannel(): NotifyChannel {
  return {
    name: "notify-send",
    available: memoizeAvailability("notify-send", ["--version"]),
    send: (payload) => {
      spawnDetached("notify-send", notifySendArgs(payload));
    },
  };
}

function createPowershellChannel(): NotifyChannel {
  return {
    name: "powershell",
    available: memoizeAvailability("powershell.exe", ["-NoProfile", "-Command", "exit"]),
    send: (payload) => {
      spawnDetached("powershell.exe", powershellArgs(payload));
    },
  };
}

function createKittyChannel(): NotifyChannel {
  return {
    name: "kitty",
    available: () => true,
    send: (payload) => {
      for (const seq of kittySequences(payload)) {
        stdout.write(seq);
      }
    },
  };
}

function createItermChannel(): NotifyChannel {
  return {
    name: "iterm",
    available: () => true,
    send: (payload) => {
      stdout.write(itermSequence(payload));
    },
  };
}

function createOsc777Channel(): NotifyChannel {
  return {
    name: "osc777",
    available: () => true,
    send: (payload) => {
      stdout.write(osc777Sequence(payload));
    },
  };
}

/** Build all channel instances. Desktop channels probe their binary on PATH;
 *  terminal channels are always available. */
export function createChannels(): Record<ChannelKind, NotifyChannel> {
  return {
    "terminal-notifier": createTerminalNotifierChannel(),
    osascript: createOsascriptChannel(),
    "notify-send": createNotifySendChannel(),
    powershell: createPowershellChannel(),
    kitty: createKittyChannel(),
    iterm: createItermChannel(),
    osc777: createOsc777Channel(),
  };
}
