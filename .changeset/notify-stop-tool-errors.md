---
"@fujuntao/pi-aio": minor
---

Remove tool-error notifications from the `notify` extension. The extension now
fires on exactly one trigger - `agent_settled` (focus-gated) - and no longer
pops up a notification, rings the bell, or rewrites the window title when a tool
call errors. Tool failures during normal agent work (an empty grep, a missing
file, a non-zero command) were producing noisy notifications even when the user
was watching the terminal, drowning out the genuinely useful "pi is done and
waiting" signal.

The `NotifyUrgency` type and the `urgency` field on `NotifyPayload` are dropped:
`tool_result` was the only producer of `urgency: "error"`, so the field became
dead. Each channel now hardcodes the formerly-"info" sound/flag
(`terminal-notifier`/`osascript` use the `default` sound; `notify-send` passes
`--urgency normal`). The PowerShell toast and terminal-protocol channels
already ignored urgency and are unchanged. The `enabled` config and focus-gating
behavior are unchanged.
