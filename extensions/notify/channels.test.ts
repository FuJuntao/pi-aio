import { test } from "node:test";
import assert from "node:assert/strict";

import {
  type ChannelDeps,
  type NotifyPayload,
  createChannels,
  createItermChannel,
  createKittyChannel,
  createNotifySendChannel,
  createOsascriptChannel,
  createOsc777Channel,
  createPowershellChannel,
  createTerminalNotifierChannel,
  quoteAppleScript,
  windowsToastScript,
} from "./channels.ts";

interface FakeRecorder {
  readonly deps: ChannelDeps;
  readonly spawned: { cmd: string; args: readonly string[] }[];
  readonly written: string[];
  readonly probed: { cmd: string; args: readonly string[] }[];
  setProbeResult(value: boolean): void;
}

function makeFakeDeps(): FakeRecorder {
  const spawned: { cmd: string; args: readonly string[] }[] = [];
  const written: string[] = [];
  const probed: { cmd: string; args: readonly string[] }[] = [];
  const state = { probeResult: true };
  const deps: ChannelDeps = {
    spawn: (cmd, args) => {
      spawned.push({ cmd, args: [...args] });
    },
    probe: (cmd, args) => {
      probed.push({ cmd, args: [...args] });
      return state.probeResult;
    },
    write: (data) => {
      written.push(data);
    },
  };
  return {
    deps,
    spawned,
    written,
    probed,
    setProbeResult: (value) => {
      state.probeResult = value;
    },
  };
}

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

// --- terminal-notifier ----------------------------------------------------

test("terminal-notifier: send spawns the expected argv for info", () => {
  const rec = makeFakeDeps();
  createTerminalNotifierChannel(rec.deps).send(info);
  assert.deepEqual(rec.spawned, [
    { cmd: "terminal-notifier", args: ["-title", "Pi", "-message", "Done", "-sound", "default"] },
  ]);
});

test("terminal-notifier: availability probes -help and is memoized", () => {
  const rec = makeFakeDeps();
  const channel = createTerminalNotifierChannel(rec.deps);
  assert.equal(channel.available(), true);
  assert.equal(channel.available(), true);
  assert.equal(rec.probed.length, 1);
  assert.deepEqual(rec.probed[0], { cmd: "terminal-notifier", args: ["-help"] });
});

test("terminal-notifier: unavailable when probe fails", () => {
  const rec = makeFakeDeps();
  rec.setProbeResult(false);
  assert.equal(createTerminalNotifierChannel(rec.deps).available(), false);
});

// --- osascript ------------------------------------------------------------

test("osascript: send builds a display notification script for info", () => {
  const rec = makeFakeDeps();
  createOsascriptChannel(rec.deps).send(info);
  assert.deepEqual(rec.spawned, [
    {
      cmd: "osascript",
      args: ["-e", 'display notification "Done" with title "Pi" sound name "default"'],
    },
  ]);
});

test("osascript: availability probes with -e 1", () => {
  const rec = makeFakeDeps();
  const channel = createOsascriptChannel(rec.deps);
  channel.available();
  assert.deepEqual(rec.probed, [{ cmd: "osascript", args: ["-e", "1"] }]);
});

// --- notify-send ----------------------------------------------------------

test("notify-send: send uses normal urgency", () => {
  const rec = makeFakeDeps();
  createNotifySendChannel(rec.deps).send(info);
  assert.deepEqual(rec.spawned, [
    { cmd: "notify-send", args: ["--urgency", "normal", "--app-name", "pi", "Pi", "Done"] },
  ]);
});

test("notify-send: availability probes --version", () => {
  const rec = makeFakeDeps();
  createNotifySendChannel(rec.deps).available();
  assert.deepEqual(rec.probed, [{ cmd: "notify-send", args: ["--version"] }]);
});

// --- powershell -----------------------------------------------------------

test("powershell: send spawns powershell.exe with the toast script", () => {
  const rec = makeFakeDeps();
  createPowershellChannel(rec.deps).send(info);
  assert.equal(rec.spawned.length, 1);
  assert.equal(rec.spawned[0]?.cmd, "powershell.exe");
  assert.deepEqual(
    [...(rec.spawned[0]?.args ?? [])],
    ["-NoProfile", "-Command", windowsToastScript("Pi", "Done")],
  );
});

test("powershell: availability probes with an exit command", () => {
  const rec = makeFakeDeps();
  createPowershellChannel(rec.deps).available();
  assert.deepEqual(rec.probed, [
    { cmd: "powershell.exe", args: ["-NoProfile", "-Command", "exit"] },
  ]);
});

// --- kitty ----------------------------------------------------------------

test("kitty: send writes an OSC 99 title then body", () => {
  const rec = makeFakeDeps();
  createKittyChannel(rec.deps).send(info);
  assert.deepEqual(rec.written, ["\x1b]99;i=1:d=0;Pi\x1b\\", "\x1b]99;i=1:p=body;Done\x1b\\"]);
});

test("kitty: is always available without probing", () => {
  const rec = makeFakeDeps();
  assert.equal(createKittyChannel(rec.deps).available(), true);
  assert.equal(rec.probed.length, 0);
});

// --- iterm ----------------------------------------------------------------

test("iterm: send writes an OSC 9 message", () => {
  const rec = makeFakeDeps();
  createItermChannel(rec.deps).send(info);
  assert.deepEqual(rec.written, ["\x1b]9;Pi: Done\x07"]);
});

// --- osc777 ---------------------------------------------------------------

test("osc777: send writes an OSC 777 notify sequence", () => {
  const rec = makeFakeDeps();
  createOsc777Channel(rec.deps).send(info);
  assert.deepEqual(rec.written, ["\x1b]777;notify;Pi;Done\x07"]);
});

// --- createChannels -------------------------------------------------------

test("createChannels: builds one channel per kind", () => {
  const rec = makeFakeDeps();
  const channels = createChannels(rec.deps);
  const kinds = Object.keys(channels).sort();
  assert.deepEqual(kinds, [
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
