# notify

A [pi](https://github.com/earendil-works/pi) extension, bundled in
[`@fujuntao/pi-aio`](../..), that tells you when pi needs your attention - even
when you've stepped away from the terminal.

## What it does

pi runs long tasks (refactors, test suites, multi-step agent runs). `notify`
pops up a notification when **pi finishes a run and is waiting for your next
message** (`agent_settled`), so you don't have to keep checking the terminal.

## When it notifies

A "finished" notification fires only when your terminal **isn't focused** - i.e.
you've switched to another window or tab. If you're still looking at pi, it stays
quiet; there's no point notifying someone who's already watching.

If your terminal can't report focus (see [Focus detection](#focus-detection)), or
you're running pi non-interactively (for example `pi -p`), the "finished"
notification fires regardless - it's better to over-notify than to miss a
completed task.

## How it notifies

`notify` picks the best available delivery automatically - exactly one popup per
event, never several at once:

| Where                                  | How                                                                  |
| -------------------------------------- | -------------------------------------------------------------------- |
| In iTerm2 or Kitty                     | iTerm2 OSC 9 / Kitty OSC 99 (the terminal's native notification)     |
| macOS                                  | `terminal-notifier`, falling back to `osascript`                     |
| Linux                                  | `notify-send`                                                        |
| Windows                                | a PowerShell toast                                                   |
| WSL                                    | a PowerShell toast, via `powershell.exe` interop                     |
| Over SSH, or no desktop binary present | a terminal escape sequence: Kitty OSC 99, iTerm2 OSC 9, else OSC 777 |

Every popup also sets a **window-title** cue (`Pi: …`). There is no bell -
iTerm and similar terminals turn BEL into a notification, which doubled up
alongside the popup (see [#45](https://github.com/FuJuntao/pi-aio/issues/45)).
In iTerm2 or Kitty the popup _is_ the terminal's native OSC notification, so
nothing extra is spawned; the BEL that closes an OSC sequence is its string
terminator, not a bell.

## WSL

WSL reports as Linux but has no `notify-send` or display server by default, and
Windows Terminal does not support the OSC 777 notify sequence in stable builds -
so without WSL handling, no notification ever appears. `notify` detects WSL
(via `/proc/version`) and uses the Windows PowerShell toast through `powershell.exe`
interop instead, which is on PATH by default. WSL interop must be enabled (the
default) for this to work; see
[WSL interop](https://learn.microsoft.com/en-us/windows/dev-environment/wsl/interop).

## Focus detection

Focus is tracked with the terminal's **OSC 1004** focus-reporting mode, which is
supported by most modern terminals (iTerm2, Kitty, GNOME Terminal, xterm,
Windows Terminal, …), sometimes behind a setting. `notify` enables it for the
duration of a pi session and turns it off again when the session ends.

Until the terminal reports its first focus change, `notify` can't be sure you're
watching, so it plays it safe and notifies on "finished". Once a focus-in or
focus-out arrives, it gates accordingly.

If your terminal doesn't speak OSC 1004 at all, `notify` falls back to always
notifying on "finished".

## Configuration

A single field, `enabled`:

```json
{ "enabled": false }
```

Read from two files - **project-local wins over global**, and absent config means
enabled:

- Global: `~/.pi/agent/notify.json`
- Project: `<project>/.pi/notify.json`

Set `enabled` to `false` to silence all notifications without uninstalling. Use
`/reload` to pick up config changes in a project session.

## Installation

`notify` is bundled in `@fujuntao/pi-aio`:

```sh
pi install npm:@fujuntao/pi-aio
```

Once installed, pi loads it automatically - no further setup.

## Troubleshooting

- **No notifications at all** - check that `enabled` isn't `false` in
  `~/.pi/agent/notify.json` or `<project>/.pi/notify.json`.
- **No notification on WSL** - `notify` fires the toast through `powershell.exe`
  interop. Check that `powershell.exe` is on PATH inside WSL; if not, WSL interop
  is disabled - re-enable `[Interop]` / `appendWindowsPath` in `/etc/wsl.conf`.
  Windows Terminal's OSC 777 fallback is not in stable, so the PowerShell toast
  is what makes WSL work.
- **"Finished" notifications fire even while I'm focused** - your terminal
  likely doesn't support OSC 1004 focus reporting (or has it disabled), so
  `notify` falls back to always-notify. This is expected; the popup is the
  signal that pi is waiting.
- **No desktop popup over SSH** - over SSH, `notify` uses a terminal escape
  sequence instead of a desktop notification. Make sure your terminal supports
  OSC 777/9/99 and that pi's stdout is a TTY.
- **`notify-send` not found on Linux** - install it (for example `libnotify-bin`
  on Debian/Ubuntu) and ensure a `DISPLAY` or `WAYLAND_DISPLAY` session is
  present.
