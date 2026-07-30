---
"@fujuntao/pi-aio": patch
---

Prefer a detected terminal's native OSC notification over a desktop binary (iTerm2, Kitty) (#45 follow-up).

The #45 fix dropped the terminal bell to stop iTerm from showing a second
notification. But on macOS the local popup was still `osascript` (a spawned
"script notification"), and the only "iTerm notification" - the bell - was the
thing #45 removed: "script notification left, iTerm notification gone", the
opposite of what was wanted.

`choosePopupKind` now prefers a _detected_ terminal protocol - iTerm2 OSC 9 or
Kitty OSC 99 (reliable via `ITERM_SESSION_ID` / `KITTY_WINDOW_ID`) - over a
desktop binary when local. The notification is delivered by the terminal the
user is in and spawns no process; no bell (the BEL that closes an OSC sequence
is its string terminator, not a bell) and no duplication. The generic OSC 777
fallback is deliberately NOT preferred over a desktop binary - Terminal.app and
Windows Terminal ignore it - so it stays the last resort, and non-iTerm/Kitty
macs keep getting `osascript`/`terminal-notifier`.
