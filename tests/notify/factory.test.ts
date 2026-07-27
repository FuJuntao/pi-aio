import { test } from "node:test";
import assert from "node:assert/strict";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { NotifyPayload } from "../../extensions/notify/channels.ts";
import notifyExtension, {
  type NotifyDeps,
  MIN_DURATION_MS,
  shouldNotifySettled,
} from "../../extensions/notify/index.ts";

// --- Pure gating ----------------------------------------------------------

test("MIN_DURATION_MS is 10 seconds", () => {
  assert.equal(MIN_DURATION_MS, 10_000);
});

test("shouldNotifySettled: false when disabled", () => {
  assert.equal(
    shouldNotifySettled({ enabled: false, startedAt: 0, now: 20_000, minDurationMs: 10_000 }),
    false,
  );
});

test("shouldNotifySettled: false when no run started", () => {
  assert.equal(
    shouldNotifySettled({
      enabled: true,
      startedAt: undefined,
      now: 20_000,
      minDurationMs: 10_000,
    }),
    false,
  );
});

test("shouldNotifySettled: false when run is shorter than the threshold", () => {
  assert.equal(
    shouldNotifySettled({ enabled: true, startedAt: 0, now: 5_000, minDurationMs: 10_000 }),
    false,
  );
});

test("shouldNotifySettled: true at exactly the threshold (inclusive)", () => {
  assert.equal(
    shouldNotifySettled({ enabled: true, startedAt: 0, now: 10_000, minDurationMs: 10_000 }),
    true,
  );
});

test("shouldNotifySettled: true beyond the threshold", () => {
  assert.equal(
    shouldNotifySettled({ enabled: true, startedAt: 0, now: 15_000, minDurationMs: 10_000 }),
    true,
  );
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
  readonly state: {
    bells: number;
    nowValue: number;
    enabled: boolean;
    warning: string | undefined;
  };
}

function makeRecorder(
  opts: { enabled?: boolean; now?: number; popup?: "fake" | "none" | "throwing" } = {},
): Recorder {
  const popups: { title: string; body: string; urgency: string }[] = [];
  const state = {
    bells: 0,
    nowValue: opts.now ?? 0,
    enabled: opts.enabled ?? true,
    warning: undefined as string | undefined,
  };
  const deps: Partial<NotifyDeps> = {
    now: () => state.nowValue,
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
  };
  return { deps, popups, state };
}

function makeFakeCtx(cwd = "/proj") {
  const titles: string[] = [];
  const notifies: { message: string; type: string | undefined }[] = [];
  const raw = {
    cwd,
    ui: {
      setTitle: (title: string) => {
        titles.push(title);
      },
      notify: (message: string, type?: "info" | "warning" | "error") => {
        notifies.push({ message, type });
      },
    },
  };
  return { ctx: raw as unknown as ExtensionContext, titles, notifies };
}

const settledEvent = { type: "agent_settled" as const };
const startEvent = { type: "agent_start" as const };

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

// --- Event wiring ---------------------------------------------------------

test("agent_settled notifies after a long run", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  rec.state.nowValue = 0;
  emit("agent_start", startEvent, fake.ctx);
  rec.state.nowValue = 10_000;
  emit("agent_settled", settledEvent, fake.ctx);

  assert.equal(rec.popups.length, 1);
  assert.equal(rec.popups[0]?.urgency, "info");
  assert.equal(rec.popups[0]?.title, "Pi");
  assert.match(rec.popups[0]?.body ?? "", /Finished/);
  assert.equal(rec.state.bells, 1);
  assert.equal(fake.titles.length, 1);
  assert.match(fake.titles[0] ?? "", /Finished/);
});

test("agent_settled does not notify for a short run", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  rec.state.nowValue = 0;
  emit("agent_start", startEvent, fake.ctx);
  rec.state.nowValue = 5_000;
  emit("agent_settled", settledEvent, fake.ctx);

  assert.equal(rec.popups.length, 0);
  assert.equal(rec.state.bells, 0);
  assert.equal(fake.titles.length, 0);
});

test("agent_settled does not notify when disabled by config", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder({ enabled: false });
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  rec.state.nowValue = 0;
  emit("agent_start", startEvent, fake.ctx);
  rec.state.nowValue = 20_000;
  emit("agent_settled", settledEvent, fake.ctx);

  assert.equal(rec.popups.length, 0);
  assert.equal(rec.state.bells, 0);
});

test("tool_result error notifies immediately regardless of duration", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
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

test("agent_start baseline is preserved across retries", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  rec.state.nowValue = 0;
  emit("agent_start", startEvent, fake.ctx);
  // A retry re-fires agent_start 5s in; the baseline must not reset.
  rec.state.nowValue = 5_000;
  emit("agent_start", startEvent, fake.ctx);
  rec.state.nowValue = 10_000;
  emit("agent_settled", settledEvent, fake.ctx);

  assert.equal(rec.popups.length, 1);
  assert.equal(rec.state.bells, 1);
});

test("agent_settled resets the baseline so a later run can notify again", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder();
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  rec.state.nowValue = 0;
  emit("agent_start", startEvent, fake.ctx);
  rec.state.nowValue = 10_000;
  emit("agent_settled", settledEvent, fake.ctx);

  // Second run, fully after the first settled.
  rec.state.nowValue = 10_000;
  emit("agent_start", startEvent, fake.ctx);
  rec.state.nowValue = 20_000;
  emit("agent_settled", settledEvent, fake.ctx);

  assert.equal(rec.popups.length, 2);
  assert.equal(rec.state.bells, 2);
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

test("still rings the bell and sets the title when no popup channel is available", () => {
  const { pi, emit } = makeStubPi();
  const rec = makeRecorder({ popup: "none" });
  const fake = makeFakeCtx();
  notifyExtension(pi, rec.deps);

  emit("session_start", { type: "session_start", reason: "startup" }, fake.ctx);
  rec.state.nowValue = 0;
  emit("agent_start", startEvent, fake.ctx);
  rec.state.nowValue = 10_000;
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
  rec.state.nowValue = 0;
  emit("agent_start", startEvent, fake.ctx);
  rec.state.nowValue = 10_000;
  emit("agent_settled", settledEvent, fake.ctx);

  // The popup threw, but the bell and title still fire.
  assert.equal(rec.popups.length, 0);
  assert.equal(rec.state.bells, 1);
  assert.equal(fake.titles.length, 1);
});
