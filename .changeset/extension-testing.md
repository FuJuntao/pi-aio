---
"@fujuntao/pi-aio": patch
---

Establish extension testing with vitest and add notify e2e tests.

`pnpm test` now runs vitest (was a `node --test` no-op placeholder). The notify
extension gains a true e2e suite that loads it through pi's real runtime
(`createAgentSession` + `DefaultResourceLoader({ additionalExtensionPaths })`)
driven by pi-ai's `fauxProvider` - no API keys, no network - asserting the
agent_settled notification fires end-to-end, is suppressed while the terminal is
focused (the regression-prone OSC 1004 focus gate), re-fires after a focus-out,
and is suppressed when `enabled: false`. A reusable `createExtensionSession`
harness (`test/notify-harness.ts`) injects a recording `ctx.ui` to capture the
side effects that are not observable headless. Tests live in a flat `test/`
directory (never shipped); the existing unit tests (config merge, channel
selection, escaping, focus parsing, WSL platform resolution) run on vitest. The
`desktopPlatform` WSL check is refactored to a pure, injectable helper so it is
unit-tested rather than reading `/proc/version` at call time.

Adds `vitest` (devDep) and `@earendil-works/pi-ai` (devDep + peerDep `*`) so the
faux provider is directly importable; the peerDep is non-breaking. See the new
"Testing extensions" section in CONTRIBUTING.md.
