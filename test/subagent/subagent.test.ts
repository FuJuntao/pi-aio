/**
 * Tests for the `subagent` extension (`extensions/subagent/index.ts`).
 *
 * The pure helpers (output capping, tool resolution, result summarising) are
 * unit-tested directly. The tool itself is exercised end-to-end through pi's
 * real runtime (createAgentSession + DefaultResourceLoader + fauxProvider, see
 * `test/harness/`): the parent turn is scripted to call the `subagent` tool,
 * and the spawned subagent sessions stream through the same offline faux
 * provider, so no credentials or network are involved.
 */

import { fileURLToPath } from "node:url";

import {
  fauxAssistantMessage,
  fauxToolCall,
  type Context,
  type FauxResponseFactory,
  type ToolResultMessage,
} from "@earendil-works/pi-ai/compat";
import type { SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildParallelContent,
  capOutput,
  resolveTools,
  statusIcon,
  summarizeResults,
} from "../../extensions/subagent/index.ts";
import { type ExtensionSession, createExtensionSession } from "../harness/index.ts";

// The subagent extension lives at `extensions/subagent/index.ts`; passing its
// directory loads `index.ts` as a single extension entry.
const extensionPath = fileURLToPath(new URL("../../extensions/subagent/", import.meta.url));

// Each e2e test gets its own session; clean up so the global faux api-registry
// doesn't leak between cases.
let s: ExtensionSession | undefined;
afterEach(async () => {
  await s?.cleanup();
  s = undefined;
});

// --- E2E helpers -----------------------------------------------------------

interface SubagentTaskResult {
  prompt: string;
  model: string;
  status: "completed" | "failed" | "aborted";
  output: string;
  usage: {
    turns: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
  };
}

interface SubagentDetails {
  mode: "single" | "parallel";
  results: SubagentTaskResult[];
}

/** The `subagent` tool-result messages on the parent session's current branch. */
function subagentToolResults(session: ExtensionSession): ToolResultMessage<SubagentDetails>[] {
  return session.session.sessionManager
    .getBranch()
    .filter((entry): entry is SessionMessageEntry => entry.type === "message")
    .map((entry) => entry.message)
    .filter(
      (message): message is ToolResultMessage<SubagentDetails> =>
        message.role === "toolResult" && message.toolName === "subagent",
    );
}

/** Text of the last user message in a model context (what the subagent was asked). */
function lastUserText(context: Context): string {
  const lastUser = [...context.messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return "";
  const content = lastUser.content;
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

// --- Pure helpers ----------------------------------------------------------

describe("capOutput", () => {
  it("leaves output under the cap untouched", () => {
    expect(capOutput("hello")).toBe("hello");
  });

  it("truncates output past the cap and appends a notice", () => {
    const capped = capOutput("x".repeat(60_000));
    expect(capped.length).toBeLessThan(60_000);
    expect(capped.startsWith("x".repeat(50_000))).toBe(true);
    expect(capped).toContain("truncated");
  });
});

describe("resolveTools", () => {
  it("filters specified tools down to known built-ins", () => {
    expect(resolveTools(["read", "ls", "subagent", "bogus"], [])).toEqual(["read", "ls"]);
  });

  it("inherits the parent's active built-ins when unspecified", () => {
    expect(resolveTools(undefined, ["read", "bash", "subagent"])).toEqual(["read", "bash"]);
  });

  it("falls back to all built-ins when the parent has none active", () => {
    expect(resolveTools(undefined, ["subagent"])).toEqual([
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
    ]);
  });
});

describe("statusIcon", () => {
  it("maps each status to an icon", () => {
    expect(statusIcon("completed")).toBe("✓");
    expect(statusIcon("aborted")).toBe("⊘");
    expect(statusIcon("failed")).toBe("✗");
  });
});

const task = (over: Partial<SubagentTaskResult>): SubagentTaskResult => ({
  prompt: "p",
  model: "faux/faux-1",
  status: "completed",
  output: "out",
  usage: { turns: 1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  ...over,
});

describe("summarizeResults", () => {
  it("prefixes a tally line in parallel mode", () => {
    const lines = summarizeResults({
      mode: "parallel",
      results: [task({}), task({ status: "failed", output: "" })],
    });
    expect(lines[0]).toBe("parallel · 1/2 succeeded");
    expect(lines.some((l) => l.startsWith("✗"))).toBe(true);
  });

  it("omits the tally line in single mode", () => {
    const lines = summarizeResults({ mode: "single", results: [task({})] });
    expect(lines[0]).not.toContain("succeeded");
    expect(lines[0]).toContain("✓");
  });
});

describe("buildParallelContent", () => {
  it("builds a tally header plus one status block per task", () => {
    const content = buildParallelContent([
      task({ output: "first" }),
      task({ status: "aborted", output: "" }),
    ]);
    expect(content).toContain("Parallel: 1/2 succeeded");
    expect(content).toContain("[1] completed");
    expect(content).toContain("first");
    expect(content).toContain("[2] aborted");
  });
});

// --- End-to-end (real runtime, faux provider) ------------------------------

describe("subagent tool (e2e)", () => {
  it("runs a single subagent and returns its output and usage", async () => {
    s = await createExtensionSession({
      extensionPath,
      responses: [
        // Parent turn 1: call the tool.
        fauxAssistantMessage(
          fauxToolCall("subagent", {
            prompt: "child task",
            systemPrompt: "You are a child subagent.",
          }),
        ),
        // Subagent turn: its reply becomes the tool output.
        fauxAssistantMessage("child final output"),
        // Parent turn 2: wrap up.
        fauxAssistantMessage("parent done"),
      ],
    });

    await s.session.prompt("run a subagent");
    await s.session.waitForIdle();

    const results = subagentToolResults(s);
    expect(results).toHaveLength(1);
    const details = results[0]?.details;
    expect(details?.mode).toBe("single");
    expect(details?.results).toHaveLength(1);
    const child = details?.results[0];
    expect(child?.status).toBe("completed");
    expect(child?.output).toBe("child final output");
    expect(child?.usage.turns).toBe(1);
    // The tool's content block carries the child output for the parent.
    const text = results[0]?.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    expect(text).toContain("child final output");
    // Progress was reported while the subagent ran.
    expect(s.eventsOfType("tool_execution_update").length).toBeGreaterThan(0);
  });

  it("reads no config files: project AGENTS.md stays out of the subagent's system prompt", async () => {
    // Planted in the parent cwd - which the subagent inherits - so a config-
    // reading loader would pick it up. The passed systemPrompt must be present.
    let childSystemPrompt: string | undefined;
    const captureChild: FauxResponseFactory = (context) => {
      childSystemPrompt = context.systemPrompt;
      return fauxAssistantMessage("child done");
    };
    s = await createExtensionSession({
      extensionPath,
      rawProjectFiles: { "AGENTS.md": "SENTINEL-PROJECT-CONFIG" },
      responses: [
        fauxAssistantMessage(
          fauxToolCall("subagent", {
            prompt: "child task",
            systemPrompt: "You are a child subagent.",
          }),
        ),
        captureChild,
        fauxAssistantMessage("parent done"),
      ],
    });

    await s.session.prompt("run a subagent");
    await s.session.waitForIdle();

    expect(childSystemPrompt).toBeDefined();
    expect(childSystemPrompt).toContain("You are a child subagent.");
    expect(childSystemPrompt).not.toContain("SENTINEL-PROJECT-CONFIG");
  });

  it("inherits the parent's active built-in tools (minus subagent), and honors an explicit allowlist", async () => {
    const seenTools: string[][] = [];
    const captureTools: FauxResponseFactory = (context) => {
      seenTools.push((context.tools ?? []).map((t) => t.name).sort());
      return fauxAssistantMessage("child done");
    };
    s = await createExtensionSession({
      extensionPath,
      responses: [
        // Child 1: no tools specified -> inherit parent active built-ins.
        fauxAssistantMessage(
          fauxToolCall("subagent", {
            prompt: "inherit tools",
            systemPrompt: "You are a child subagent.",
          }),
        ),
        captureTools,
        fauxAssistantMessage("parent turn done"),
        // Child 2: explicit allowlist.
        fauxAssistantMessage(
          fauxToolCall("subagent", {
            prompt: "explicit tools",
            systemPrompt: "You are a child subagent.",
            tools: ["read", "ls"],
          }),
        ),
        captureTools,
        fauxAssistantMessage("parent done"),
      ],
    });

    await s.session.prompt("first");
    await s.session.waitForIdle();
    // The harness enables pi's default built-ins (read/bash/edit/write); the
    // subagent tool itself must never be exposed to a subagent.
    expect(seenTools[0]).toEqual(["bash", "edit", "read", "write"]);
    expect(seenTools[0]).not.toContain("subagent");

    await s.session.prompt("second");
    await s.session.waitForIdle();
    expect(seenTools[1]).toEqual(["ls", "read"]);
  });

  it("runs parallel subagents concurrently and aggregates their results", async () => {
    // Each child answers with its own prompt so results are attributable
    // regardless of which order the concurrent streams consume the queue.
    const echoPrompt: FauxResponseFactory = (context) =>
      fauxAssistantMessage(`output for ${lastUserText(context)}`);
    s = await createExtensionSession({
      extensionPath,
      responses: [
        fauxAssistantMessage(
          fauxToolCall("subagent", {
            tasks: [
              { prompt: "task A", systemPrompt: "You are subagent A." },
              { prompt: "task B", systemPrompt: "You are subagent B." },
              { prompt: "task C", systemPrompt: "You are subagent C." },
            ],
          }),
        ),
        echoPrompt,
        echoPrompt,
        echoPrompt,
        fauxAssistantMessage("parent done"),
      ],
    });

    await s.session.prompt("run three subagents");
    await s.session.waitForIdle();

    const results = subagentToolResults(s);
    expect(results).toHaveLength(1);
    const details = results[0]?.details;
    expect(details?.mode).toBe("parallel");
    expect(details?.results).toHaveLength(3);
    // Results stay in task order (not completion order).
    expect(details?.results.map((r) => r.status)).toEqual(["completed", "completed", "completed"]);
    expect(details?.results.map((r) => r.output)).toEqual([
      "output for task A",
      "output for task B",
      "output for task C",
    ]);
    const text = results[0]?.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    expect(text).toContain("Parallel: 3/3 succeeded");
  });

  it("propagates abort to a running subagent and resolves with status aborted", async () => {
    let notifyChildEntered: () => void = () => {};
    const childEntered = new Promise<void>((resolve) => {
      notifyChildEntered = resolve;
    });
    // The child stream only starts after a delay, so the abort lands first;
    // the faux provider observes the aborted signal and ends the run aborted.
    const slowChild: FauxResponseFactory = async () => {
      notifyChildEntered();
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return fauxAssistantMessage("too late");
    };
    s = await createExtensionSession({
      extensionPath,
      responses: [
        fauxAssistantMessage(
          fauxToolCall("subagent", {
            prompt: "slow task",
            systemPrompt: "You are a child subagent.",
          }),
        ),
        slowChild,
        fauxAssistantMessage("parent done"),
      ],
    });

    const promptDone = s.session.prompt("run a subagent");
    await childEntered;
    await s.session.abort();
    await promptDone;
    await s.session.waitForIdle();

    const results = subagentToolResults(s);
    expect(results).toHaveLength(1);
    const child = results[0]?.details?.results[0];
    expect(child?.status).toBe("aborted");
    expect(child?.output).not.toContain("too late");
  });
});
