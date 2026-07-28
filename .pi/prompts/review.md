---
description: "Two-axis code review (Standards + Spec) of changes since a fixed point - parallel sub-agents when available, single pass otherwise"
argument-hint: "[<fixed-point>] [<spec-path>]"
---

# Review

Two-axis review of the diff between `HEAD` and a fixed point:

- **Standards** - does the code follow this repo's documented coding standards?
- **Spec** - does it faithfully implement the originating issue / PRD / spec?

The two axes are **deliberately separate** - a change can pass one and fail the other - so they are reported under separate `## Standards` and `## Spec` headings and never merged or reranked.

This is a **read-only** review: report findings only. Do not edit, commit, or push. Offer to fix specific findings on request, as a separate step.

**Fixed point:** ${1:-main}. **Spec path (optional):** $2.

## Process

### 1. Resolve the fixed point and the diff

The fixed point is `${1:-main}` - the first argument, or `main` when none is given. It may be a commit SHA, branch, tag, or `HEAD~5`.

Resolve it before anything else:

- `git rev-parse <fixed-point>` must succeed. A bad ref fails here - do not continue into the axes.
- Fallback for the default: if no first argument was given and `main` does not resolve, try `master`. If `master` also fails, ask the user for a fixed point and stop.

Then capture:

- The diff: `git diff <fixed-point>...HEAD` (three-dot - against the merge-base).
- The commits: `git log <fixed-point>..HEAD --oneline`.

If the diff is empty, report that and stop - there is nothing to review.

### 2. Resolve the spec source

Find the originating spec, in this order:

1. **Issue refs in commit messages** - scan the commit list for `Closes #N`, `#N`, or GitLab `!N`. For each GitHub ref, run `gh issue view <N> --json title,body` (`gh` infers the repo from the remote; pass `--repo <owner>/<repo>` for a cross-repo ref). Use the issue title + body as the spec.
2. **Explicit spec-path argument** - `$2`, if given.
3. **A PRD/spec file under `docs/`, `specs/`, or `.scratch/`** matching the branch name or feature.
4. **If none found** - ask the user where the spec is. If they say there isn't one, skip the Spec axis and say so in the report.

### 3. Gather the standards sources

Anything in the repo that documents how code should be written: `CONTRIBUTING.md`, `CODING_STANDARDS.md`, standards parts of `README.md`, `.github/pull_request_template.md`, and the like. Read them.

The Standards axis checks the diff only against these documented repo standards - there is no generic code-smell checklist. Flag anywhere the code diverges from a documented rule, convention, or the pattern shown in the standards docs' own examples; cite the doc and the divergence. If the repo documents no standards at all, say so and report the Standards axis as not applicable. Skip anything tooling already enforces (lint, format, typecheck) - a rule a tool catches is not a review finding.

### 4. Run both axes

If a sub-agent tool with suitable agents is available, spawn **two parallel sub-agents** (one per axis) for context isolation. Embed the diff command, the commit list, and the per-axis inputs below in each sub-agent's task. Otherwise, run both axes in-session. Either way, report them under separate `## Standards` / `## Spec` headings - never merged or reranked.

**Standards axis** - inputs: the diff command, the commit list, and the standards-source files found in step 3.

> Report - per file/hunk where relevant - every place the diff diverges from a documented repo standard: cite the standard (file + the rule, or the example it contradicts). Distinguish hard violations (a clear breach of a documented rule) from nits. Skip anything tooling enforces. Under 400 words.

**Spec axis** - inputs: the diff command, the commit list, and the path or fetched contents of the spec from step 2.

> Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words.

If the spec is missing (step 2 returned nothing and the user confirmed there isn't one), skip the Spec axis and note this in the report.

### 5. Aggregate

Present the two reports under `## Standards` and `## Spec` headings, verbatim or lightly cleaned. Do **not** merge or rerank findings - the two axes are deliberately separate.

End with a one-line per-axis summary: total findings per axis, and the worst issue _within each axis_ (if any). Do not pick a single winner across axes - that is the reranking the separation exists to prevent.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing -> **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions -> **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.
