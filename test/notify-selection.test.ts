import { test } from "vitest";
import assert from "node:assert/strict";

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
  assert.equal(kind, r.expected);
});

// --- WSL detection robustness (desktopPlatform) ---------------------------
// The matrix covers the happy WSL path; these pin the detection edge cases that
// a single matrix row can't.

test("desktopPlatform: non-linux passes through even if /proc/version mentions microsoft", () => {
  const read = () => "Linux version ... microsoft ...";
  assert.equal(desktopPlatform({ platform: "darwin", readProcVersion: read }), "darwin");
  assert.equal(desktopPlatform({ platform: "win32", readProcVersion: read }), "win32");
  assert.equal(desktopPlatform({ platform: "freebsd", readProcVersion: read }), "freebsd");
});

test("desktopPlatform: microsoft match is case-insensitive", () => {
  assert.equal(
    desktopPlatform({
      platform: "linux",
      readProcVersion: () => "Linux version ... Microsoft ...",
    }),
    "win32",
  );
});

test("desktopPlatform: native linux (no microsoft in /proc/version) stays linux", () => {
  assert.equal(
    desktopPlatform({
      platform: "linux",
      readProcVersion: () => "Linux version 6.8.0-generic ...",
    }),
    "linux",
  );
});

test("desktopPlatform: linux with an unreadable /proc/version stays linux", () => {
  assert.equal(desktopPlatform({ platform: "linux", readProcVersion: () => undefined }), "linux");
});

// --- desktop fallback order per platform ----------------------------------

test("chooseDesktopKind: darwin tries terminal-notifier then osascript", () => {
  assert.deepEqual([...chooseDesktopKind("darwin")], ["terminal-notifier", "osascript"]);
});

test("chooseDesktopKind: linux uses notify-send", () => {
  assert.deepEqual([...chooseDesktopKind("linux")], ["notify-send"]);
});

test("chooseDesktopKind: win32 uses powershell", () => {
  assert.deepEqual([...chooseDesktopKind("win32")], ["powershell"]);
});

test("chooseDesktopKind: unknown platform has no desktop channel", () => {
  assert.deepEqual([...chooseDesktopKind("freebsd")], []);
});
