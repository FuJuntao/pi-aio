---
"@fujuntao/pi-aio": patch
---

Drop the terminal bell from notify to fix duplicate notifications on iTerm (#45).

The notify extension rang a BEL (`\x07`) alongside every popup. On iTerm (and any
terminal that turns BEL into a notification), that produced a second notification
next to the popup - two notifications per "finished" event. The bell is removed
entirely: a "settled" notification now delivers only the popup (or terminal
escape sequence) plus the window-title cue. A regression test in
`test/notify-e2e.test.ts` asserts no BEL is written on settle.
