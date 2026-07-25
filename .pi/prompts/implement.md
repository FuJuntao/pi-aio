---
description: "Implement a ready-for-agent issue end-to-end: validate, branch, build, check, PR"
argument-hint: "[issue-number-or-url]"
---

# Implement

Implement a GitHub issue end-to-end: validate that it is actionable, build its acceptance criteria, and open a PR.

**Issue:** $@

The argument may be a bare number, `#N`, or a full issue URL - extract the issue number from any of them. If the issue line is empty, skip to "No argument: compute the frontier" below. `gh` infers the repo from this checkout's remote; if a URL points at a different repo, pass `--repo` to the `gh` commands below.

## 1. Fetch and validate

Fetch the issue: `gh issue view <N> --json number,title,body,state,labels`. If it does not exist, say so and stop.

Stop with a clear report of what is blocking when any of these hold:

- **Closed** - the issue is not open.
- **Not labeled** - the issue lacks the `ready-for-agent` label.
- **Blocked** - any blocker is still open. Blockers come from two sources; both count:
  - Native issue dependencies: `gh api repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by` (`gh` fills `{owner}`/`{repo}` from the remote).
  - Body lines starting, case-insensitively, with `Blocked by:` - extract every `#N` ref and issue URL on those lines.

  Check each blocker's state with `gh issue view`. A blocker is resolved only when that issue is closed.

The report names which check failed and, for blockers, each blocking issue with its state.

### No argument: compute the frontier

With no issue given, find what is actionable right now:

1. List candidates: `gh issue list --label ready-for-agent --state open --json number,title,body`.
2. Check each candidate's blockers (both sources above). Candidates whose blockers are all closed form the **frontier**.
3. Present the frontier as a numbered list - issue number, title, and one line on what it delivers, synthesized from the body. Wait for the user to pick one by number or ref, then continue with that issue.
4. If the frontier is empty, report each `ready-for-agent` issue with what is blocking it, and stop.

## 2. Scope guard

Before writing any code, judge whether the issue fits one session. Stop and suggest `/plan-and-implement <issue>` instead of charging ahead when it looks:

- **Murky** - acceptance criteria missing or ambiguous, done-ness unclear, or unresolved questions in the issue.
- **Oversized** - multiple unrelated deliverables, spans several subsystems, or needs architecture decisions the issue does not make.

Stopping here is a correct outcome. The same escape hatch applies mid-implementation: if the work proves murky or oversized while building, stop, report, and suggest `/plan-and-implement <issue>`.

## 3. Branch

Check out a new `<type>/<short-slug>` branch or worktree immediately after validation passes, before any edits. Derive `<type>` from the issue's nature (`feat`, `fix`, `docs`, `refactor`, `chore`, ...).

## 4. Build

Implement the issue's acceptance criteria. Conventional commits (`type(scope): subject`), one logical change per commit.

## 5. Checks

All applicable repo checks must be green before a PR exists: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm build`, `pnpm test`. Fix failures as you go (`pnpm format` for formatting). If a failure cannot be fixed, stop and report - never open a red PR.

## 6. PR

Open a non-draft PR against `main`.

Body: if `.github/pull_request_template.md` exists, follow it. Otherwise:

- A `Closes #N` line.
- An **Acceptance criteria** section mapping each criterion from the issue to what was done, one bullet per criterion.
- A **Checks** section listing what ran green.

No reviewers, assignees, or comments on the issue - the `Closes #N` linkage is the only side effect.
