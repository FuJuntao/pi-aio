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
a bell and window-title cue. Exactly one popup fires per event.

A "settled" notification fires only when the terminal is **not focused** - the
user has switched away. Focus is tracked via OSC 1004 focus events in
interactive (TUI) mode. If focus cannot be detected (the terminal does not
speak OSC 1004, or the session is non-interactive), the notification fires
regardless, so a "done" signal is never swallowed. Tool errors always notify,
regardless of focus. There is no duration threshold.

Config is a single `enabled` field, read from `~/.pi/agent/notify.json` (global)
merged with project-local `.pi/notify.json` (project wins); absent config
defaults to enabled.
