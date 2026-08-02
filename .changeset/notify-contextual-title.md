---
"@fujuntao/pi-aio": minor
---

Give the `notify` extension a contextual popup body and a live structural terminal title.

The "settled" popup body is no longer a hardcoded `Finished - waiting for input`
string. It is now a short verbatim preview of pi's last assistant reply -
sanitized (fenced code blocks, inline backticks, stack-trace lines, and shell
prompts are stripped) and truncated to 200 graphemes (grapheme-aware via
`Intl.Segmenter`) - falling back to the static string when the last reply has no
usable text. No LLM is involved: it's a snippet of the reply, with no extra API
calls, latency, or config. The popup `title` stays `Pi`.

The terminal/tab title becomes `Pi · {project} · {activity}`, where `{project}`
is the basename of the session cwd and `{activity}` is `working` (a turn is
running, set on `agent_start`) or `waiting` (pi has settled, set on
`agent_settled`). Unlike the popup, the title is **not** focus-gated - it
updates on every turn so the tab reflects pi's state at a glance even while
you're watching. The OSC 1004 focus gate now governs only the popup.

The popup sender is now popup-only (it no longer sets the title); the event
handlers own the title via a pure `buildTitle` helper. `enabled: false`
suppresses both the popup and all title updates (fully inert, as before). The
preview pipeline lives in a new pure `extensions/notify/preview.ts`, unit-tested
directly; the title lifecycle and the (CI-unobservable) popup focus-gate are
covered end-to-end and by the existing pure `shouldNotifySettled` truth table.
