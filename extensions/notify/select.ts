/**
 * Pure channel-selection logic for the notify extension.
 *
 * Every function here is a pure decision over injectable inputs (env vars,
 * platform string, TTY flag, availability probe callback). The impure
 * gathering of those inputs lives in `index.ts`. This split keeps the routing
 * rules - "SSH uses terminal protocols only", "a detected terminal protocol
 * (iTerm2/Kitty) wins over a desktop binary locally", "Linux needs
 * DISPLAY/WAYLAND", "Kitty before iTerm2 before generic OSC 777" -
 * unit-testable without spawning or TTYs.
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
 * undefined when stdout is not a TTY. Kitty and iTerm2 are detected via env
 * vars; OSC 777 is the generic fallback for any other TTY. `choosePopupKind`
 * prefers the detected kinds over a desktop binary, but treats OSC 777 as a
 * last resort (see `isDetectedTerminalKind`).
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

/** Inputs to `desktopPlatform`. */
export interface DesktopPlatformInput {
  /** The raw `process.platform` value. */
  readonly platform: string;
  /**
   * Reads `/proc/version` contents, or undefined when unreadable (non-Linux or
   * a missing file). Injected so the WSL check is unit-testable without a
   * filesystem.
   */
  readonly readProcVersion: () => string | undefined;
}

/**
 * The platform to use for desktop-channel selection. WSL reports `"linux"` but
 * its desktop is Windows (`powershell.exe` is reachable via interop, with no
 * Linux display server unless WSLg), so resolve it to `"win32"` - otherwise
 * `choosePopupKind` would try `notify-send` (absent) and fall through to OSC
 * 777, which Windows Terminal does not support in stable, producing no
 * notification. Detected from `/proc/version`, which mentions "microsoft" on
 * WSL 1 and 2. Pure over its inputs; the caller injects the file read.
 */
export function desktopPlatform(input: DesktopPlatformInput): string {
  if (input.platform !== "linux") return input.platform;
  const procVersion = input.readProcVersion();
  if (procVersion === undefined) return input.platform;
  return /microsoft/i.test(procVersion) ? "win32" : input.platform;
}

/** Inputs to `choosePopupKind`. */
export interface PopupSelectionInput {
  readonly env: Record<string, string | undefined>;
  readonly platform: string;
  readonly isTTY: boolean;
  /** True when the given desktop channel's binary is available on PATH. */
  readonly desktopAvailable: (kind: ChannelKind) => boolean;
}

/**
 * Whether `kind` is a terminal protocol backed by a reliable env-var detection
 * (iTerm2 via `ITERM_SESSION_ID`, Kitty via `KITTY_WINDOW_ID`), as opposed to
 * the generic OSC 777 returned for any other TTY. Detected protocols are
 * preferred over a desktop binary locally; the generic OSC 777 is only a last
 * resort, since Terminal.app and Windows Terminal ignore it.
 */
function isDetectedTerminalKind(kind: ChannelKind | undefined): boolean {
  return kind === "iterm" || kind === "kitty";
}

/**
 * Pick exactly one popup channel kind by ordered preference:
 *
 * 1. Over SSH, a terminal protocol is the only option - the remote desktop
 *    can't reach the user - so a detected protocol (iTerm2/Kitty) or, failing
 *    that, the generic OSC 777 on a TTY.
 * 2. Locally, a *detected* terminal protocol (iTerm2 OSC 9, Kitty OSC 99) wins
 *    over a desktop binary: it's delivered by the terminal the user is in and
 *    spawns no process (#45 - the bell that used to be the "iTerm notification"
 *    was removed; OSC 9 is the terminal's own native notification).
 * 3. Then a platform desktop binary (`terminal-notifier`/`osascript`,
 *    `notify-send`, `powershell`) when one is on PATH and a session is present.
 * 4. Finally the generic OSC 777 as a last resort on a TTY.
 *
 * Never both a terminal protocol and a desktop binary. The generic OSC 777 is
 * deliberately not preferred over a desktop binary: Terminal.app and Windows
 * Terminal ignore it, so a desktop popup must win there. Returns undefined when
 * nothing applies (e.g. not a TTY and no desktop binary). `platform` is the
 * desktop-effective platform; the caller resolves WSL (which reports "linux"
 * but has a Windows desktop) to "win32" before calling.
 */
export function choosePopupKind(input: PopupSelectionInput): ChannelKind | undefined {
  const terminalKind = chooseTerminalKind(input.env, input.isTTY);

  if (isOverSsh(input.env)) return terminalKind;
  if (isDetectedTerminalKind(terminalKind)) return terminalKind;

  for (const kind of chooseDesktopKind(input.platform)) {
    if (input.desktopAvailable(kind) && desktopSessionPresent(input.platform, input.env)) {
      return kind;
    }
  }
  return terminalKind;
}
