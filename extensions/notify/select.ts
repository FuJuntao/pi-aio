/**
 * Pure channel-selection logic for the notify extension.
 *
 * Every function here is a pure decision over injectable inputs (env vars,
 * platform string, TTY flag, availability probe callback). The impure
 * gathering of those inputs lives in `index.ts`. This split keeps the routing
 * rules - "SSH prefers terminal protocols", "Linux needs DISPLAY/WAYLAND",
 * "Kitty before generic OSC 777" - unit-testable without spawning or TTYs.
 */

import type { ChannelKind } from "./channels.ts";

/** True when the session is running over SSH (`SSH_CONNECTION` or `SSH_TTY` set). */
export function isOverSsh(env: Record<string, string | undefined>): boolean {
  return Boolean(env["SSH_CONNECTION"]) || Boolean(env["SSH_TTY"]);
}

/**
 * Whether a graphical/dbus session is present. `notify-send` needs one on
 * Linux; macOS/Windows always have one when their binary is available.
 */
export function desktopSessionPresent(
  platform: string,
  env: Record<string, string | undefined>,
): boolean {
  if (platform === "linux") {
    return Boolean(env["DISPLAY"]) || Boolean(env["WAYLAND_DISPLAY"]);
  }
  return true;
}

/**
 * Pick the terminal-protocol channel kind for the current terminal, or
 * undefined when stdout is not a TTY. Kitty is preferred over iTerm2, which is
 * preferred over the generic OSC 777.
 */
export function chooseTerminalKind(
  env: Record<string, string | undefined>,
  isTTY: boolean,
): ChannelKind | undefined {
  if (!isTTY) return undefined;
  if (env["KITTY_WINDOW_ID"]) return "kitty";
  if (env["ITERM_SESSION_ID"]) return "iterm";
  return "osc777";
}

/**
 * Preferred desktop channel kinds for a platform, in fallback order. Darwin
 * prefers `terminal-notifier` and falls back to `osascript`; Linux uses
 * `notify-send`; Windows uses `powershell`. Unknown platforms have no desktop
 * channel.
 */
export function chooseDesktopKind(platform: string): readonly ChannelKind[] {
  switch (platform) {
    case "darwin": {
      return ["terminal-notifier", "osascript"];
    }
    case "linux": {
      return ["notify-send"];
    }
    case "win32": {
      return ["powershell"];
    }
    default: {
      return [];
    }
  }
}

/** Inputs to `choosePopupKind`. */
export interface PopupSelectionInput {
  readonly env: Record<string, string | undefined>;
  readonly platform: string;
  readonly isTTY: boolean;
  /** True when running under WSL (Linux kernel with a Windows desktop reachable via interop). */
  readonly wsl: boolean;
  /** True when the given desktop channel's binary is available on PATH. */
  readonly desktopAvailable: (kind: ChannelKind) => boolean;
}

/**
 * Pick exactly one popup channel kind: a native desktop notification when
 * local and a binary is present, otherwise a terminal-protocol notification.
 * Never both. Returns undefined when no suitable channel exists (e.g. not a
 * TTY and no desktop binary).
 *
 * WSL reports `platform === "linux"` but exposes `powershell.exe` via interop
 * and has no Linux display server (unless WSLg). Without WSL handling it would
 * try `notify-send` (absent) and fall through to OSC 777, which Windows
 * Terminal does not support - so no notification ever appears. Mapping WSL to
 * a Windows desktop picks the PowerShell toast instead, which fires a real
 * Windows notification through interop.
 */
export function choosePopupKind(input: PopupSelectionInput): ChannelKind | undefined {
  const terminalKind = chooseTerminalKind(input.env, input.isTTY);
  if (isOverSsh(input.env)) return terminalKind;

  const desktopPlatform = input.wsl && input.platform === "linux" ? "win32" : input.platform;
  for (const kind of chooseDesktopKind(desktopPlatform)) {
    if (input.desktopAvailable(kind) && desktopSessionPresent(desktopPlatform, input.env)) {
      return kind;
    }
  }
  return terminalKind;
}
