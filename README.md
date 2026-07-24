# pi-extensions

Community extensions for the [pi](https://github.com/earendil-works/pi) coding agent.

This repository is a pnpm monorepo. Extension packages live under `packages/`.

## Toolchain

| Concern              | Choice                                                         |
| -------------------- | -------------------------------------------------------------- |
| Runtime              | Node.js 24 (`.nvmrc`)                                          |
| Package manager      | pnpm, pinned via `packageManager` (corepack)                   |
| Workspaces           | pnpm workspaces — `packages/*`                                 |
| Versioning / release | Changesets                                                     |
| TypeScript           | TS 7 (`typescript`, tsgo-based `tsc`)                          |
| Lint                 | oxlint (type-aware via `oxlint-tsgolint`, correctness-focused) |
| Format               | oxfmt                                                          |
| CI                   | GitHub Actions                                                 |

## Prerequisites

- **Node.js ≥ 24** — use `nvm use` (reads `.nvmrc`).
- **pnpm via corepack** — run `corepack enable pnpm` once. The `packageManager`
  field in `package.json` pins the exact pnpm version; corepack provisions it.

`engine-strict` is enforced, so installing on an unsupported Node version fails
fast instead of producing a broken install.

## Getting started

```sh
nvm use                 # select Node 24
corepack enable pnpm    # one-time: activate corepack's pnpm shim
pnpm install            # install dependencies
```

## Scripts

Run from the repo root:

| Command             | What it does                                     |
| ------------------- | ------------------------------------------------ |
| `pnpm lint`         | Type-aware lint (oxlint).                        |
| `pnpm format`       | Format all files in place (oxfmt).               |
| `pnpm format:check` | Check formatting without writing (used by CI).   |
| `pnpm typecheck`    | Type-check (TS 7 `tsc --noEmit`).                |
| `pnpm build`        | Build every package (`pnpm -r build`).           |
| `pnpm test`         | Test every package (`pnpm -r test`).             |
| `pnpm changeset`    | Add a changeset (describe a user-facing change). |
| `pnpm version`      | Apply changesets → bump versions & changelogs.   |
| `pnpm release`      | Build and publish changed packages.              |

## Layout

```
.
├── packages/            # extension packages (one directory per package)
├── .changeset/          # changesets versioning config
├── .github/workflows/   # CI
├── package.json         # workspace root (private, shared scripts & devDeps)
├── tsconfig.json        # shared base TS config — packages extend this
├── .oxlintrc.json       # oxlint config (type-aware)
└── .oxfmtrc.json        # oxfmt config
```

## Adding a package

Each `packages/<name>`:

- has its own `package.json` (`"type": "module"`, `engines.node: ">=24"`),
- extends the root base config in its `tsconfig.json`:

  ```json
  {
    "extends": "../../tsconfig.json",
    "compilerOptions": {
      "outDir": "dist",
      "rootDir": "src",
      "types": ["node"]
    },
    "include": ["src/**/*.ts"]
  }
  ```

  and depends on `@types/node` in its own `devDependencies` (pnpm's isolated
  `node_modules` does not expose the root's copy to packages).

The base config enables `verbatimModuleSyntax` and `erasableSyntaxOnly`, so code
must use `import type` for type-only imports and stick to erasable TypeScript
syntax.
