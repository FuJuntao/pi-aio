# pi-extensions

A single, root-level [pi](https://github.com/earendil-works/pi) package -
`@fujuntao/pi-aio` - bundling extensions, skills, prompt templates, and themes
for the pi coding agent. Pi loads `.ts` extensions directly, so this package
ships source (`.ts`/`.md`/`.json`) with no build step.

> The repo's own dev-workflow prompt templates live in `.pi/prompts/` and are
> **not** part of the published package.

## Toolchain

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

## Prerequisites

- **Node.js ≥ 24** - use `nvm use` (reads `.nvmrc`).
- **pnpm via corepack** - run `corepack enable pnpm` once. The `packageManager`
  field in `package.json` pins the exact pnpm version; corepack provisions it.

`engine-strict` is enforced, so installing on an unsupported Node version fails
fast instead of producing a broken install.

## Getting started

```sh
nvm use                 # select Node 24
corepack enable pnpm    # one-time: activate corepack's pnpm shim
pnpm install            # install dependencies
```

## Installing the package

Install `@fujuntao/pi-aio` into your pi environment with:

```sh
pi install npm:@fujuntao/pi-aio
```

`pi install` accepts npm, git, and local-path sources and writes to user or
project settings; see `pi install --help` for details.

## Scripts

Run from the repo root:

| Command             | What it does                                     |
| ------------------- | ------------------------------------------------ |
| `pnpm lint`         | Type-aware lint (oxlint).                        |
| `pnpm format`       | Format all files in place (oxfmt).               |
| `pnpm format:check` | Check formatting without writing (used by CI).   |
| `pnpm typecheck`    | Type-check (`tsc --noEmit`).                     |
| `pnpm test`         | No-op placeholder (no tests yet).                |
| `pnpm changeset`    | Add a changeset (describe a user-facing change). |
| `pnpm version`      | Apply changesets -> bump versions & changelogs.  |
| `pnpm release`      | Publish the package.                             |

There is no `build` script: pi compiles `.ts` extensions at load time, so the
package ships source directly and `tsc` is type-check-only (`noEmit`).

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
