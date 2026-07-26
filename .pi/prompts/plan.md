---
description: "Plan work for the pi-extensions repo - gather, quiz, publish focused GitHub issues"
argument-hint: "[topic]"
---

# Plan

Plan work **before** implementing. Gather context, quiz the user until you share an understanding, then publish a focused GitHub issue that `/implement` can pick up.

**Topic:** $@

## Process

### 1. Gather context

Understand the problem and the goal. Explore the codebase to see what exists - layout, conventions, prior art in the area you're touching.

### 2. Quiz

Ask the user whatever the spec below can't yet answer - the problem, the desired behavior, the decisions, the scope boundaries. Iterate until you reach a common understanding.

### 3. Publish - only after explicit approval

Present the filled spec for review. Presenting it is not approval: create issues only once the user explicitly approves. Then create each issue with `gh issue create`, labeled `ready-for-agent`.

## Spec

Every issue body uses these sections:

**Background / Problem Statement.** The background and the problem the user faces, from the user's perspective.

**Solution.** The solution, from the user's perspective. This is where done-ness lives - write it so a fresh agent can tell when the work is complete.

**Implementation Decisions.** Decisions made while planning: modules and interfaces to build or modify, technical clarifications, architecture, schema or API contracts. No file paths or code snippets (they go stale); exception: a prototype snippet that encodes a decision (state machine, schema, type shape) - inline just the decision-rich parts.

**Out of Scope (if applicable).** What the issue deliberately does not cover. Omit when empty.

**Further Notes (if applicable).** Anything else worth recording. Omit when empty.

## Keeping issues focused

One issue covers one focused piece of work. When a plan outgrows one focused issue:

- **Default to another issue** - a sibling, not a child.
- **Sub-issues only for genuine breakdowns** - when the extra work is part of the issue itself (part-whole), not just related to it. Create the parent first.

## Done when

- Issues created after explicit approval, each focused and labeled `ready-for-agent`.

Planning is complete here. When ready to build, run `/implement` on the issue, clearing context between issues.
