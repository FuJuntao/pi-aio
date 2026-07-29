/**
 * E2E test harness for pi extensions.
 *
 * Loads an extension through pi's real runtime - `createAgentSession` +
 * `DefaultResourceLoader({ additionalExtensionPaths })` - driven by the offline
 * faux runtime (scripted responses, no API keys, no network), with a recording
 * `ctx.ui` and stdout spy capturing the side effects extensions produce. Shared
 * across extension suites; see `test/notify-e2e.test.ts` for the pattern.
 *
 * `createAgentSession` does not bind extensions, apply a UI, set a mode, or emit
 * `session_start` itself - only the interactive/rpc/print modes do, and we run
 * headless. So the harness calls `session.bindExtensions({ uiContext, mode })`,
 * which binds the core actions (so `prompt()` works), applies the recording UI,
 * sets `ctx.mode`, and emits `session_start` (where most extensions read config).
 *
 * Remember to `await cleanup()` in `afterEach`: it disposes the session,
 * unregisters the faux provider, removes the temp dirs, and restores stdout.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CONFIG_DIR_NAME,
  type AgentSession,
  type AgentSessionEvent,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";

import type { FauxProviderRegistration, FauxResponseStep } from "@earendil-works/pi-ai/compat";

import { createFauxRuntime } from "./faux-runtime.ts";
import { type RecordingUiControls, createRecordingUi, captureStdout } from "./recording-ui.ts";

export type ExtensionMode = "tui" | "rpc" | "json" | "print";

export interface CreateExtensionSessionOptions {
  /**
   * Absolute path to the extension entry. A directory containing `index.ts`
   * is loaded as a single extension; the loader's `resolveExtensionEntries`
   * picks up `index.ts` and ignores sibling files such as `*.test.ts`.
   */
  readonly extensionPath: string;
  /** Scripted faux responses for the run. Defaults to a single "done" message. */
  readonly responses?: readonly FauxResponseStep[];
  /**
   * Project-local config files to write under `<cwd>/.pi/` before startup. Keys
   * are file stems (e.g. `"notify"`), values are JSON-serialisable contents -
   * so `{ notify: { enabled: false } }` is written as `<cwd>/.pi/notify.json`.
   */
  readonly configFiles?: Readonly<Record<string, unknown>>;
  /**
   * Project-local files written verbatim (no JSON encoding), as `path -> bytes`,
   * resolved under `<cwd>`. Use this for malformed-JSON fixtures that
   * `configFiles` (which JSON-stringifies) can't express.
   */
  readonly rawProjectFiles?: Readonly<Record<string, string>>;
  /** The `ctx.mode` extensions see. Defaults to `"tui"`. */
  readonly mode?: ExtensionMode;
}

export interface ExtensionSessionUi extends RecordingUiControls {
  /** Raw `process.stdout.write` string chunks, in order (OSC sequences, bell). */
  readonly stdoutWrites: readonly string[];
}

export interface ExtensionSession {
  /** The real AgentSession (extension loaded through DefaultResourceLoader). */
  readonly session: AgentSession;
  /** The faux provider handle: `setResponses` / `appendResponses` / `state`. */
  readonly faux: FauxProviderRegistration;
  /** Captured session events (`agent_settled`, `message_end`, ...). */
  readonly events: AgentSessionEvent[];
  eventsOfType<T extends AgentSessionEvent["type"]>(
    type: T,
  ): Extract<AgentSessionEvent, { type: T }>[];
  /** Side-effect captures from `ctx.ui` and `process.stdout`. */
  readonly ui: ExtensionSessionUi;
  /** The temp project cwd; config files live under `<cwd>/.pi/`. */
  readonly cwd: string;
  /** Write a file under `<cwd>` (e.g. `.pi/notify.json`) to flip config mid-session. */
  writeProjectFile(relativePath: string, contents: string): void;
  /** Dispose the session, unregister faux, remove temp dirs, restore stdout. */
  cleanup(): Promise<void>;
}

/**
 * Build an in-memory AgentSession with `extensionPath` loaded through pi's real
 * resource discovery, driven by the faux provider. No real credentials, no
 * network. Remember to `await cleanup()` in `afterEach`.
 */
export async function createExtensionSession(
  options: CreateExtensionSessionOptions,
): Promise<ExtensionSession> {
  const cwd = mkdtempSync(join(tmpdir(), "pi-ext-cwd-"));
  const agentDir = mkdtempSync(join(tmpdir(), "pi-ext-agent-"));

  if (options.configFiles) {
    const cfgDir = join(cwd, CONFIG_DIR_NAME);
    mkdirSync(cfgDir, { recursive: true });
    for (const [stem, contents] of Object.entries(options.configFiles)) {
      writeFileSync(join(cfgDir, `${stem}.json`), `${JSON.stringify(contents)}\n`);
    }
  }
  if (options.rawProjectFiles) {
    for (const [relativePath, contents] of Object.entries(options.rawProjectFiles)) {
      const target = join(cwd, relativePath);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, contents);
    }
  }

  const runtime = await createFauxRuntime(agentDir, options.responses);

  const sessionManager = SessionManager.inMemory();
  const settingsManager = SettingsManager.inMemory();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    additionalExtensionPaths: [options.extensionPath],
    settingsManager,
  });
  // createAgentSession only reloads a loader it creates itself; for a passed-in
  // loader (needed for additionalExtensionPaths) we reload explicitly. Auto-trust
  // the additional path so startup doesn't block on a project-trust prompt.
  await resourceLoader.reload({ resolveProjectTrust: async () => true });

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model: runtime.model,
    modelRuntime: runtime.modelRuntime,
    resourceLoader,
    sessionManager,
    settingsManager,
  });

  const recording = createRecordingUi(session.extensionRunner.getUIContext());
  const stdout = captureStdout();

  // bindExtensions: binds core actions (so prompt() works), applies the
  // recording UI, sets ctx.mode, and emits session_start (where extensions
  // typically read config).
  await session.bindExtensions({ uiContext: recording.ui, mode: options.mode ?? "tui" });

  const events: AgentSessionEvent[] = [];
  session.subscribe((event) => {
    events.push(event);
  });

  return {
    session,
    faux: runtime.faux,
    events,
    eventsOfType<T extends AgentSessionEvent["type"]>(
      type: T,
    ): Extract<AgentSessionEvent, { type: T }>[] {
      return events.filter(
        (event): event is Extract<AgentSessionEvent, { type: T }> => event.type === type,
      );
    },
    ui: {
      titles: recording.controls.titles,
      notifies: recording.controls.notifies,
      sendInput: recording.controls.sendInput,
      get onTerminalInputActive() {
        return recording.controls.onTerminalInputActive;
      },
      get stdoutWrites() {
        return stdout.writes;
      },
    },
    cwd,
    writeProjectFile: (relativePath: string, contents: string) => {
      const target = join(cwd, relativePath);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, contents);
    },
    async cleanup() {
      stdout.restore();
      session.dispose();
      runtime.faux.unregister();
      if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
      if (existsSync(agentDir)) rmSync(agentDir, { recursive: true, force: true });
    },
  };
}

export { createFauxRuntime } from "./faux-runtime.ts";
export {
  createRecordingUi,
  captureStdout,
  type RecordingUi,
  type RecordingUiControls,
  type StdoutCapture,
} from "./recording-ui.ts";
