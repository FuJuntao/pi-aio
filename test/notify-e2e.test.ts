import { fileURLToPath } from "node:url";

import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";

import { FOCUS_REPORT_DISABLE, FOCUS_REPORT_ENABLE } from "../extensions/notify/focus.ts";
import { type ExtensionSession, createExtensionSession } from "./harness/index.ts";

// The notify extension lives at `extensions/notify/index.ts`. Passing its
// directory loads `index.ts` as a single extension entry; sibling files are
// ignored by the loader's `resolveExtensionEntries`.
const extensionPath = fileURLToPath(new URL("../extensions/notify/", import.meta.url));

// Each test gets its own session; clean up so the global faux api-registry and
// the stdout spy don't leak between cases.
let s: ExtensionSession | undefined;
afterEach(async () => {
  await s?.cleanup();
  s = undefined;
});

// All behaviors here run through pi's real runtime (createAgentSession +
// DefaultResourceLoader + fauxProvider) with a recording ctx.ui and a stdout
// spy. No test-injection seam in the extension - what you assert is what a real
// session does. Pure helpers (channel selection, escaping, focus parsing, config
// merge, the settle-gating truth table) are covered in their own pure test files.

describe("session lifecycle", () => {
  it("enables OSC 1004 focus reporting and registers an input listener on session_start (TUI)", async () => {
    s = await createExtensionSession({ extensionPath });
    expect(s.ui.onTerminalInputActive).toBe(true);
    expect(s.ui.stdoutWrites).toContain(FOCUS_REPORT_ENABLE);
  });

  it("stays inert on session_start when disabled by config", async () => {
    s = await createExtensionSession({
      extensionPath,
      configFiles: { notify: { enabled: false } },
    });
    expect(s.ui.onTerminalInputActive).toBe(false);
    expect(s.ui.stdoutWrites).not.toContain(FOCUS_REPORT_ENABLE);
  });

  it("surfaces a malformed config file as a ui.notify warning (and stays enabled)", async () => {
    s = await createExtensionSession({
      extensionPath,
      rawProjectFiles: { ".pi/notify.json": "{ not json" },
    });
    expect(s.ui.notifies).toHaveLength(1);
    expect(s.ui.notifies[0]?.type).toBe("warning");
    expect(s.ui.notifies[0]?.message).toMatch(/notify\.json/);
    // Malformed config falls back to enabled, so focus reporting is still wired.
    expect(s.ui.onTerminalInputActive).toBe(true);
  });

  it("skips focus reporting in non-TUI mode (no OSC, no listener) but still notifies on settle", async () => {
    s = await createExtensionSession({ extensionPath, mode: "print" });
    expect(s.ui.onTerminalInputActive).toBe(false);
    expect(s.ui.stdoutWrites).not.toContain(FOCUS_REPORT_ENABLE);

    await s.session.prompt("hi");
    await s.session.waitForIdle();

    // Focus can't be detected without the listener, so the gate says "notify".
    expect(s.eventsOfType("agent_settled").length).toBeGreaterThan(0);
    expect(s.ui.titles).toHaveLength(1);
  });

  it("re-reads config on /reload: disabling tears focus reporting down, re-enabling wires it back up", async () => {
    s = await createExtensionSession({ extensionPath });
    expect(s.ui.stdoutWrites).toContain(FOCUS_REPORT_ENABLE);
    expect(s.ui.onTerminalInputActive).toBe(true);

    // Flip to disabled, then /reload. reload emits session_shutdown (writes the
    // OSC disable) then session_start (re-reads config -> inert: no listener,
    // no second enable). No prompt after reload: reload resets the api-registry,
    // retiring the faux provider, so we assert lifecycle side effects only.
    s.writeProjectFile(".pi/notify.json", '{"enabled":false}');
    await s.session.reload();
    expect(s.ui.stdoutWrites).toContain(FOCUS_REPORT_DISABLE);
    expect(s.ui.onTerminalInputActive).toBe(false);
    expect(s.ui.stdoutWrites.filter((w) => w === FOCUS_REPORT_ENABLE)).toHaveLength(1);

    // Flip back to enabled and reload again: focus reporting is re-enabled.
    // Only one DISABLE overall - the disabled session never enabled reporting,
    // so its shutdown had nothing to tear down (focusReportingOn was false).
    s.writeProjectFile(".pi/notify.json", '{"enabled":true}');
    await s.session.reload();
    expect(s.ui.onTerminalInputActive).toBe(true);
    expect(s.ui.stdoutWrites.filter((w) => w === FOCUS_REPORT_ENABLE)).toHaveLength(2);
    expect(s.ui.stdoutWrites.filter((w) => w === FOCUS_REPORT_DISABLE)).toHaveLength(1);
  });
});

describe("settled notification gating", () => {
  it("fires a finished notification end-to-end when focus is unknown", async () => {
    // Focus state starts unknown (no OSC 1004 event seen yet), so the gating
    // rule says "notify". A faux-driven turn settles the agent; notify's
    // agent_settled handler must set the finished window-title cue.
    s = await createExtensionSession({ extensionPath });

    await s.session.prompt("hi");
    await s.session.waitForIdle();

    expect(s.eventsOfType("agent_settled").length).toBeGreaterThan(0);
    expect(s.ui.titles).toHaveLength(1);
    expect(s.ui.titles[0]).toMatch(/Finished/);
  });

  it("suppresses the notification while the terminal is focused", async () => {
    // The regression-prone focus gate: a focus-in event (OSC 1004) makes the
    // focus state known + focused, so shouldNotifySettled returns false and no
    // title is set on settle.
    s = await createExtensionSession({ extensionPath });

    s.ui.sendInput("\x1b[I");
    await s.session.prompt("hi");
    await s.session.waitForIdle();

    expect(s.eventsOfType("agent_settled").length).toBeGreaterThan(0);
    expect(s.ui.titles).toHaveLength(0);
  });

  it("re-fires after the user steps away (focus-out re-opens the gate)", async () => {
    // Two turns: focus-in suppresses the first settle; a focus-out makes the
    // focus state known + unfocused, so the second settle fires again.
    s = await createExtensionSession({
      extensionPath,
      responses: [fauxAssistantMessage("one"), fauxAssistantMessage("two")],
    });

    s.ui.sendInput("\x1b[I");
    await s.session.prompt("hi");
    await s.session.waitForIdle();
    expect(s.ui.titles).toHaveLength(0);

    s.ui.sendInput("\x1b[O");
    await s.session.prompt("again");
    await s.session.waitForIdle();
    expect(s.ui.titles).toHaveLength(1);
    expect(s.ui.titles[0]).toMatch(/Finished/);
  });

  it("suppresses all notifications when disabled by config", async () => {
    s = await createExtensionSession({
      extensionPath,
      configFiles: { notify: { enabled: false } },
    });

    await s.session.prompt("hi");
    await s.session.waitForIdle();

    expect(s.ui.titles).toHaveLength(0);
  });
});
