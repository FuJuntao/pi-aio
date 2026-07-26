---
"@fujuntao/pi-aio": minor
---

Add a `notify` extension that delivers cross-platform notifications when pi
needs the user: when it settles and is waiting for input (`agent_settled`) and
when a tool errors (`tool_result` with `isError`).

It auto-selects the delivery: a native desktop notification when local
(`terminal-notifier`/`osascript` on macOS, `notify-send` on Linux, PowerShell
toast on Windows), or a terminal-protocol notification over SSH / when no
desktop binary is present (iTerm2 OSC 9, Kitty OSC 99, generic OSC 777) - plus
a bell and window-title cue. Exactly one popup fires per event. A 10-second
minimum-duration threshold keeps quick turns quiet; tool errors always notify.

Config is a single `enabled` field, read from `~/.pi/agent/notify.json` (global)
merged with project-local `.pi/notify.json` (project wins); absent config
defaults to enabled.
