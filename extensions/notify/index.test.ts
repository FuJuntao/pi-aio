import { test } from "node:test";
import assert from "node:assert/strict";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { NotifyPayload } from "./channels.ts";
import { FOCUS_REPORT_DISABLE, FOCUS_REPORT_ENABLE } from "./focus.ts";
import notifyExtension, { type NotifyDeps, shouldNotifySettled } from "./index.ts";

// --- Pure gating ----------------------------------------------------------

test("shouldNotifySettled: false when disabled", () => {
  assert.equal(shouldNotifySettled({ enabled: false, focusKnown: true, focused: false }), false);
});

test("shouldNotifySettled: true when focus is unknown (can't detect -> notify)", () => {
  assert.equal(shouldNotifySettled({ enabled: true, focusKnown: false, focused: true }), true);
});

test("shouldNotifySettled: false when focused and focus is known (user is watching)", () => {
  assert.equal(shouldNotifySettled({ enabled: true, focusKnown: true, focused: true }), false);
});

test("shouldNotifySettled: true when unfocused and focus is known", () => {
  assert.equal(shouldNotifySettled({ enabled: true, focusKnown: true, focused: false }), true);
});

// --- Test harness ---------------------------------------------------------

type AnyHandler = (...args: unknown[]) => unknown;

function makeStubPi() {
  const handlers = new Map<string, AnyHandler[]>();
  const on = (event: string, handler: AnyHandler): void => {
    const list = handlers.get(event);
    if (list) {
      list.push(handler);
    } else {
      handlers.set(event, [handler]);
    }
  };
  return {
    pi: { on } as unknown as Pick<ExtensionAPI, "on">,
    emit: (event: string, ...args: unknown[]): void => {
      for (const h of handlers.get(event) ?? []) {
        h(...args);
      }
    },
  };
}

interface Recorder {
  readonly deps: Partial<NotifyDeps>;
  readonly popups: { title: string; body: string; urgency: string }[];
  readonly oscWrites: string[];
  readonly state: { bells: number; enabled: boolean; warning: string | undefined };
}

function makeRecorder(
  opts: { enabled?: boolean; popup?: "fake" | "none" | "throwing" } = {},
): Recorder {
  const popups: { title: string; body: string; urgency: string }[] = [];
  const oscWrites: string[] = [];
  const state = {
    bells: 0,
    enabled: opts.enabled ?? true,
    warning: undefined as string | undefined,
  };
  const deps: Partial<NotifyDeps> = {
    loadConfig: () => ({ enabled: state.enabled, warning: state.warning }),
    pickPopupChannel: () => {
      switch (opts.popup) {
        case "none":
          return undefined;
        case "throwing":
          return {
            name: "throwing",
            available: () => true,
            send: () => {
              throw new Error("boom");
            },
          };
        default:
          return {
            name: "fake",
            available: () => true,
            send: (payload: NotifyPayload) => {
              popups.push({ title: payload.title, body: payload.body, urgency: payload.urgency });
            },
          };
      }
    },
    ringBell: () => {
      state.bells += 1;
    },
    writeOsc: (data: string) => {
      oscWrites.push(data);
    },
  };
  return { deps, popups, oscWrites, state };
}

interface FakeCtx {
  readonly ctx: ExtensionContext;
  readonly titles: string[];
  readonly notifies: { message: string; type: string | undefined }[];
  /** Feed raw terminal input to the registered onTerminalInput handler. */
  sendInput(data: string): void;
  /** Whether an input listener is currently registered. */
  inputListenerActive: boolean;
}

function makeFakeCtx(cwd = "/proj", mode: "tui" | "rpc" | "json" | "print" = "tui"): FakeCtx {
  const titles: string[] = [];
  const notifies: { message: string; type: string | undefined }[] = [];
  let inputHandler: ((data: string) => unknown) | undefined;
  const raw = {
    cwd,
    mode,
    hasUI: true,
    ui: {
      setTitle: (title: string) => {
        titles.push(title);
      },
      notify: (message: string, type?: "info" | "warning" | "error") => {
        notifies.push({ message, type });
      },
      onTerminalInput: (handler: (data: string) => unknown): (() => void) => {
        inputHandler = handler;
        return () => {
          inputHandler = undefined;
        };
      },
    },
  };
  return {
    ctx: raw as unknown as ExtensionContext,
    titles,
    notifies,
    sendInput: (data: string) => {
      inputHandler?.(data);
    },
    get inputListenerActive() {
      return inputHandler !== undefined;
    },
  };
}

const settledEvent = { type: "agent_settled" as const };

function toolResultEvent(toolName: string, isError: boolean) {
  return {
    type: "tool_result" as const,
    toolCallId: "c1",
    toolName,
    input: {},
    content: [],
    isError,
    details: undefined,
  };
}

// --- session_start: focus reporting setup --------------------------------

test("session_start in TUI mode enables OSC 1004 focus reporting", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);

  assert.ok(rec.oscWrites.includes(FOCUS_REPORT_ENABLE));
  assert.equal(fake.inputListenerActive, true);
});

test("session_start in non-TUI mode does not enable focus reporting", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx("/proj", "print");
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);

  assert.ok(!rec.oscWrites.includes(FOCUS_REPORT_ENABLE));
  assert.equal(fake.inputListenerActive, false);
});

test("session_start surfaces a config warning via ui.notify", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  rec.state.warning = "notify: bad config";
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);

  assert.equal(fake.notifies.length, 1);
  assert.match(fake.notifies[0]?.message ?? "", /bad config/);
  assert.equal(fake.notifies[0]?.type, "warning");
});

// --- agent_settled: focus gating ------------------------------------------

test("agent_settled notifies when focus is unknown (no focus event seen yet)", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  emit("agent_settled", settledEvent, fake.ctx);

  assert.equal(rec.popups.length, 1);
  assert.equal(rec.popups[0]?.urgency, "info");
  assert.match(rec.popups[0]?.body ?? "", /Finished/);
  assert.equal(rec.state.bells, 1);
  assert.equal(fake.titles.length, 1);
});

test("agent_settled notifies after a focus-out (user stepped away)", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  fake.sendInput("\x1b[O");
  emit("agent_settled", settledEvent, fake.ctx);

  assert.equal(rec.popups.length, 1);
  assert.equal(rec.state.bells, 1);
});

test("agent_settled does not notify while the terminal is focused", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  fake.sendInput("\x1b[I");
  emit("agent_settled", settledEvent, fake.ctx);

  assert.equal(rec.popups.length, 0);
  assert.equal(rec.state.bells, 0);
  assert.equal(fake.titles.length, 0);
});

test("agent_settled notifies again after the user refocuses then steps away", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  fake.sendInput("\x1b[I");
  emit("agent_settled", settledEvent, fake.ctx);
  assert.equal(rec.popups.length, 0);

  fake.sendInput("\x1b[O");
  emit("agent_settled", settledEvent, fake.ctx);
  assert.equal(rec.popups.length, 1);
});

test("agent_settled does not notify when disabled by config", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder({ enabled: false });
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  fake.sendInput("\x1b[O");
  emit("agent_settled", settledEvent, fake.ctx);

  assert.equal(rec.popups.length, 0);
  assert.equal(rec.state.bells, 0);
});

test("agent_settled in non-TUI mode notifies (focus cannot be detected)", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx("/proj", "print");
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  emit("agent_settled", settledEvent, fake.ctx);

  assert.equal(rec.popups.length, 1);
});

test("a focus event split across input chunks is still recognised", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  fake.sendInput("\x1b[");
  fake.sendInput("O");
  emit("agent_settled", settledEvent, fake.ctx);

  assert.equal(rec.popups.length, 1);
});

// --- tool_result: always surfaces errors ----------------------------------

test("tool_result error notifies immediately, even when focused", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  fake.sendInput("\x1b[I");
  emit("tool_result", toolResultEvent("bash", true), fake.ctx);

  assert.equal(rec.popups.length, 1);
  assert.equal(rec.popups[0]?.urgency, "error");
  assert.match(rec.popups[0]?.body ?? "", /bash/);
  assert.equal(rec.state.bells, 1);
  assert.match(fake.titles[0] ?? "", /bash/);
});

test("tool_result without error does not notify", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  emit("tool_result", toolResultEvent("read", false), fake.ctx);

  assert.equal(rec.popups.length, 0);
  assert.equal(rec.state.bells, 0);
});

test("tool_result error does not notify when disabled", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder({ enabled: false });
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  emit("tool_result", toolResultEvent("bash", true), fake.ctx);

  assert.equal(rec.popups.length, 0);
  assert.equal(rec.state.bells, 0);
});

// --- session_shutdown: cleanup --------------------------------------------

test("session_shutdown disables focus reporting and unsubscribes the input listener", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  assert.equal(fake.inputListenerActive, true);

  emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, fake.ctx);

  assert.ok(rec.oscWrites.includes(FOCUS_REPORT_DISABLE));
  assert.equal(fake.inputListenerActive, false);
});

test("session_shutdown in non-TUI mode does not write the disable sequence", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx("/proj", "print");
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  emit("session_shutdown", { type: "session_shutdown", reason: "quit" }, fake.ctx);

  assert.ok(!rec.oscWrites.includes(FOCUS_REPORT_DISABLE));
});

test("a settled run after shutdown re-enables focus reporting on the next session_start", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  fake.sendInput("\x1b[I");
  emit("session_shutdown", { type: "session_shutdown", reason: "new" }, fake.ctx);

  // New session: focus state resets to unknown, so a settle notifies.
  emit("session_start", { type: "session_start", reason: "new" }, fake.ctx);
  emit("agent_settled", settledEvent, fake.ctx);

  assert.equal(rec.popups.length, 1);
});

// --- delivery robustness --------------------------------------------------

test("still rings the bell and sets the title when no popup channel is available", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder({ popup: "none" });
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  fake.sendInput("\x1b[O");
  emit("agent_settled", settledEvent, fake.ctx);

  assert.equal(rec.popups.length, 0);
  assert.equal(rec.state.bells, 1);
  assert.equal(fake.titles.length, 1);
});

test("a popup channel error does not disturb the session", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder({ popup: "throwing" });
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  fake.sendInput("\x1b[O");
  emit("agent_settled", settledEvent, fake.ctx);

  // The popup threw, but the bell and title still fire.
  assert.equal(rec.popups.length, 0);
  assert.equal(rec.state.bells, 1);
  assert.equal(fake.titles.length, 1);
});
