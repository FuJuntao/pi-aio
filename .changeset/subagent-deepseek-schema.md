---
"@fujuntao/pi-aio": minor
---

Redesign the `subagent` tool's `parameters` as a single `agents` array so its
JSON schema is DeepSeek-compatible.

BREAKING CHANGE: the tool no longer accepts separate single-mode
(`prompt`/`systemPrompt`) and parallel-mode (`tasks`) shapes. Callers now pass
a single `agents` array (1..8) whose length selects the mode - one element runs
a solo subagent, several run concurrently. The per-agent shape
(`{ prompt, systemPrompt, model?, thinkingLevel?, tools?, cwd? }`) is unchanged.

The previous schema used a root `Type.Union` (single | parallel), which typebox
emits as a top-level `anyOf` with no `type`. DeepSeek rejects that with HTTP 400
("schema must be a JSON Schema of type: object, got type: null"). The new
schema is a single root `Type.Object` with a required `agents` field -
`{ type: "object", required: ["agents"] }` - and contains no `anyOf`/`oneOf`
anywhere in the tree, including the per-agent `thinkingLevel`, which is now
`{ type: "string", enum: [...] }` instead of a `Union` of literals. Runtime mode
detection (solo vs concurrent) and the abort/usage behavior are unchanged.
