---
"@fujuntao/pi-aio": patch
---

Fix `notify` producing no notification under Windows Terminal + WSL.

WSL reports `platform === "linux"`, so `notify` tried `notify-send` (not
installed, no display server) and fell through to the OSC 777 terminal escape -
which Windows Terminal does not support in stable builds, so no notification
ever appeared. Meanwhile `powershell.exe` is reachable from WSL via interop and
can fire a real Windows toast, but the Linux branch never tried it.

`notify` now detects WSL (via `/proc/version`, matching the `is-wsl` check) and
routes it to the PowerShell toast channel through `powershell.exe` interop,
which is on PATH by default. WSL interop must be enabled (the default). Over
SSH, the terminal-protocol fallback is still used. Native Linux and other
platforms are unchanged.
