---
"@fujuntao/pi-aio": minor
---

Add a `subagent` extension that registers a `subagent` tool, letting pi
delegate work to one or more in-process subagents. Each subagent runs in a
fresh in-memory context with a config-free resource loader: no
`AGENTS.md`/`agents/*.md`, skills, prompt templates, themes, or project context
files are read, and no `auth.json`/`models.json` is touched - model and auth
are inherited in memory from the parent session.

The tool supports a single mode (`prompt` + `systemPrompt`) and a parallel
mode (`tasks`, up to 8 subagents with at most 4 running concurrently), blocks
until all subagents finish, and returns each one's final output plus usage
(`{ turns, input, output, cacheRead, cacheWrite, cost }`). Each subagent's
`systemPrompt` is required (no canned default); `model`, `thinkingLevel`,
`tools`, and `cwd` default to the parent session's values. Aborting the parent
run propagates to running subagents and resolves with a clean `aborted`
status. Per-task output is capped at ~50 KB.

Note: the tool name `subagent` collides with the `pi-subagents` extension if
both load in one session - don't load both.
