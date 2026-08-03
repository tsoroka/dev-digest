# Learnings

What earlier sessions in this module learned the hard way: what worked, what didn't,
and the gotchas that cost someone an hour. Append-only, newest first within each
section. The sections below are fixed — never rename, reorder, or add to them.

Not this file: **why** a decision was made (→ `INSIGHTS.md`), how it works today
(→ `README.md`), what we're about to build (→ `specs/`).

Every entry must be actionable cold — a reader who wasn't in that session knows what
to do or avoid without re-investigating. If it would be obvious to anyone reading the
code, it doesn't belong here.

An entry looks like this:

```markdown
### YYYY-MM-DD — <specific title>
The concrete thing: a path, symbol, command, version, threshold, or the literal
error text — plus what to do instead.
```

Written by the `engineering-insights` skill at the end of a session, or by hand.

---

## What Works

_Nothing yet._

## What Doesn't Work

_Nothing yet._

## Codebase Patterns

_Nothing yet._

## Tool & Library Notes

_Nothing yet._

## Recurring Errors & Fixes

### 2026-08-03 — Windows: every flow fails with `spawn agent-browser ENOENT`
`run.ts:45` drives the CLI through `execFile`, which does **not** resolve `.cmd` /
`.ps1` shims — and `npm i -g agent-browser` installs exactly those
(`agent-browser.cmd`, `agent-browser.ps1`), no bare `.exe` on `PATH`. Every step of
every flow fails instantly; the suite reports `0/8 flows passed` with the same
ENOENT on each line, which reads like a missing install but isn't. Point the
existing env knob at the native binary the package ships:

```
AGENT_BROWSER_BIN=C:\Users\<you>\AppData\Roaming\npm\node_modules\agent-browser\bin\agent-browser-win32-x64.exe
```

(Path is `<npm prefix -g>\node_modules\agent-browser\bin\agent-browser-<platform>.exe`.)
`scripts/e2e.sh` passes the variable through to `npm test`, so exporting it before
the script is enough. Unfixed in the runner — a permanent fix would be `shell: true`
or a win32 `.cmd` resolve in `ab()`. Not an issue on Linux/macOS or in CI, so it
only ever bites local Windows work.

## Session Notes

_Nothing yet._

## Open Questions

_Nothing yet._
