---
description: Plan work for the pi-extensions monorepo - discuss, break into GitHub issues
argument-hint: "[topic]"
---
# Plan

Plan work **before** implementing. Frame the problem, then break it into tracer-bullet GitHub issues that `/implement` can pick up one at a time.

**Topic:** ${1:-<ask the user what to plan>}

## Repo context

- pnpm monorepo; packages under `packages/`.
- Issue tracker = GitHub issues. Tickets are issues labeled `ready-for-agent`, with blocking edges between them.
- Domain glossary = `CONTEXT.md`; decisions = ADRs under `docs/adr/`. Use the glossary's vocabulary in ticket titles/descriptions; respect ADRs in the area you touch.

## Phases

### 1. Frame

Understand the problem and goal; explore the codebase to see what exists. Confirm the approach with the user before breaking it down.

### 2. Break into tickets

**Prefactor first.** If a small refactor would make the real change easy ("make the change easy, then make the easy change"), do it as the first ticket.

**Vertical slices.** Break the work into tracer-bullet tickets - each a narrow but complete path through every layer (schema/API/UI/tests), demoable on its own, sized for one fresh context window. Vertical, not a one-layer horizontal slice.

**Blocking edges.** Give each ticket the tickets that must complete before it can start. No blockers = can start immediately.

**Wide refactors are the exception.** A wide refactor (one mechanical change whose blast radius spans the codebase - a rename or retype) can't land green as a vertical slice. Sequence it expand-contract: add the new form beside the old (expand); migrate call sites in batches, each its own ticket blocked by the expand, keeping CI green because the old form still exists; delete the old form once no caller remains (contract, blocked by every migrate batch).

**Quiz the user.** Present the proposed breakdown as a numbered list. For each ticket, show:

- **Title**: short descriptive name
- **Blocked by**: which other tickets (if any) must complete first
- **What it delivers**: the end-to-end behaviour this ticket makes work

Then ask:

- Does the granularity feel right? (too coarse / too fine)
- Are the blocking edges correct - does each ticket only depend on tickets that genuinely gate it?
- Should any tickets be merged or split further?

Iterate until the user approves the breakdown.

**Publish in dependency order** (blockers first) so each ticket can reference its blockers. Create each as a GitHub issue (`gh issue create`) labeled `ready-for-agent`; link blockers with native issue dependencies, or `Blocked by: #N, #N` at the top of the body.

**Ticket content.** Describe what to build as end-to-end behaviour from the user's perspective - not layer-by-layer implementation. Add acceptance criteria as checkboxes. Avoid file paths and code snippets (they go stale); exception: a prototype snippet that encodes a decision (schema, type shape, state machine) - inline just the decision-rich parts.

## Done when

- Issues created in dependency order, each `ready-for-agent`, with correct blocking edges.

Planning is complete here. Optionally, when ready to build, take the frontier issue (no open blockers) and run `/implement`, clearing context between tickets.
