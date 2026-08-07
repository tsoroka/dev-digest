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

### 2026-08-07 — A PreToolUse Bash matcher on `/\bgh pr create\b/` blocks talking about the command
The `pr-self-review` gate first matched the guarded commands with a bare word-boundary
regex. It then denied every `echo`, heredoc and test fixture that merely contained the
string — including the script's own test harness, which could not run. Anchor guarded
patterns to a shell command boundary instead: `/(?:^|[;&|(\n])\s*(?:\w+=\S*\s+)*gh\s+pr\s+…/`
(see `GUARDED` in `scripts/pr-self-review-gate.mjs`). Corollary: any Bash-matcher hook
you write will be evaluated against your own tool calls while you develop it.

## Codebase Patterns

### 2026-08-07 — Any guardrail on the `.js` import rule must exempt `server/src/db/**`
The rule in `server/AGENTS.md` is not repo-wide in practice. Details and the
measurement are in `server/LEARNINGS.md`; what matters at this level is that a lint or
gate enforcing it fires on every schema edit unless that directory is excluded.

### 2026-08-07 — A new skill is inert until it appears in `pr-self-review/lanes.json`
Skills otherwise only fire when the model happens to think they are relevant. The
`pr-self-review` gate is what deterministically routes changed files to skills, so a
skill that is not listed in a lane's `skills` array is never applied to a pre-PR
review.

## Tool & Library Notes

_Nothing yet._

## Recurring Errors & Fixes

_Nothing yet._

## Session Notes

### 2026-08-07 — Added the `pr-self-review` skill and its PreToolUse gate
Built `scripts/pr-self-review-gate.mjs` (scope / guardrails / ground / dismiss / hook),
the `.claude/skills/pr-self-review/` skill with `lanes.json` routing and a shared
`reviewer-brief.md`, and the first project `.claude/settings.json`. Why the script and
not the model decides → `INSIGHTS.md`. Then ran the skill on its own branch: the lanes
found three CRITICALs in it, two of them fail-open holes in the gate itself, and it
blocked its own PR until they were fixed.

## Open Questions

_Nothing yet._
