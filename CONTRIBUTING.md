# Contributing to pi-extensions

Thanks for contributing! This guide is the single source for the contribution
workflow and coding standards. Read it alone and you will know how to set up,
write, commit, and submit a CI-passing PR.

Toolchain, scripts, and adding resources are covered in the [README](README.md)
and linked from here rather than duplicated; this document owns the workflow and
standards narrative.

## Installing the package

Install `@fujuntao/pi-aio` into your pi environment with:

```sh
pi install npm:@fujuntao/pi-aio
```

`pi install` accepts npm, git, and local-path sources and writes to user or
project settings; see `pi install --help` for details.

## Dev setup

The full toolchain and prerequisites live in the
[README](README.md#toolchain). In short:

- **Node.js >= 24** - `nvm use` reads `.nvmrc`. `engine-strict` is on, so
  installing on an older Node fails fast.
- **pnpm via corepack** - `corepack enable pnpm` once; the `packageManager`
  field pins the exact version.
- **Install** - `pnpm install`.

See [Prerequisites](README.md#prerequisites) and
[Getting started](README.md#getting-started) for details.

## Coding standards

### TypeScript

The root [`tsconfig.json`](tsconfig.json) enables two strict settings
that shape how you write TypeScript:

- **`verbatimModuleSyntax`** - type-only imports must be marked so they can be
  elided. Use `import type` (or the inline `type` modifier) for anything used
  only as a type; never import a type as a value.
  ```ts
  import type { Options } from "./options.js"; // type-only
  import { read, type Config } from "./config.js"; // mixed: value + inline type
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
install on an unsupported Node version fails immediately rather than producing a
broken environment. Always `nvm use` before installing.

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
[Scripts](README.md#scripts) for what each does.

## Adding resources

Resources (extensions, skills, prompt templates, themes) live in the
conventional root directories declared in the `pi` manifest. See
[Adding resources](README.md#adding-resources) in the README for where to place
each kind, when to add pi-core `peerDependencies`, and the
`bundledDependencies` pattern for depending on other pi packages.
