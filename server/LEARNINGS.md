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

### 2026-08-02 — Hand-writing a Drizzle migration needs all THREE artifacts, not just the SQL
`src/db/migrate.ts` (drizzle-orm's postgres-js migrator) reads only `meta/_journal.json`
plus the `.sql` files — it never opens `meta/NNNN_snapshot.json`. So a hand-written
migration with no snapshot applies cleanly and looks correct. It breaks later: the next
`pnpm db:generate` diffs against the last snapshot it *can* see and re-emits the same
`ALTER TABLE … ADD COLUMN`, producing a migration that fails on every DB that already ran
yours. Write `NNNN_<tag>.sql`, the journal entry (`tag` must equal the `.sql` filename
without extension), and `meta/NNNN_snapshot.json` (copy the previous snapshot, set a fresh
`id`, set `prevId` to the previous snapshot's `id`, then edit the column block).

## What Doesn't Work

### 2026-08-02 — Generating `db/migrations/meta/*.json` with awk or sed silently destroys CRLF
Those files are CRLF-terminated with **no trailing newline**. Git Bash's awk and sed read
and write in text mode here: `awk '{print}' 0009_snapshot.json > 0010_snapshot.json` strips
every `\r`, so `git diff` reports all ~3400 lines changed instead of the 6 you added, and
`head -c -1` on top of it silently trims the wrong byte. Use PowerShell for byte-exact work:
`[System.IO.File]::ReadAllText` → string edits → `WriteAllText($path, $s, (New-Object
System.Text.UTF8Encoding($false)))`, joining lines with `` "`r`n" `` and no trailing newline.
Verify with `head -c 60 <file> | od -c` before trusting the diff.

## Codebase Patterns

### 2026-08-02 — Editing a contract in `src/vendor/shared/` fails at RUNTIME, not compile time
`server/src/vendor/shared/` and `client/src/vendor/shared/` are two hand-maintained copies
of the same Zod contracts (each package aliases `@devdigest/shared` to its own). Nothing
enforces the pair — no sync script, no CI check — and the server serializes while the client
only casts, so a one-sided edit typechecks in both packages and then shows up as a missing
field in the browser. Always edit both in the same commit and finish with
`diff server/src/vendor/shared/contracts/<f>.ts client/src/vendor/shared/contracts/<f>.ts`.
Note `contracts/trace.ts` has ~5 lines of **pre-existing** doc-comment drift (`T1.3`/`T3` on
the server vs `repo-intel` on the client) — that's the expected diff, not something to "fix".

## Tool & Library Notes

_Nothing yet._

## Recurring Errors & Fixes

_Nothing yet._

## Session Notes

### 2026-08-02 — Restored run cost end to end (L01 Run Cost Badge)
Re-added `agent_runs.cost_usd` (migration `0010_add_agent_run_cost`, reversing `0009`),
re-threaded `costUsd` through `run-executor` → `completeAgentRun` → `run_traces.stats`, added
`PrMeta.total_cost_usd` as a SUM-over-all-runs computed on read in `modules/pulls/routes.ts`,
and seeded three demo runs (one deliberately unpriced) for PR #482. `reviewer-core` needed no
change — it already returned `costUsd`; the executor was destructuring it away.

## Open Questions

_Nothing yet._
