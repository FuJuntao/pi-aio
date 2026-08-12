/**
 * Schema shape tests for the `subagent` tool's `parameters`.
 *
 * The concern: some providers (notably DeepSeek) reject a tool whose root JSON
 * schema is a `Type.Union` (emitted as a top-level `anyOf` with no `type`),
 * returning HTTP 400 ("schema must be a JSON Schema of type: object, got type:
 * null"). These tests pin the schema to a single root `Type.Object` with a
 * required `agents` array and assert there is no `anyOf`/`oneOf` anywhere in the
 * tree - including the per-agent `thinkingLevel`, which is hardened to
 * `{ type: "string", enum: [...] }` rather than a `Union` of literals.
 *
 * pi-ai passes `tool.parameters` verbatim to the provider, so the assertions
 * run against the exact wire format (`JSON.stringify` drops typebox's
 * non-enumerable `~unsafe`/`~kind` markers, matching what the model sees).
 */

import { describe, expect, it } from "vitest";

import { subagentParams, thinkingLevelSchema } from "../../extensions/subagent/index.ts";

// Exact JSON a provider receives: non-enumerable typebox markers are stripped.
const schema = JSON.parse(JSON.stringify(subagentParams)) as {
  type: string;
  required: string[];
  properties: {
    agents: {
      type: string;
      minItems: number;
      maxItems: number;
      anyOf?: unknown;
      items: {
        type: string;
        required: string[];
        properties: {
          prompt: { type: string };
          systemPrompt: { type: string };
          model: { type: string };
          thinkingLevel: { type: string; enum: string[] };
          tools: { type: string };
          cwd: { type: string };
        };
      };
    };
  };
};

describe("subagent params schema", () => {
  it("has a single root object with a required `agents` field (no root anyOf)", () => {
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["agents"]);
    expect(schema.properties.agents.anyOf).toBeUndefined();
  });

  it("defines `agents` as a 1..8 array of task objects", () => {
    const agents = schema.properties.agents;
    expect(agents.type).toBe("array");
    expect(agents.minItems).toBe(1);
    expect(agents.maxItems).toBe(8);
  });

  it("requires `prompt` + `systemPrompt` per task with optional extras", () => {
    const task = schema.properties.agents.items;
    expect(task.type).toBe("object");
    expect(task.required).toEqual(["prompt", "systemPrompt"]);
    const props = task.properties;
    expect(props.prompt.type).toBe("string");
    expect(props.systemPrompt.type).toBe("string");
    expect(props.model.type).toBe("string");
    expect(props.tools.type).toBe("array");
    expect(props.cwd.type).toBe("string");
  });

  it("emits thinkingLevel as { type: 'string', enum: [...] } (no property anyOf)", () => {
    expect(schema.properties.agents.items.properties.thinkingLevel).toEqual({
      type: "string",
      enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    });
  });

  it("contains no `anyOf`/`oneOf` anywhere in the schema tree", () => {
    const hits = { anyOf: 0, oneOf: 0 };
    const stack: unknown[] = [schema];
    while (stack.length > 0) {
      const node = stack.pop() as Record<string, unknown> | null;
      if (!node || typeof node !== "object") continue;
      if (node["anyOf"] !== undefined) hits.anyOf++;
      if (node["oneOf"] !== undefined) hits.oneOf++;
      const props = node["properties"];
      if (props && typeof props === "object") {
        for (const value of Object.values(props as Record<string, unknown>)) stack.push(value);
      }
      if (node["items"]) stack.push(node["items"]);
      if (Array.isArray(node["anyOf"])) {
        for (const member of node["anyOf"] as unknown[]) stack.push(member);
      }
      if (Array.isArray(node["oneOf"])) {
        for (const member of node["oneOf"] as unknown[]) stack.push(member);
      }
    }
    expect(hits).toEqual({ anyOf: 0, oneOf: 0 });
  });

  it("exports thinkingLevelSchema as the clean enum shape", () => {
    expect(JSON.parse(JSON.stringify(thinkingLevelSchema))).toEqual({
      type: "string",
      enum: ["off", "minimal", "low", "medium", "high", "xhigh", "max"],
    });
  });
});
