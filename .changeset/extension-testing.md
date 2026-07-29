---
"@fujuntao/pi-aio": patch
---

Establish extension testing with vitest and add notify e2e tests.

`pnpm test` now runs vitest (was a `node --test` no-op placeholder). Tests are
organized by **behavior domain**, not one file per source module, and each
behavior is tested at the highest level that can observe it: impure behavior
through pi's real runtime, pure logic via direct input.

The notify extension's `notifyExtension(pi)` takes only the pi handle - there is
no test-injection seam anywhere in production code. The prior `NotifyDeps` seam
(index.ts) and `ChannelDeps` seam (channels.ts) are both gone: the exact argv /
escape bytes each channel emits live in pure builder functions
(`terminalNotifierArgs`, `kittySequences`, ...) tested directly, and the impure
`send`/`available` wrappers call real `spawn` / `spawnSync` / `process.stdout`.

- **E2E** (`test/notify-e2e.test.ts`) loads the extension through pi's real
  runtime (`createAgentSession` + `DefaultResourceLoader({ additionalExtensionPaths })`)
  driven by pi-ai's `fauxProvider` - no API keys, no network - and asserts the
  behaviors a user sees: session lifecycle (OSC 1004 focus-reporting enable on
  start, disable on `/reload` shutdown, input-listener wiring, non-TUI mode,
  `/reload` config re-read), settled-notification gating (fires when focus is
  unknown, suppressed while focused, re-fires after focus-out, silenced when
  `enabled: false`), and malformed-config warnings. A reusable
  `createExtensionSession` harness (`test/harness/`) injects a recording
  `ctx.ui`, spies on `process.stdout.write` for raw OSC/bell writes, and records
  session events.
- **Pure tests** cover logic the runtime can't observe: the platform -> channel
  matrix (`test/notify-selection.test.ts`, a `test.each` table mirroring the
  README, WSL folded in end-to-end), per-channel argv/escape builders
  (`test/notify-channels.test.ts`), focus-sequence parsing
  (`test/notify-focus.test.ts`), config merge/warnings (`test/notify-config.test.ts`),
  and the settle-gating truth table (`test/notify-gating.test.ts`).

The `desktopPlatform` WSL check is a pure, injectable helper so it is unit-tested
rather than reading `/proc/version` at call time. Tests live in a flat `test/`
directory (never shipped). Adds `vitest` (devDep) and `@earendil-works/pi-ai`
(devDep + peerDep `*`) so the faux provider is directly importable; the peerDep
is non-breaking. See the "Testing extensions" section in CONTRIBUTING.md.
