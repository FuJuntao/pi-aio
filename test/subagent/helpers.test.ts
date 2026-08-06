/**
 * Pure-helper tests for the `subagent` extension
 * (`extensions/subagent/index.ts`): output capping, tool resolution, status
 * icons, and result summarising. The tool itself is exercised end-to-end in
 * `test/subagent/e2e.test.ts`.
 */

import { describe, expect, it } from "vitest";

import {
  buildParallelContent,
  capOutput,
  resolveTools,
  statusIcon,
  summarizeResults,
} from "../../extensions/subagent/index.ts";

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

const task = (over: Partial<SubagentTaskResult>): SubagentTaskResult => ({
  prompt: "p",
  model: "faux/faux-1",
  status: "completed",
  output: "out",
  usage: { turns: 1, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
  ...over,
});

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
  const BUILTIN_SET = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);

  it("filters specified tools down to known built-ins", () => {
    expect(resolveTools(["read", "ls", "subagent", "bogus"], [], BUILTIN_SET)).toEqual([
      "read",
      "ls",
    ]);
  });

  it("inherits the parent's active built-ins when unspecified", () => {
    expect(resolveTools(undefined, ["read", "bash", "subagent"], BUILTIN_SET)).toEqual([
      "read",
      "bash",
    ]);
  });

  it("falls back to all built-ins when the parent has none active", () => {
    expect(resolveTools(undefined, ["subagent"], BUILTIN_SET)).toEqual([
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
