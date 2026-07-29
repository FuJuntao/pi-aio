import { test } from "vitest";
import assert from "node:assert/strict";

import {
  type NotifyPayload,
  createChannels,
  itermSequence,
  kittySequences,
  notifySendArgs,
  osc777Sequence,
  osascriptArgs,
  powershellArgs,
  quoteAppleScript,
  terminalNotifierArgs,
  windowsToastScript,
} from "../extensions/notify/channels.ts";

// The bytes each channel emits - argv for desktop binaries, escape sequences
// for terminal protocols - are pure builder functions, tested directly with no
// fakes. The impure `send`/`available` wrappers (real spawn / spawnSync /
// stdout.write) are one-line compositions over these builders; they are
// exercised end-to-end through pi's real runtime where a binary is reachable
// and trusted elsewhere. There is no injection seam in `channels.ts`.

const info: NotifyPayload = { title: "Pi", body: "Done" };

// --- quoteAppleScript -----------------------------------------------------

test("quoteAppleScript: wraps a plain string in double quotes", () => {
  assert.equal(quoteAppleScript("hello"), '"hello"');
});

test("quoteAppleScript: escapes embedded double quotes", () => {
  assert.equal(quoteAppleScript('say "hi"'), '"say \\"hi\\""');
});

test("quoteAppleScript: escapes backslashes", () => {
  assert.equal(quoteAppleScript("back\\slash"), '"back\\\\slash"');
});

// --- windowsToastScript ---------------------------------------------------

test("windowsToastScript: builds a ToastText01 invocation with title and body", () => {
  const script = windowsToastScript("Pi", "Done");
  assert.ok(script.includes("ToastText01"));
  assert.ok(script.includes("'Pi'"));
  assert.ok(script.includes("'Done'"));
});

test("windowsToastScript: doubles apostrophes in title and body", () => {
  const script = windowsToastScript("Bob's", "It's done");
  assert.ok(script.includes("'Bob''s'"));
  assert.ok(script.includes("'It''s done'"));
});

// --- desktop argv builders ------------------------------------------------

test("terminalNotifierArgs: -title/-message/-sound default", () => {
  assert.deepEqual(
    [...terminalNotifierArgs(info)],
    ["-title", "Pi", "-message", "Done", "-sound", "default"],
  );
});

test("osascriptArgs: a display-notification AppleScript via -e", () => {
  assert.deepEqual(
    [...osascriptArgs(info)],
    ["-e", 'display notification "Done" with title "Pi" sound name "default"'],
  );
});

test("notifySendArgs: normal urgency, pi app-name, then title and body", () => {
  assert.deepEqual(
    [...notifySendArgs(info)],
    ["--urgency", "normal", "--app-name", "pi", "Pi", "Done"],
  );
});

test("powershellArgs: -NoProfile -Command <toast script>", () => {
  assert.deepEqual(
    [...powershellArgs(info)],
    ["-NoProfile", "-Command", windowsToastScript("Pi", "Done")],
  );
});

// --- terminal escape builders --------------------------------------------

test("kittySequences: OSC 99 held title then body, each ST-terminated", () => {
  assert.deepEqual(
    [...kittySequences(info)],
    ["\x1b]99;i=1:d=0;Pi\x1b\\", "\x1b]99;i=1:p=body;Done\x1b\\"],
  );
});

test("itermSequence: OSC 9 with `title: body`, BEL-terminated", () => {
  assert.equal(itermSequence(info), "\x1b]9;Pi: Done\x07");
});

test("osc777Sequence: OSC 777 notify;title;body, BEL-terminated", () => {
  assert.equal(osc777Sequence(info), "\x1b]777;notify;Pi;Done\x07");
});

// --- createChannels -------------------------------------------------------

test("createChannels: builds one channel per kind (does not spawn)", () => {
  // available() is not called, so no spawnSync occurs; this just checks the
  // channel set and names.
  const channels = createChannels();
  assert.deepEqual(Object.keys(channels).sort(), [
    "iterm",
    "kitty",
    "notify-send",
    "osascript",
    "osc777",
    "powershell",
    "terminal-notifier",
  ]);
  assert.equal(channels["terminal-notifier"].name, "terminal-notifier");
});
