import { expect, test } from "vitest";

import {
  chooseDesktopKind,
  choosePopupKind,
  desktopPlatform,
} from "../extensions/notify/select.ts";

// The notify extension picks exactly one popup channel per event. This file
// pins that decision as a platform -> channel table - "on platform X under
// condition Y, the extension uses channel Z" - mirroring the README's "How it
// notifies" matrix. WSL is folded in end-to-end: a row states the raw
// `process.platform` ("linux" on WSL) plus a WSL flag, and the test runs it
// through `desktopPlatform` (WSL resolution) then `choosePopupKind`, so "WSL ->
// powershell" is one row, not two.
//
// The lower-level helpers (isOverSsh, desktopSessionPresent, chooseTerminalKind)
// are exercised by the matrix; only `desktopPlatform` WSL-detection robustness
// and the per-platform desktop fallback order get their own focused tests.

const env = (e: Record<string, string>): Record<string, string | undefined> => e;
const available =
  (kinds: readonly string[]) =>
  (k: string): boolean =>
    kinds.includes(k);
// WSL rows read a microsoft-flavoured /proc/version; everything else reads
// undefined (non-Linux, or native Linux) so desktopPlatform passes through.
const proc = (wsl: boolean) => () =>
  wsl ? "Linux version 5.15.153.1-microsoft-standard-WSL2 ..." : undefined;

interface Row {
  readonly name: string;
  /** Raw `process.platform` as the OS reports it ("linux" on WSL). */
  readonly rawPlatform: string;
  /** True on WSL: desktopPlatform resolves "linux" -> "win32". */
  readonly wsl: boolean;
  readonly env: Record<string, string | undefined>;
  readonly isTTY: boolean;
  /** Desktop channel kinds whose binary is on PATH. */
  readonly desktop: readonly string[];
  readonly expected: string | undefined;
}

const rows: readonly Row[] = [
  // macOS
  {
    name: "macOS local with terminal-notifier -> terminal-notifier",
    rawPlatform: "darwin",
    wsl: false,
    env: env({}),
    isTTY: true,
    desktop: ["terminal-notifier"],
    expected: "terminal-notifier",
  },
  {
    name: "macOS local, no terminal-notifier, falls back to osascript",
    rawPlatform: "darwin",
    wsl: false,
    env: env({}),
    isTTY: true,
    desktop: ["osascript"],
    expected: "osascript",
  },
  {
    name: "macOS local, no desktop binary -> osc777 on a TTY",
    rawPlatform: "darwin",
    wsl: false,
    env: env({}),
    isTTY: true,
    desktop: [],
    expected: "osc777",
  },
  {
    name: "macOS local, no TTY but terminal-notifier present -> terminal-notifier (desktop works headless)",
    rawPlatform: "darwin",
    wsl: false,
    env: env({}),
    isTTY: false,
    desktop: ["terminal-notifier"],
    expected: "terminal-notifier",
  },
  // Detected terminal protocols (iTerm2, Kitty) win over a desktop binary
  // locally (#45). The generic OSC 777 does not - it's only the last resort
  // (see the no-desktop-binary rows, which still fall through to osc777).
  {
    name: "macOS local in iTerm2 (ITERM_SESSION_ID) -> iterm, not terminal-notifier (#45)",
    rawPlatform: "darwin",
    wsl: false,
    env: env({ ITERM_SESSION_ID: "p1" }),
    isTTY: true,
    desktop: ["terminal-notifier"],
    expected: "iterm",
  },
  {
    name: "macOS local in Kitty (KITTY_WINDOW_ID) -> kitty, not terminal-notifier",
    rawPlatform: "darwin",
    wsl: false,
    env: env({ KITTY_WINDOW_ID: "1" }),
    isTTY: true,
    desktop: ["terminal-notifier"],
    expected: "kitty",
  },
  {
    name: "macOS local in iTerm2, no desktop binary -> iterm OSC 9",
    rawPlatform: "darwin",
    wsl: false,
    env: env({ ITERM_SESSION_ID: "p1" }),
    isTTY: true,
    desktop: [],
    expected: "iterm",
  },
  {
    name: "macOS local in iTerm2 but not a TTY -> osascript (OSC needs a TTY)",
    rawPlatform: "darwin",
    wsl: false,
    env: env({ ITERM_SESSION_ID: "p1" }),
    isTTY: false,
    desktop: ["osascript"],
    expected: "osascript",
  },
  // Linux
  {
    name: "Linux local, notify-send + DISPLAY -> notify-send",
    rawPlatform: "linux",
    wsl: false,
    env: env({ DISPLAY: ":0" }),
    isTTY: true,
    desktop: ["notify-send"],
    expected: "notify-send",
  },
  {
    name: "Linux local, notify-send + WAYLAND_DISPLAY -> notify-send",
    rawPlatform: "linux",
    wsl: false,
    env: env({ WAYLAND_DISPLAY: "wayland-0" }),
    isTTY: true,
    desktop: ["notify-send"],
    expected: "notify-send",
  },
  {
    name: "Linux local in Kitty (KITTY_WINDOW_ID) -> kitty, not notify-send",
    rawPlatform: "linux",
    wsl: false,
    env: env({ KITTY_WINDOW_ID: "1", DISPLAY: ":0" }),
    isTTY: true,
    desktop: ["notify-send"],
    expected: "kitty",
  },
  {
    name: "Linux local, notify-send but no display server -> osc777",
    rawPlatform: "linux",
    wsl: false,
    env: env({}),
    isTTY: true,
    desktop: ["notify-send"],
    expected: "osc777",
  },
  {
    name: "Linux local, no notify-send -> osc777",
    rawPlatform: "linux",
    wsl: false,
    env: env({ DISPLAY: ":0" }),
    isTTY: true,
    desktop: [],
    expected: "osc777",
  },
  // Windows / WSL
  {
    name: "Windows local, powershell -> powershell",
    rawPlatform: "win32",
    wsl: false,
    env: env({}),
    isTTY: true,
    desktop: ["powershell"],
    expected: "powershell",
  },
  {
    name: "WSL (linux + /proc/version microsoft), powershell.exe -> powershell",
    rawPlatform: "linux",
    wsl: true,
    env: env({}),
    isTTY: true,
    desktop: ["powershell"],
    expected: "powershell",
  },
  {
    name: "Windows local, no powershell -> osc777 on a TTY",
    rawPlatform: "win32",
    wsl: false,
    env: env({}),
    isTTY: true,
    desktop: [],
    expected: "osc777",
  },
  {
    name: "unknown platform (freebsd), no desktop binary -> osc777 on a TTY",
    rawPlatform: "freebsd",
    wsl: false,
    env: env({}),
    isTTY: true,
    desktop: [],
    expected: "osc777",
  },
  // SSH: the terminal protocol wins over the host toast.
  {
    name: "SSH + kitty TTY -> kitty (not the host toast)",
    rawPlatform: "darwin",
    wsl: false,
    env: env({ SSH_CONNECTION: "x", KITTY_WINDOW_ID: "1" }),
    isTTY: true,
    desktop: ["terminal-notifier"],
    expected: "kitty",
  },
  {
    name: "SSH + iterm TTY -> iterm",
    rawPlatform: "darwin",
    wsl: false,
    env: env({ SSH_CONNECTION: "x", ITERM_SESSION_ID: "p1" }),
    isTTY: true,
    desktop: ["terminal-notifier"],
    expected: "iterm",
  },
  {
    name: "SSH + kitty & iterm both set -> kitty (precedence)",
    rawPlatform: "darwin",
    wsl: false,
    env: env({ SSH_CONNECTION: "x", KITTY_WINDOW_ID: "1", ITERM_SESSION_ID: "p1" }),
    isTTY: true,
    desktop: ["terminal-notifier"],
    expected: "kitty",
  },
  {
    name: "SSH + unknown TTY -> osc777",
    rawPlatform: "win32",
    wsl: false,
    env: env({ SSH_CONNECTION: "x" }),
    isTTY: true,
    desktop: ["powershell"],
    expected: "osc777",
  },
  {
    name: "SSH + no TTY -> undefined (nothing to write to)",
    rawPlatform: "darwin",
    wsl: false,
    env: env({ SSH_CONNECTION: "x" }),
    isTTY: false,
    desktop: ["terminal-notifier"],
    expected: undefined,
  },
  // no channel at all
  {
    name: "local, no TTY, no desktop binary -> undefined",
    rawPlatform: "darwin",
    wsl: false,
    env: env({}),
    isTTY: false,
    desktop: [],
    expected: undefined,
  },
];

test.each(rows)("channel selection: $name", (r: Row) => {
  const platform = desktopPlatform({ platform: r.rawPlatform, readProcVersion: proc(r.wsl) });
  const kind = choosePopupKind({
    env: r.env,
    platform,
    isTTY: r.isTTY,
    desktopAvailable: available(r.desktop),
  });
  expect(kind).toBe(r.expected);
});

// --- WSL detection robustness (desktopPlatform) ---------------------------
// The matrix covers the happy WSL path; these pin the detection edge cases that
// a single matrix row can't.

test("desktopPlatform: non-linux passes through even if /proc/version mentions microsoft", () => {
  const read = () => "Linux version ... microsoft ...";
  expect(desktopPlatform({ platform: "darwin", readProcVersion: read })).toBe("darwin");
  expect(desktopPlatform({ platform: "win32", readProcVersion: read })).toBe("win32");
  expect(desktopPlatform({ platform: "freebsd", readProcVersion: read })).toBe("freebsd");
});

test("desktopPlatform: microsoft match is case-insensitive", () => {
  expect(
    desktopPlatform({
      platform: "linux",
      readProcVersion: () => "Linux version ... Microsoft ...",
    }),
  ).toBe("win32");
});

test("desktopPlatform: native linux (no microsoft in /proc/version) stays linux", () => {
  expect(
    desktopPlatform({
      platform: "linux",
      readProcVersion: () => "Linux version 6.8.0-generic ...",
    }),
  ).toBe("linux");
});

test("desktopPlatform: linux with an unreadable /proc/version stays linux", () => {
  expect(desktopPlatform({ platform: "linux", readProcVersion: () => undefined })).toBe("linux");
});

// --- desktop fallback order per platform ----------------------------------

test("chooseDesktopKind: darwin tries terminal-notifier then osascript", () => {
  expect([...chooseDesktopKind("darwin")]).toEqual(["terminal-notifier", "osascript"]);
});

test("chooseDesktopKind: linux uses notify-send", () => {
  expect([...chooseDesktopKind("linux")]).toEqual(["notify-send"]);
});

test("chooseDesktopKind: win32 uses powershell", () => {
  expect([...chooseDesktopKind("win32")]).toEqual(["powershell"]);
});

test("chooseDesktopKind: unknown platform has no desktop channel", () => {
  expect([...chooseDesktopKind("freebsd")]).toEqual([]);
});
