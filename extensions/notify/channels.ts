/**
 * Notification channels for the notify extension.
 *
 * A channel is a delivery mechanism for a popup notification - a native
 * desktop binary (terminal-notifier, osascript, notify-send, powershell) or a
 * terminal escape sequence (Kitty OSC 99, iTerm2 OSC 9, generic OSC 777). This
 * module defines the `NotifyChannel` interface, pure helpers for the command
 * strings each backend needs, and factory functions that wire real (or fake)
 * spawn/probe/write implementations. Keeping the impure seams injectable is
 * what lets `channels.test.ts` assert exact argv and escape sequences without
 * ever spawning a real process.
 */

/** Urgency level for a notification. */
export type NotifyUrgency = "info" | "error";

/** Payload delivered to a channel. */
export interface NotifyPayload {
  readonly title: string;
  readonly body: string;
  readonly urgency: NotifyUrgency;
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

/** Impure seams injected into channel factories. */
export interface ChannelDeps {
  /** Fire a command without blocking or keeping the event loop alive. */
  readonly spawn: (cmd: string, args: readonly string[]) => void;
  /** Probe whether a command exists on PATH. */
  readonly probe: (cmd: string, args: readonly string[]) => boolean;
  /** Write raw bytes to the terminal (OSC sequences). */
  readonly write: (data: string) => void;
}

// --- Pure helpers ---------------------------------------------------------

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

// --- Memoized availability ------------------------------------------------

function memoizeAvailability(
  deps: ChannelDeps,
  cmd: string,
  probeArgs: readonly string[],
): () => boolean {
  let cached: boolean | undefined;
  return () => {
    if (cached === undefined) cached = deps.probe(cmd, probeArgs);
    return cached;
  };
}

// --- Channel factories ----------------------------------------------------

export function createTerminalNotifierChannel(deps: ChannelDeps): NotifyChannel {
  return {
    name: "terminal-notifier",
    available: memoizeAvailability(deps, "terminal-notifier", ["-help"]),
    send({ title, body, urgency }) {
      deps.spawn("terminal-notifier", [
        "-title",
        title,
        "-message",
        body,
        "-sound",
        urgency === "error" ? "Basso" : "default",
      ]);
    },
  };
}

export function createOsascriptChannel(deps: ChannelDeps): NotifyChannel {
  return {
    name: "osascript",
    available: memoizeAvailability(deps, "osascript", ["-e", "1"]),
    send({ title, body, urgency }) {
      const sound = urgency === "error" ? "Basso" : "default";
      const script =
        `display notification ${quoteAppleScript(body)}` +
        ` with title ${quoteAppleScript(title)}` +
        ` sound name ${quoteAppleScript(sound)}`;
      deps.spawn("osascript", ["-e", script]);
    },
  };
}

export function createNotifySendChannel(deps: ChannelDeps): NotifyChannel {
  return {
    name: "notify-send",
    available: memoizeAvailability(deps, "notify-send", ["--version"]),
    send({ title, body, urgency }) {
      deps.spawn("notify-send", [
        "--urgency",
        urgency === "error" ? "critical" : "normal",
        "--app-name",
        "pi",
        title,
        body,
      ]);
    },
  };
}

export function createPowershellChannel(deps: ChannelDeps): NotifyChannel {
  return {
    name: "powershell",
    available: memoizeAvailability(deps, "powershell.exe", ["-NoProfile", "-Command", "exit"]),
    send({ title, body }) {
      deps.spawn("powershell.exe", ["-NoProfile", "-Command", windowsToastScript(title, body)]);
    },
  };
}

export function createKittyChannel(deps: ChannelDeps): NotifyChannel {
  return {
    name: "kitty",
    available: () => true,
    send({ title, body }) {
      // Kitty OSC 99: title (held) then body (completes the notification).
      const st = "\x1b\\";
      deps.write(`\x1b]99;i=1:d=0;${title}${st}`);
      deps.write(`\x1b]99;i=1:p=body;${body}${st}`);
    },
  };
}

export function createItermChannel(deps: ChannelDeps): NotifyChannel {
  return {
    name: "iterm",
    available: () => true,
    send({ title, body }) {
      // iTerm2 OSC 9 takes a single message string.
      deps.write(`\x1b]9;${title}: ${body}\x07`);
    },
  };
}

export function createOsc777Channel(deps: ChannelDeps): NotifyChannel {
  return {
    name: "osc777",
    available: () => true,
    send({ title, body }) {
      // Generic OSC 777 (Ghostty, rxvt, WezTerm, ...).
      deps.write(`\x1b]777;notify;${title};${body}\x07`);
    },
  };
}

/** Build all channel instances for a given set of impure deps. */
export function createChannels(deps: ChannelDeps): Record<ChannelKind, NotifyChannel> {
  return {
    "terminal-notifier": createTerminalNotifierChannel(deps),
    osascript: createOsascriptChannel(deps),
    "notify-send": createNotifySendChannel(deps),
    powershell: createPowershellChannel(deps),
    kitty: createKittyChannel(deps),
    iterm: createItermChannel(deps),
    osc777: createOsc777Channel(deps),
  };
}
