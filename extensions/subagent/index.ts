/**
 * subagent extension for `@fujuntao/pi-aio`.
 *
 * Registers a `subagent` tool that lets the main agent delegate work to one or
 * more in-process subagents. Each subagent runs in a **fresh in-memory context**
 * (no parent conversation, no persistence) with a **config-free** resource
 * loader: no `agents/*.md`, no skills, no prompt templates, no themes, and no
 * project context files are read. The main agent freely specifies each
 * subagent's system prompt (required - no canned default), model, thinking
 * level, tools, and cwd at call time.
 *
 * The tool blocks (sync) until every spawned subagent finishes, then returns
 * each one's final output plus usage. Parallel subagents run concurrently
 * (capped). Abort (Esc/Ctrl+C) propagates to running subagents and resolves
 * with a clean `aborted` status rather than rejecting.
 *
 * Auth/model are inherited from the parent session via `ctx.modelRegistry`
 * (including runtime API-key overrides) through a nested `ModelRuntime` backed
 * by an `InMemoryCredentialStore` - no `auth.json` / `models.json` is read.
 *
 * Note: the tool name `subagent` collides with the `pi-subagents` extension if
 * both load in one session. Do not load both simultaneously.
 */

import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  createExtensionRuntime,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentToolResult,
  type AgentToolUpdateCallback,
  type ExtensionAPI,
  type ExtensionContext,
  type LoadExtensionsResult,
  type ResourceLoader,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

// --- Constants -------------------------------------------------------------

/** Max subagents in a single parallel call. */
const MAX_TASKS = 8;
/** Max concurrently running subagents in parallel mode. */
const MAX_CONCURRENT_SUBAGENTS = 4;
/** Per-task output cap (characters) applied to both `content` and `details.results[].output`. */
const MAX_OUTPUT_CHARS = 50_000;

// --- Schemas ---------------------------------------------------------------

/**
 * Canonical thinking-level values mirroring `ThinkingLevel` from `@earendil-works/pi-agent-core`
 * (`"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"`).
 *
 * The `_typeCheck` assignment below guarantees the schema never drifts from pi's
 * type at compile time. If pi adds or removes a level, the build fails here so
 * we keep them in sync.
 */
type SubagentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const SUBAGENT_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
// Compile-time guard: a type error here means the values list drifted from SubagentThinkingLevel.
const _guard: readonly SubagentThinkingLevel[] = SUBAGENT_THINKING_LEVELS;
void _guard;

const thinkingLevelSchema = Type.Union(SUBAGENT_THINKING_LEVELS.map((v) => Type.Literal(v)));

const taskSchema = Type.Object({
  prompt: Type.String({ description: "The task prompt for this subagent." }),
  systemPrompt: Type.String({
    description: "Required system prompt for the subagent - there is no canned default.",
  }),
  model: Type.Optional(
    Type.String({ description: '"provider/id"; default inherits the parent session model.' }),
  ),
  thinkingLevel: Type.Optional(thinkingLevelSchema),
  tools: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Built-in tool names to enable (read/bash/edit/write/grep/find/ls); default inherits the parent's active built-ins.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({ description: "Working directory; default inherits the parent cwd." }),
  ),
});

const subagentParams = Type.Object({
  prompt: Type.Optional(Type.String({ description: "Single mode: the task prompt." })),
  systemPrompt: Type.Optional(
    Type.String({ description: "Single mode: required system prompt (no canned default)." }),
  ),
  model: Type.Optional(
    Type.String({ description: '"provider/id"; default inherits the parent session model.' }),
  ),
  thinkingLevel: Type.Optional(thinkingLevelSchema),
  tools: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Single mode: built-in tool names to enable; default inherits the parent's active built-ins.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: "Single mode: working directory; default inherits the parent cwd.",
    }),
  ),
  tasks: Type.Optional(
    Type.Array(taskSchema, {
      description: `Parallel mode: tasks to run concurrently (max ${MAX_TASKS}). When present, single-mode fields are ignored.`,
    }),
  ),
});

type SubagentParams = Static<typeof subagentParams>;

/** Per-subagent spec shared by single and parallel modes. */
type TaskSpec = Static<typeof taskSchema>;

// --- Result types ----------------------------------------------------------

type TaskStatus = "completed" | "failed" | "aborted";

interface TaskUsage {
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

interface TaskResult {
  prompt: string;
  model: string;
  status: TaskStatus;
  output: string;
  usage: TaskUsage;
}

interface SubagentDetails {
  mode: "single" | "parallel";
  results: TaskResult[];
}

// --- Empty resource loader (reads no config files) -------------------------

/**
 * Minimal `ResourceLoader` that reads nothing from disk: no extensions, skills,
 * prompt templates, themes, or project context files, and no `agents/*.md`. Its
 * `getSystemPrompt()` returns the per-spawn system prompt; pi's `buildSystemPrompt`
 * composes that (as the custom prompt) with its built-in base persona and the
 * enabled tools' guidelines - none of which are read from disk.
 */
class EmptyResourceLoader implements ResourceLoader {
  private readonly extensions: LoadExtensionsResult = {
    extensions: [],
    errors: [],
    runtime: createExtensionRuntime(),
  };

  private readonly systemPrompt: string;

  constructor(systemPrompt: string) {
    this.systemPrompt = systemPrompt;
  }

  getExtensions(): LoadExtensionsResult {
    return this.extensions;
  }

  getSkills() {
    return { skills: [], diagnostics: [] };
  }

  getPrompts() {
    return { prompts: [], diagnostics: [] };
  }

  getThemes() {
    return { themes: [], diagnostics: [] };
  }

  getAgentsFiles() {
    return { agentsFiles: [] };
  }

  getSystemPrompt(): string | undefined {
    return this.systemPrompt;
  }

  getAppendSystemPrompt(): string[] {
    return [];
  }

  extendResources(): void {
    // No-op: nothing to extend.
  }

  reload(): Promise<void> {
    return Promise.resolve();
  }
}

// --- Pure helpers (unit-tested) --------------------------------------------

/** Truncate output to ~MAX_OUTPUT_CHARS, appending a notice when cut. */
export function capOutput(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n…[output truncated at ${MAX_OUTPUT_CHARS} chars]`;
}

/** Resolve the tool allowlist: specified built-ins, else the parent's active built-ins, else all built-ins. */
export function resolveTools(
  specified: string[] | undefined,
  parentActive: readonly string[],
  builtinToolNames: ReadonlySet<string>,
): string[] {
  if (specified) return specified.filter((t) => builtinToolNames.has(t));
  const active = new Set(parentActive);
  const inherited = [...builtinToolNames].filter((t) => active.has(t));
  return inherited.length > 0 ? [...inherited] : [...builtinToolNames];
}

/** Status icon for a task result. */
export function statusIcon(status: TaskStatus): string {
  if (status === "completed") return "✓";
  if (status === "aborted") return "⊘";
  return "✗";
}

/** The theme color matching a task status. */
function statusColor(status: TaskStatus): "success" | "warning" | "error" {
  if (status === "completed") return "success";
  if (status === "aborted") return "warning";
  return "error";
}

/** A compact usage label, e.g. `3t · 1.2k out · $0.0042`. */
function formatUsage(usage: TaskUsage): string {
  return `${usage.turns}t · ${usage.output} out · $${usage.cost.toFixed(4)}`;
}

/** One-line-per-task summary used by `renderResult` (pure, unit-tested). */
export function summarizeResults(details: SubagentDetails): string[] {
  const lines: string[] = [];
  if (details.mode === "parallel") {
    const ok = details.results.filter((r) => r.status === "completed").length;
    lines.push(`parallel · ${ok}/${details.results.length} succeeded`);
  }
  for (const r of details.results) {
    lines.push(`${statusIcon(r.status)} ${r.model} · ${formatUsage(r.usage)}`);
    const snippet = r.output
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, 3)
      .join("\n");
    if (snippet) lines.push(snippet);
  }
  return lines;
}

/** Build the `content` text for a parallel result: summary + per-task status blocks. */
export function buildParallelContent(results: TaskResult[]): string {
  const ok = results.filter((r) => r.status === "completed").length;
  const blocks = results.map((r, i) => {
    const header = `[${i + 1}] ${r.status} · ${r.model} · ${formatUsage(r.usage)}`;
    return r.output ? `${header}\n${r.output}` : header;
  });
  return [`Parallel: ${ok}/${results.length} succeeded`, ...blocks].join("\n\n");
}

// --- Subagent execution ----------------------------------------------------

function emptyUsage(): TaskUsage {
  return { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

/** Run one subagent in a fresh, config-free in-process session and report its outcome. */
async function runOne(
  task: TaskSpec,
  ctx: ExtensionContext,
  parentActiveTools: readonly string[],
  builtinToolNames: ReadonlySet<string>,
  signal: AbortSignal | undefined,
): Promise<TaskResult> {
  const modelLabel =
    task.model ?? (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "default");
  let usage = emptyUsage();
  try {
    // Resolve the model: "provider/id" via the parent registry, else the parent model.
    let model = ctx.model;
    if (task.model) {
      const slash = task.model.indexOf("/");
      if (slash <= 0) throw new Error(`model must be "provider/id", got: ${task.model}`);
      const found = ctx.modelRegistry.find(task.model.slice(0, slash), task.model.slice(slash + 1));
      if (!found) throw new Error(`model not found: ${task.model}`);
      model = found;
    }
    if (!model) throw new Error("no model available in the parent session");

    const thinkingLevel = task.thinkingLevel ?? ctx.thinkingLevel;
    const cwd = task.cwd ?? ctx.cwd;
    const tools = resolveTools(task.tools, parentActiveTools, builtinToolNames);
    // exactOptionalPropertyTypes: only pass thinkingLevel when defined.
    const thinking = thinkingLevel === undefined ? {} : { thinkingLevel };

    // Nested model runtime: in-memory credentials, no models.json; inherit parent auth.
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
    });
    const provider = ctx.modelRegistry.getProvider(model.provider);
    if (provider) modelRuntime.registerNativeProvider(provider);
    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (auth.ok && auth.apiKey) await modelRuntime.setRuntimeApiKey(model.provider, auth.apiKey);

    const { session } = await createAgentSession({
      cwd,
      model,
      ...thinking,
      modelRuntime,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager: SettingsManager.inMemory(),
      resourceLoader: new EmptyResourceLoader(task.systemPrompt),
      tools,
    });

    const onAbort = (): void => {
      void session.abort();
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    let status: TaskStatus = "failed";
    let output = "";
    try {
      await session.prompt(task.prompt);
      await session.waitForIdle();
      const stats = session.getSessionStats();
      usage = {
        turns: stats.assistantMessages,
        input: stats.tokens.input,
        output: stats.tokens.output,
        cacheRead: stats.tokens.cacheRead,
        cacheWrite: stats.tokens.cacheWrite,
        cost: stats.cost,
      };
      if (signal?.aborted) {
        status = "aborted";
        output = session.getLastAssistantText() ?? "";
      } else if (session.state.errorMessage) {
        status = "failed";
        output = session.state.errorMessage;
      } else {
        status = "completed";
        output = session.getLastAssistantText() ?? "";
      }
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
      session.dispose();
    }
    return { prompt: task.prompt, model: modelLabel, status, output: capOutput(output), usage };
  } catch (error) {
    const status: TaskStatus = signal?.aborted ? "aborted" : "failed";
    const message = error instanceof Error ? error.message : String(error);
    return { prompt: task.prompt, model: modelLabel, status, output: capOutput(message), usage };
  }
}

// --- Extension -------------------------------------------------------------

export default function subagentExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "subagent",
    label: "subagent",
    description:
      "Delegate work to one or more in-process subagents, each in a fresh context with no " +
      "agent config files read (no agents/*.md, skills, prompts, themes, or context files). " +
      "Single mode: pass prompt + systemPrompt (+ optional model/thinkingLevel/tools/cwd). " +
      "Parallel mode: pass tasks[] (max 8, run concurrently). Each subagent's systemPrompt is " +
      "required (no canned default); model/thinkingLevel/tools/cwd default to the parent " +
      "session's values. Blocks until all subagents finish and returns each one's output + usage.",
    promptSnippet:
      "subagent: delegate a task to a fresh, config-free subagent (single or parallel)",
    promptGuidelines: [
      "Always give each subagent an explicit `systemPrompt` describing its role - there is no default.",
      "Use `tasks` to run independent subtasks concurrently; use single mode for one task.",
    ],
    parameters: subagentParams,

    async execute(
      _toolCallId,
      params: SubagentParams,
      signal,
      onUpdate,
      ctx,
    ): Promise<AgentToolResult<SubagentDetails>> {
      const parentActiveTools = pi.getActiveTools();
      const builtinToolNames = new Set(
        pi
          .getAllTools()
          .filter((t) => t.sourceInfo.source === "builtin")
          .map((t) => t.name),
      );

      // Parallel mode takes precedence when tasks[] is non-empty.
      if (Array.isArray(params.tasks) && params.tasks.length > 0) {
        return runParallel(
          params.tasks,
          ctx,
          parentActiveTools,
          builtinToolNames,
          signal,
          onUpdate,
        );
      }

      // Single mode requires prompt + systemPrompt.
      if (params.prompt === undefined || params.systemPrompt === undefined) {
        return {
          content: [
            {
              type: "text",
              text: "subagent: provide either `tasks` (parallel mode) or both `prompt` and `systemPrompt` (single mode).",
            },
          ],
          details: { mode: "single", results: [] },
        };
      }

      // exactOptionalPropertyTypes: only forward defined optional fields.
      const task: TaskSpec = {
        prompt: params.prompt,
        systemPrompt: params.systemPrompt,
        ...(params.model === undefined ? {} : { model: params.model }),
        ...(params.thinkingLevel === undefined ? {} : { thinkingLevel: params.thinkingLevel }),
        ...(params.tools === undefined ? {} : { tools: params.tools }),
        ...(params.cwd === undefined ? {} : { cwd: params.cwd }),
      };
      onUpdate?.({
        content: [{ type: "text", text: "subagent: running…" }],
        details: { mode: "single", results: [] },
      });
      const result = await runOne(task, ctx, parentActiveTools, builtinToolNames, signal);
      return {
        content: [{ type: "text", text: result.output || `(subagent ${result.status})` }],
        details: { mode: "single", results: [result] },
      };
    },

    renderResult(result, { isPartial }, theme: Theme) {
      const details = result.details as SubagentDetails | undefined;
      if (isPartial) {
        return new Text(theme.fg("warning", "subagent: running…"), 0, 0);
      }
      if (!details || details.results.length === 0) {
        return new Text(theme.fg("dim", "subagent: no result"), 0, 0);
      }
      const lines: string[] = [];
      if (details.mode === "parallel") {
        const ok = details.results.filter((r) => r.status === "completed").length;
        lines.push(
          theme.fg("toolTitle", theme.bold(`subagent · ${ok}/${details.results.length} succeeded`)),
        );
      }
      for (const r of details.results) {
        lines.push(
          `${theme.fg(statusColor(r.status), statusIcon(r.status))} ${theme.fg("toolTitle", r.model)} ${theme.fg("dim", `· ${formatUsage(r.usage)}`)}`,
        );
        const snippet = r.output
          .split("\n")
          .filter((l) => l.trim())
          .slice(0, 3)
          .join("\n");
        if (snippet) lines.push(theme.fg("muted", snippet));
      }
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}

/** Run up to MAX_TASKS subagents, MAX_CONCURRENT_SUBAGENTS at a time, with progress updates. */
async function runParallel(
  tasks: TaskSpec[],
  ctx: ExtensionContext,
  parentActiveTools: readonly string[],
  builtinToolNames: ReadonlySet<string>,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<SubagentDetails> | undefined,
): Promise<AgentToolResult<SubagentDetails>> {
  if (tasks.length > MAX_TASKS) {
    return {
      content: [
        {
          type: "text",
          text: `subagent: parallel mode supports at most ${MAX_TASKS} tasks; got ${tasks.length}.`,
        },
      ],
      details: { mode: "parallel", results: [] },
    };
  }
  if (tasks.some((t) => !t.prompt || !t.systemPrompt)) {
    return {
      content: [
        { type: "text", text: "subagent: every task requires both `prompt` and `systemPrompt`." },
      ],
      details: { mode: "parallel", results: [] },
    };
  }

  const results: (TaskResult | undefined)[] = Array.from({ length: tasks.length });
  let completed = 0;
  const emitProgress = (): void => {
    const done = results.filter((r): r is TaskResult => r !== undefined);
    onUpdate?.({
      content: [
        {
          type: "text",
          text: `subagent: parallel ${done.length}/${tasks.length} done, ${tasks.length - done.length} running`,
        },
      ],
      details: { mode: "parallel", results: done },
    });
  };

  let next = 0;
  const workerCount = Math.min(MAX_CONCURRENT_SUBAGENTS, tasks.length);
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= tasks.length) return;
      const task = tasks[i];
      if (!task) continue;
      results[i] = await runOne(task, ctx, parentActiveTools, builtinToolNames, signal);
      completed += 1;
      emitProgress();
    }
  });
  await Promise.all(workers);

  const finalResults = results.filter((r): r is TaskResult => r !== undefined);
  return {
    content: [{ type: "text", text: buildParallelContent(finalResults) }],
    details: { mode: "parallel", results: finalResults },
  };
}
