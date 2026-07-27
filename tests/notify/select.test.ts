import { test } from "node:test";
import assert from "node:assert/strict";

import {
  chooseDesktopKind,
  choosePopupKind,
  chooseTerminalKind,
  desktopSessionPresent,
  isOverSsh,
} from "../../extensions/notify/select.ts";

const env = (entries: Record<string, string>): Record<string, string | undefined> => entries;

// --- isOverSsh ------------------------------------------------------------

test("isOverSsh: true when SSH_CONNECTION is set", () => {
  assert.equal(isOverSsh(env({ SSH_CONNECTION: "1.2.3.4 22 10.0.0.1 22" })), true);
});

test("isOverSsh: true when SSH_TTY is set", () => {
  assert.equal(isOverSsh(env({ SSH_TTY: "/dev/pts/0" })), true);
});

test("isOverSsh: false when neither SSH var is set", () => {
  assert.equal(isOverSsh(env({})), false);
});

// --- desktopSessionPresent -----------------------------------------------

test("desktopSessionPresent: linux with DISPLAY", () => {
  assert.equal(desktopSessionPresent("linux", env({ DISPLAY: ":0" })), true);
});

test("desktopSessionPresent: linux with WAYLAND_DISPLAY", () => {
  assert.equal(desktopSessionPresent("linux", env({ WAYLAND_DISPLAY: "wayland-0" })), true);
});

test("desktopSessionPresent: linux without a display server", () => {
  assert.equal(desktopSessionPresent("linux", env({})), false);
});

test("desktopSessionPresent: darwin always has a session", () => {
  assert.equal(desktopSessionPresent("darwin", env({})), true);
});

test("desktopSessionPresent: win32 always has a session", () => {
  assert.equal(desktopSessionPresent("win32", env({})), true);
});

// --- chooseTerminalKind ---------------------------------------------------

test("chooseTerminalKind: undefined when stdout is not a TTY", () => {
  assert.equal(chooseTerminalKind(env({ KITTY_WINDOW_ID: "1" }), false), undefined);
});

test("chooseTerminalKind: kitty when KITTY_WINDOW_ID is set on a TTY", () => {
  assert.equal(chooseTerminalKind(env({ KITTY_WINDOW_ID: "1" }), true), "kitty");
});

test("chooseTerminalKind: iterm when ITERM_SESSION_ID is set on a TTY", () => {
  assert.equal(chooseTerminalKind(env({ ITERM_SESSION_ID: "p1:0" }), true), "iterm");
});

test("chooseTerminalKind: kitty wins over iterm when both are set", () => {
  assert.equal(
    chooseTerminalKind(env({ KITTY_WINDOW_ID: "1", ITERM_SESSION_ID: "p1:0" }), true),
    "kitty",
  );
});

test("chooseTerminalKind: osc777 fallback on an unknown TTY", () => {
  assert.equal(chooseTerminalKind(env({}), true), "osc777");
});

// --- chooseDesktopKind ----------------------------------------------------

test("chooseDesktopKind: darwin prefers terminal-notifier then osascript", () => {
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

// --- choosePopupKind ------------------------------------------------------

const available =
  (kinds: readonly string[]) =>
  (kind: string): boolean =>
    kinds.includes(kind);

test("choosePopupKind: over SSH with a TTY prefers the terminal protocol", () => {
  const kind = choosePopupKind({
    env: env({ SSH_CONNECTION: "x", KITTY_WINDOW_ID: "1" }),
    platform: "darwin",
    isTTY: true,
    desktopAvailable: available(["terminal-notifier"]),
  });
  assert.equal(kind, "kitty");
});

test("choosePopupKind: over SSH without a TTY has no channel", () => {
  const kind = choosePopupKind({
    env: env({ SSH_CONNECTION: "x" }),
    platform: "darwin",
    isTTY: false,
    desktopAvailable: available(["terminal-notifier"]),
  });
  assert.equal(kind, undefined);
});

test("choosePopupKind: local darwin with terminal-notifier uses it", () => {
  const kind = choosePopupKind({
    env: env({}),
    platform: "darwin",
    isTTY: true,
    desktopAvailable: available(["terminal-notifier"]),
  });
  assert.equal(kind, "terminal-notifier");
});

test("choosePopupKind: local darwin falls back to osascript", () => {
  const kind = choosePopupKind({
    env: env({}),
    platform: "darwin",
    isTTY: true,
    desktopAvailable: available(["osascript"]),
  });
  assert.equal(kind, "osascript");
});

test("choosePopupKind: local darwin with no desktop binary uses osc777 on a TTY", () => {
  const kind = choosePopupKind({
    env: env({}),
    platform: "darwin",
    isTTY: true,
    desktopAvailable: available([]),
  });
  assert.equal(kind, "osc777");
});

test("choosePopupKind: local linux with notify-send and DISPLAY uses notify-send", () => {
  const kind = choosePopupKind({
    env: env({ DISPLAY: ":0" }),
    platform: "linux",
    isTTY: true,
    desktopAvailable: available(["notify-send"]),
  });
  assert.equal(kind, "notify-send");
});

test("choosePopupKind: local linux with notify-send but no DISPLAY falls back to terminal", () => {
  const kind = choosePopupKind({
    env: env({}),
    platform: "linux",
    isTTY: true,
    desktopAvailable: available(["notify-send"]),
  });
  assert.equal(kind, "osc777");
});

test("choosePopupKind: local linux without notify-send falls back to terminal", () => {
  const kind = choosePopupKind({
    env: env({ DISPLAY: ":0" }),
    platform: "linux",
    isTTY: true,
    desktopAvailable: available([]),
  });
  assert.equal(kind, "osc777");
});

test("choosePopupKind: local with no TTY and no desktop binary has no channel", () => {
  const kind = choosePopupKind({
    env: env({}),
    platform: "darwin",
    isTTY: false,
    desktopAvailable: available([]),
  });
  assert.equal(kind, undefined);
});
