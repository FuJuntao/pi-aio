/**
 * E2E test harness for pi extensions.
 *
 * Loads an extension through pi's real runtime - `createAgentSession` +
 * `DefaultResourceLoader({ additionalExtensionPaths })` - driven by pi-ai's
 * `fauxProvider` (scripted responses, no API keys, no network). A recording
 * `ExtensionUIContext` captures the side effects extensions produce via
 * `ctx.ui` (`setTitle` / `notify` / `onTerminalInput`), which are not otherwise
 * observable in headless/SDK mode: `ctx.ui` is a live getter to the runner's
 * `uiContext`, and `createAgentSession` does not expose an injection point, so
 * the harness calls `session.bindExtensions({ uiContext })` itself - which also
 * binds the core actions (so `prompt()` works), sets TUI mode, and emits
 * `session_start`. Session events are captured via `session.subscribe`.
 *
 * Minimal and reusable; promote to a shared location as more extensions need it.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fauxAssistantMessage,
  registerFauxProvider,
  type FauxProviderRegistration,
  type FauxResponseStep,
} from "@earendil-works/pi-ai/compat";
import {
  CONFIG_DIR_NAME,
  type AgentSession,
  type AgentSessionEvent,
  DefaultResourceLoader,
  type ExtensionUIContext,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent";

export interface CreateExtensionSessionOptions {
  /**
   * Absolute path to the extension entry. A directory containing `index.ts`
   * (the notify layout) is loaded as a single extension; the loader's
   * `resolveExtensionEntries` picks up `index.ts` and ignores sibling files
   * such as `*.test.ts`.
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
}

export interface ExtensionSessionUi {
  /** Captured `ctx.ui.setTitle` calls, in order. */
  readonly titles: string[];
  /** Captured `ctx.ui.notify` calls, in order. */
  readonly notifies: ReadonlyArray<{ message: string; type: string | undefined }>;
  /** Feed raw terminal input to the extension's `onTerminalInput` handler. */
  sendInput(data: string): void;
  /** Whether an `onTerminalInput` listener is currently registered. */
  readonly onTerminalInputActive: boolean;
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
  /** Side-effect captures from `ctx.ui`. */
  readonly ui: ExtensionSessionUi;
  /** Dispose the session, unregister faux, remove temp dirs. */
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

  // Faux provider: scripted responses, registered in pi-ai's global api-registry
  // so the ModelRuntime streams through it (streamSimple -> getApiProvider).
  const faux = registerFauxProvider({
    models: [{ id: "faux-1", name: "Faux", reasoning: false, input: ["text"] }],
  });
  faux.setResponses(options.responses ? [...options.responses] : [fauxAssistantMessage("done")]);
  const model = faux.getModel();

  // Offline ModelRuntime: no models.json, no real auth file. Register the faux
  // provider with a throwaway key so it counts as configured and the model is
  // available; streaming still routes through the global faux api-registry.
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
  });
  modelRuntime.registerProvider(model.provider, {
    api: faux.api,
    apiKey: "faux-key",
    baseUrl: model.baseUrl ?? "http://localhost:0",
    models: faux.models.map((entry) => ({
      id: entry.id,
      name: entry.name ?? entry.id,
      api: entry.api,
      baseUrl: entry.baseUrl ?? "http://localhost:0",
      reasoning: entry.reasoning,
      input: entry.input,
      cost: entry.cost,
      contextWindow: entry.contextWindow,
      maxTokens: entry.maxTokens,
    })),
  });
  await modelRuntime.setRuntimeApiKey(model.provider, "faux-key");

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
    model,
    modelRuntime,
    resourceLoader,
    sessionManager,
    settingsManager,
  });

  // Recording UI: spread the runner's default no-op UI and override the three
  // methods notify touches. `ctx.ui` is a live getter to `runner.uiContext`, so
  // every call after bindExtensions is captured here.
  const titles: string[] = [];
  const notifies: { message: string; type: string | undefined }[] = [];
  let inputHandler: ((data: string) => unknown) | undefined;
  const baseUi = session.extensionRunner.getUIContext();
  const recordingUi: ExtensionUIContext = {
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

  // bindExtensions: binds core actions (so prompt() works), applies the
  // recording UI, sets TUI mode (so notify enables OSC 1004 focus reporting and
  // registers its onTerminalInput listener), and emits session_start (notify
  // reads its config here). createAgentSession does none of this itself - only
  // the interactive/rpc/print modes do, and we run headless.
  await session.bindExtensions({ uiContext: recordingUi, mode: "tui" });

  const events: AgentSessionEvent[] = [];
  session.subscribe((event) => {
    events.push(event);
  });

  return {
    session,
    faux,
    events,
    eventsOfType<T extends AgentSessionEvent["type"]>(
      type: T,
    ): Extract<AgentSessionEvent, { type: T }>[] {
      return events.filter(
        (event): event is Extract<AgentSessionEvent, { type: T }> => event.type === type,
      );
    },
    ui: {
      titles,
      notifies,
      sendInput: (data: string) => {
        inputHandler?.(data);
      },
      get onTerminalInputActive() {
        return inputHandler !== undefined;
      },
    },
    async cleanup() {
      session.dispose();
      faux.unregister();
      if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
      if (existsSync(agentDir)) rmSync(agentDir, { recursive: true, force: true });
    },
  };
}
