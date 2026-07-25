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
| `pnpm typecheck`    | Type-check (project references, `tsc --build`).  |
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
├── tsconfig.json        # shared base TS config — also the project-references solution root
├── .oxlintrc.json       # oxlint config (type-aware)
└── .oxfmtrc.json        # oxfmt config
```

## Adding a package

Each `packages/<name>` is a TypeScript **project reference** of the root
`tsconfig.json`, so the root `pnpm typecheck` (`tsc --build`) type-checks it.

1. Create `packages/<name>` with its own `package.json` (`"type": "module"`,
   `engines.node: ">=24"`).
2. Add a `tsconfig.json` that extends the root base config and is `composite`
   so it can be referenced:

   ```json
   {
     "extends": "../../tsconfig.json",
     "compilerOptions": {
       "composite": true,
       "types": ["node"]
     },
     "include": ["src/**/*.ts"]
   }
   ```

   `include` is required: the root base sets `files: []` (so the root solution
   config does not pull in every `.ts` in the repo), and that empty list is
   inherited - so each package must override it with `include` to compile its
   `src`. (`outDir`/`rootDir` are omitted because the base's `noEmit` makes them
   no-ops.) Depend on `@types/node` in the package's own `devDependencies` -
   pnpm's isolated `node_modules` does not expose the root's copy to packages.

3. Register the package in the root `tsconfig.json` by adding a `references`
   entry (create the `references` array when adding the first package):

   ```json
   { "path": "packages/<name>" }
   ```

The base config enables `verbatimModuleSyntax` and `erasableSyntaxOnly`, so code
must use `import type` for type-only imports and stick to erasable TypeScript
syntax. `tsc --build` type-checks every referenced package; with `noEmit`
retained it emits only `.tsbuildinfo` (already gitignored), no `.js`/`.d.ts`.
