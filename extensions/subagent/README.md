# subagent

A [pi](https://github.com/earendil-works/pi) extension, bundled in
[`@fujuntao/pi-aio`](../..), that lets pi delegate work to one or more
in-process subagents - each running in a **fresh, config-free context**.

## What it does

The extension registers a single `subagent` tool. When pi calls it, the tool
spawns a nested agent session in the same process, blocks until it finishes,
and returns the subagent's final output plus token/cost usage. Two modes:

- **Single** - pass `prompt` + `systemPrompt` for one subagent.
- **Parallel** - pass `tasks` (up to 8) to run several subagents concurrently
  (at most 4 at a time), and get one aggregated result back.

Each subagent gets:

- a **fresh in-memory context** - no parent conversation, no session
  persistence;
- a **config-free resource loader** - no `AGENTS.md`/`agents/*.md`, skills,
  prompt templates, themes, or project context files are read, and no
  `auth.json`/`models.json` is touched (auth is inherited in memory from the
  parent session);
- a **required, caller-specified `systemPrompt`** - there is no canned
  default; the main agent decides each subagent's persona and instructions.
  (pi still prepends its built-in base persona and tool guidelines, so
  subagents can use tools sensibly.)

## Tool parameters

| Field           | Single | Parallel | Meaning                                                                                                                                              |
| --------------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt`        | ✓ req  | per task | The task for the subagent.                                                                                                                           |
| `systemPrompt`  | ✓ req  | per task | The subagent's system prompt (required; no default).                                                                                                 |
| `tasks`         | -      | ✓ req    | Array of `{prompt, systemPrompt, ...}` (max 8).                                                                                                      |
| `model`         | opt    | per task | `"provider/id"`; default inherits the parent session's model.                                                                                        |
| `thinkingLevel` | opt    | per task | `off`…`max`; default inherits the parent's thinking level.                                                                                           |
| `tools`         | opt    | per task | Built-in tool allowlist (`read`/`bash`/`edit`/`write`/`grep`/`find`/`ls`); default inherits the parent's active built-ins (never `subagent` itself). |
| `cwd`           | opt    | per task | Working directory; default inherits the parent's cwd.                                                                                                |

When `tasks` is present, the single-mode fields are ignored.

## Results and abort

The tool result's `details` is `{ mode, results[] }`, where each result is
`{ prompt, model, status, output, usage }` with `status` one of
`completed` / `failed` / `aborted` and `usage` carrying
`{ turns, input, output, cacheRead, cacheWrite, cost }`. Per-task output is
capped at ~50 KB. Results stay in task order, not completion order, and
progress is streamed to the UI while subagents run.

Aborting the parent run (Esc/Ctrl+C) propagates to every running subagent;
the tool then resolves cleanly with `status: "aborted"` instead of failing.

## Caveats

- **Name collision**: the tool name `subagent` clashes with the
  [`pi-subagents`](https://github.com/earendil-works/pi-subagents) extension -
  don't load both in one session.
- Subagents can't spawn subagents: the `subagent` tool is never included in a
  subagent's tool set.
- Subagents are synchronous: the parent turn blocks until all spawned
  subagents finish.

## Development

Pure helpers (output capping, tool resolution, result summarising) are unit
tested in [`test/subagent/helpers.test.ts`](../../test/subagent/helpers.test.ts);
the tool is exercised end-to-end through pi's real runtime with the offline
faux provider in [`test/subagent/e2e.test.ts`](../../test/subagent/e2e.test.ts).
