import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { type ExtensionSession, createExtensionSession } from "./_harness.ts";

// The notify extension lives next to this test file (`extensions/notify/index.ts`).
// Passing the directory loads `index.ts` as a single extension entry; sibling
// `*.test.ts` files are ignored by the loader's `resolveExtensionEntries`.
const extensionPath = fileURLToPath(new URL(".", import.meta.url));

describe("notify extension (e2e via real pi runtime)", () => {
  let s: ExtensionSession | undefined;

  afterEach(async () => {
    await s?.cleanup();
    s = undefined;
  });

  it("loads through DefaultResourceLoader and wires session_start in TUI mode", async () => {
    // createAgentSession + reload + bindExtensions must not throw, and notify's
    // session_start handler must have run: in TUI mode it registers an
    // onTerminalInput focus listener, which the recording UI observes.
    s = await createExtensionSession({ extensionPath });
    expect(s.session).toBeDefined();
    expect(s.ui.onTerminalInputActive).toBe(true);
  });

  it("fires a settled notification end-to-end when focus is unknown", async () => {
    // Focus state starts unknown (no OSC 1004 event seen yet), so the gating
    // rule says "notify". A faux-driven turn settles the agent; notify's
    // agent_settled handler must call ctx.ui.setTitle with the finished cue.
    s = await createExtensionSession({ extensionPath });

    await s.session.prompt("hi");
    await s.session.waitForIdle();

    expect(s.eventsOfType("agent_settled").length).toBeGreaterThan(0);
    expect(s.ui.titles).toHaveLength(1);
    expect(s.ui.titles[0]).toMatch(/Finished/);
  });

  it("suppresses the settled notification while the terminal is focused", async () => {
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

  it("suppresses all notifications when disabled by config", async () => {
    // enabled:false in <cwd>/.pi/notify.json: session_start reads it and the
    // extension stays inert (no focus listener, no settle notification).
    s = await createExtensionSession({
      extensionPath,
      configFiles: { notify: { enabled: false } },
    });

    expect(s.ui.onTerminalInputActive).toBe(false);

    await s.session.prompt("hi");
    await s.session.waitForIdle();

    expect(s.ui.titles).toHaveLength(0);
  });
});
