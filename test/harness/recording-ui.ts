/**
 * Side-effect capture for extension e2e tests.
 *
 * Extensions produce effects two ways that headless/SDK mode doesn't otherwise
 * expose: through `ctx.ui` (`setTitle` / `notify` / `onTerminalInput`), and by
 * writing raw bytes to `process.stdout` (OSC control sequences, the bell). This
 * module captures both so a test can assert on them.
 *
 * `ctx.ui` is a live getter to the runner's `uiContext`, and `createAgentSession`
 * exposes no injection point for it, so the harness calls
 * `session.bindExtensions({ uiContext })` itself with a recording UI built here.
 * Raw stdout writes are captured with a `vi.spyOn` that records without
 * forwarding, so escape sequences never pollute test output.
 */

import { vi } from "vitest";

import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";

export interface RecordingUiControls {
  /** Captured `ctx.ui.setTitle` calls, in order. */
  readonly titles: string[];
  /** Captured `ctx.ui.notify` calls, in order. */
  readonly notifies: ReadonlyArray<{ message: string; type: string | undefined }>;
  /** Feed raw terminal input to the extension's `onTerminalInput` handler. */
  readonly sendInput: (data: string) => void;
  /** Whether an `onTerminalInput` listener is currently registered. */
  readonly onTerminalInputActive: boolean;
}

export interface RecordingUi {
  /** Pass to `session.bindExtensions({ uiContext })`. */
  readonly ui: ExtensionUIContext;
  /** Assert on the captured side effects. */
  readonly controls: RecordingUiControls;
}

/**
 * Spread the runner's default no-op UI and override the methods extensions
 * touch. `ctx.ui` is a live getter to `runner.uiContext`, so every call after
 * `bindExtensions` is captured here.
 */
export function createRecordingUi(baseUi: ExtensionUIContext): RecordingUi {
  const titles: string[] = [];
  const notifies: { message: string; type: string | undefined }[] = [];
  let inputHandler: ((data: string) => unknown) | undefined;
  const ui: ExtensionUIContext = {
    ...baseUi,
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
  };
  return {
    ui,
    controls: {
      titles,
      notifies,
      sendInput: (data: string) => {
        inputHandler?.(data);
      },
      get onTerminalInputActive() {
        return inputHandler !== undefined;
      },
    },
  };
}

export interface StdoutCapture {
  /** Raw `process.stdout.write` string chunks, in order. */
  readonly writes: readonly string[];
  /** Restore the real `process.stdout.write` (call in cleanup). */
  restore(): void;
}

/** Spy on `process.stdout.write`, recording chunks without forwarding them. */
export function captureStdout(): StdoutCapture {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    writes.push(typeof chunk === "string" ? chunk : String(chunk));
    return true;
  });
  return {
    writes,
    restore: () => {
      spy.mockRestore();
    },
  };
}
