# Contributing to pi-aio

Thanks for contributing! This guide is the single source for the contribution
workflow, coding standards, and repo maintenance. Read it alone and you will know
how to set up, write, commit, and submit a CI-passing PR.

## Dev setup

| Concern              | Choice                                                         |
| -------------------- | -------------------------------------------------------------- |
| Runtime              | Node.js 24 (`.nvmrc`)                                          |
| Package manager      | pnpm, pinned via `packageManager` (corepack)                   |
| Package model        | Single root-level publishable package (`@fujuntao/pi-aio`)     |
| Versioning / release | Changesets                                                     |
| TypeScript           | TS 7 (`typescript`, tsgo-based `tsc`)                          |
| Lint                 | oxlint (type-aware via `oxlint-tsgolint`, correctness-focused) |
| Format               | oxfmt                                                          |
| CI                   | GitHub Actions                                                 |

**Prerequisites:**

- **Node.js ≥ 24** - use `nvm use` (reads `.nvmrc`).
- **pnpm via corepack** - run `corepack enable pnpm` once. The `packageManager`
  field in `package.json` pins the exact pnpm version; corepack provisions it.

`engine-strict` is enforced, so installing on an unsupported Node version fails
fast instead of producing a broken install.

**Getting started:**

```sh
nvm use                 # select Node 24
corepack enable pnpm    # one-time: activate corepack's pnpm shim
pnpm install            # install dependencies
```

## Layout

```
.
├── extensions/         # pi extensions (.ts/.js) - type-checked by tsc
├── skills/             # pi skills (SKILL.md folders / top-level .md)
├── prompts/            # pi prompt templates (.md)
├── themes/             # pi themes (.json)
├── .pi/prompts/        # this repo's private dev-workflow templates (not packaged)
├── .changeset/         # changesets versioning config
├── .github/workflows/  # CI
├── package.json        # @fujuntao/pi-aio manifest (pi key, files allowlist, scripts)
├── tsconfig.json       # single root TS config (noEmit; type-checks extensions/)
├── global.d.ts         # placeholder input keeping tsc green while extensions/ is empty
├── .oxlintrc.json      # oxlint config (type-aware)
└── .oxfmtrc.json       # oxfmt config
```

## Scripts

Run from the repo root:

| Command             | What it does                                     |
| ------------------- | ------------------------------------------------ |
| `pnpm lint`         | Type-aware lint (oxlint).                        |
| `pnpm format`       | Format all files in place (oxfmt).               |
| `pnpm format:check` | Check formatting without writing (used by CI).   |
| `pnpm typecheck`    | Type-check (`tsc --noEmit`).                     |
| `pnpm test`         | Run tests (vitest).                              |
| `pnpm changeset`    | Add a changeset (describe a user-facing change). |
| `pnpm version`      | Apply changesets -> bump versions & changelogs.  |
| `pnpm release`      | Publish the package.                             |

There is no `build` script: pi compiles `.ts` extensions at load time, so the
package ships source directly and `tsc` is type-check-only (`noEmit`).

## Coding standards

### TypeScript

The root [`tsconfig.json`](tsconfig.json) enables two strict settings
that shape how you write TypeScript:

- **`verbatimModuleSyntax`** - type-only imports must be marked so they can be
  elided. Use `import type` (or the inline `type` modifier) for anything used
  only as a type; never import a type as a value.
  ```ts
  import type { Options } from "./options.ts"; // type-only
  import { read, type Config } from "./config.ts"; // mixed: value + inline type
  ```
- **`erasableSyntaxOnly`** - only TypeScript syntax that **erases** to plain
  JavaScript is allowed. Anything that emits runtime code is forbidden:
  - No `enum` - use a union type or an `as const` object instead.
  - No constructor parameter properties (e.g. `constructor(public x: number)`) -
    declare the field and assign it explicitly.
  - No `namespace` / `module` declarations with runtime bodies, and no
    `import =` / `export =` (CommonJS interop).

  If stripping the type annotations would not yield valid JavaScript, it is not
  allowed.

oxlint's `typescript/consistent-type-imports` (inline-type-imports fix style)
and `typescript/no-import-type-side-effects` rules enforce type-only import
hygiene and will flag anything that slips through.

### Lint

[oxlint](https://oxc.rs/docs/guide/usage/linter) runs **type-aware** via
`oxlint-tsgolint` (`typeAware: true` in [`.oxlintrc.json`](.oxlintrc.json)), with
the `correctness` category as errors.

```sh
pnpm lint
```

### Format

[oxfmt](https://oxc.rs/docs/guide/usage/formatter) formats JavaScript, TypeScript,
and JSON. Markdown is not formatted by oxfmt.

```sh
pnpm format         # format in place
pnpm format:check   # verify without writing (CI)
```

### Engine

Node.js **>= 24** (`.nvmrc`). `engine-strict` is enforced in both
[`.npmrc`](.npmrc) and [`pnpm-workspace.yaml`](pnpm-workspace.yaml), so an
install on an unsupported Node version fails immediately rather than producing
a broken environment. Always `nvm use` before installing.

## Adding resources

Resources live in the four conventional directories (`extensions/`, `skills/`,
`prompts/`, `themes/`), also declared explicitly in the `pi` manifest in
`package.json`. Add a file or folder to the matching directory and pi picks it
up automatically when the package is installed.

### Extension

Drop a `.ts` (or `.js`) file in `extensions/`. It is type-checked by
`pnpm typecheck` (`tsc --noEmit`) and loaded by pi at runtime:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Hello from my-extension!", "info");
  });

  pi.registerTool({
    name: "greet",
    label: "Greet",
    description: "Greet someone by name",
    parameters: Type.Object({ name: Type.String() }),
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: {},
      };
    },
  });
}
```

See the pi [extensions docs](https://github.com/earendil-works/pi) for the full
`ExtensionAPI`, events, and tool/command registration.

### Skill

Add a `skills/<name>/SKILL.md` folder (folder skill) or a top-level
`skills/<name>.md` file. Pi discovers skills recursively.

### Prompt template

Add a `prompts/<name>.md` file.

### Theme

Add a `themes/<name>.json` file.

### pi-core peer dependencies

Pi bundles its core packages and provides them at load time. If an extension
imports any of `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`,
`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, or `typebox`, add
it to **`peerDependencies`** at `"*"` - and do **not** bundle it. Add the first
one lazily, only when an extension actually imports it:

```json
{
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "typebox": "*"
  }
}
```

### Depending on other pi packages

To bundle resources from _another_ pi package, add it to both `dependencies`
and `bundledDependencies`, then reference its resources through `node_modules/`
paths in the `pi` manifest:

```json
{
  "dependencies": {
    "some-other-pi-pkg": "^1.0.0"
  },
  "bundledDependencies": ["some-other-pi-pkg"],
  "pi": {
    "extensions": ["./extensions", "node_modules/some-other-pi-pkg/extensions"]
  }
}
```

Pi loads packages with separate module roots, so bundled packages do not collide
or share modules.

## Testing extensions

Tests run on [vitest](https://vitest.dev) (`pnpm test` -> `vitest run`), in CI
with no secrets. Config lives in [`vitest.config.ts`](vitest.config.ts): node
environment, explicit imports (no reliance on globals despite `globals: true`),
file-per-process isolation, offline-by-default, and a 30s timeout for sessions.

Tests live under [`test/`](test/) (not co-located with source), organized by
**behavior domain**, not one file per source module. Name suites
`test/<extension>-<domain>.test.ts`, or group an extension's suites in a
`test/<extension>/` subdirectory as `<domain>.test.ts` - e.g.
`test/notify-e2e.test.ts` (real-runtime behaviors),
`test/notify-selection.test.ts` (the platform -> channel matrix),
`test/notify-channels.test.ts` (per-channel argv/escape bytes),
`test/notify-focus.test.ts` (focus-sequence parsing), `test/notify-config.test.ts`
(config merge/warnings), `test/notify-gating.test.ts` (the settle-gating truth
table), and `test/subagent/e2e.test.ts` + `test/subagent/helpers.test.ts`
(real-runtime behaviors vs pure helpers). `test/harness/` is the shared e2e
harness, not a suite. The `test/` tree is outside the `files` allowlist, so it never ships in
the npm tarball. Import `{ test }` (or `describe` / `it` / `expect`) from
`vitest` explicitly so oxlint never sees undefined globals.

The guiding principle is **test each behavior at the highest level that can
still observe it**: drive impure behavior through the real runtime, and reach
for a pure test only when the runtime can't see the detail (exact argv/escape
bytes, parser chunking, config merge, a platform the test host doesn't run).
There is no test-injection seam in production code - the notify extension's
`notifyExtension(pi)` takes only the pi handle.

- **E2E tests** (`test/notify-e2e.test.ts`) load the extension through pi's real
  runtime and assert the behaviors a user would see - session lifecycle (OSC
  1004 focus-reporting enable/disable, input listener wiring, non-TUI mode,
  `/reload` config re-read), settled-notification gating (fires when focus is
  unknown, suppressed while focused, re-fires after focus-out, silenced when
  disabled), and config warnings. They use the `createExtensionSession` helper
  in [`test/harness/`](test/harness/), which builds an
  in-memory `AgentSession` with `DefaultResourceLoader({
additionalExtensionPaths })` + `fauxProvider` (scripted responses, no API keys,
  no network), injects a recording `ctx.ui` via `session.bindExtensions({
uiContext, mode })` to capture `setTitle` / `notify` / `onTerminalInput`,
  spies on `process.stdout.write` to capture raw OSC/bell writes the extension
  makes directly, and records session events via `session.subscribe`. The
  harness is generic (not notify-specific): `createExtensionSession` loads any
  extension by path, and the pieces it composes - `createFauxRuntime`
  ([`test/harness/faux-runtime.ts`](test/harness/faux-runtime.ts)) and the
  recording-UI + stdout-capture helpers
  ([`test/harness/recording-ui.ts`](test/harness/recording-ui.ts)) - are
  reusable on their own.
- **Pure tests** cover logic the runtime can't observe: the platform -> channel
  matrix (`notify-selection.test.ts`, a `test.each` table mirroring the README's
  "How it notifies" section, with WSL folded in end-to-end), per-channel argv
  and escape sequences (`notify-channels.test.ts` - the pure builder functions
  `terminalNotifierArgs` / `kittySequences` / ..., asserted directly with no
  fakes), focus-sequence parsing (`notify-focus.test.ts`), config merge/warnings
  (`notify-config.test.ts`), and the settle-gating truth table
  (`notify-gating.test.ts`). These take `platform` / `env` / `isTTY` / etc. as
  arguments, so no env or module stubbing is needed.

To add tests for a new extension, add `test/<extension>-<domain>.test.ts`
files (or a `test/<extension>/` subdirectory of `<domain>.test.ts` files) and
reuse `createExtensionSession({ extensionPath, responses?, configFiles?,
rawProjectFiles?, mode? })` from [`test/harness/`](test/harness/) for e2e - pass the
extension's source directory (a dir with `index.ts` loads as one entry), script
the model with `faux.setResponses([...])`, drive with `session.prompt()` +
`waitForIdle()`, and assert on `ui.titles` / `ui.notifies` / `ui.stdoutWrites` /
`eventsOfType(...)`. Use `s.writeProjectFile(".pi/<name>.json", ...)` to flip
config mid-session and `s.session.reload()` to exercise `/reload` (assert
lifecycle side effects only - reload resets the api-registry, retiring the faux
provider, so don't prompt after it). `await cleanup()` in `afterEach` disposes
the session, temp dirs, and the stdout spy.

## Conventional commits

All commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<optional-scope>): <imperative subject>

<optional body>

<optional footer>
```

- **Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
  `build`, `ci`, `chore`, `revert`.
- **Subject:** imperative mood ("add", not "added"), lowercase, no trailing
  period, <= 72 characters.
- **Breaking changes:** add `!` after the type/scope
  (`feat(api)!: drop v1`) and/or a `BREAKING CHANGE:` footer.
- **One logical change per commit** - don't mix refactors with features.

> The PR title follows this same format and becomes the commit message when the
> PR is squash-merged, so get it right on the PR, not just on local commits.

## Branch naming

Branches use `<type>/<short-slug>` with the same type vocabulary as commits:

```
feat/add-auth
fix/null-crash
chore/bump-deps
docs/add-contributing
```

Slug: lowercase, kebab-case, a few words max.

## Pull requests

Open PRs against `main` and follow [`.github/pull_request_template.md`](.github/pull_request_template.md).

- **Summary** - what the change does and why, linking the issue it resolves with
  `Closes #N`.
- **Changeset** - pick one (CI does not verify this):
  - Add a changeset with `pnpm changeset` for **user-facing** changes, or
  - "No changeset needed" for docs/chore/internal-only changes.
- **Test plan** - how you verified the change (commands run, manual steps,
  before/after).

**CI must be green.** Run the full suite locally before pushing:

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
```

These mirror the [CI workflow](.github/workflows/ci.yml). See
[Scripts](#scripts) for what each does.
