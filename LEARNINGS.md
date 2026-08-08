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

### 2026-08-08 — Don't parse shell text inside a security gate; over-match instead
Superseded the entry below, which had the lesson backwards. Trying to tell "runs the
command" from "mentions the command" means re-implementing bash quoting, and three
review rounds of the `pr-self-review` gate produced **five fail-opens, every single one
in that function**: `$(…)` inside double quotes, `<<<` misread as a heredoc, a quoted
`<<` swallowing the rest of the command, `/bin/sh -c`, `bash --norc -c`. Each fix
revealed the next case; the tests written to pin the previous round passed vacuously.

`shellLiveText()` is deleted. The asymmetry is what justifies it: a false DENY is
friction the user can work around, a false ALLOW is the whole failure mode. Pay the
friction. Practically: writing about a guarded command inside a Bash call gets denied, so
split the phrase (`'gh' + ' pr '`, as the test file does) or use Write.

**Round 4 refined the rule to its final form: complexity is allowed only in the widening
direction.** Replacing the parser with three *adjacent* bare words was itself too narrow
and missed five more real invocations — `gh pr \⏎create` (a regression, since the deleted
parser had flattened backslashes), `gh.exe pr create`, `"gh" pr create`,
`gh pr "create"`, and `gh -R o/r pr create` (verified against the real binary: `gh` does
accept `-R` before the subcommand). `GUARDED` now normalizes continuations and quotes and
tolerates non-separator tokens between `gh`, `pr` and the subcommand. Being intricate to
*widen* is fine — worst case is a spurious deny; being intricate to *narrow* is what
caused all five original fail-opens. It is not a shell parser and is not complete, and
the comment says so rather than claiming otherwise.

Corollary that held up: any Bash-matcher hook you write is evaluated against your own
tool calls while you develop it.

### 2026-08-07 — A PreToolUse Bash matcher on `/\bgh pr create\b/` blocks talking about the command
**Superseded 2026-08-08 — see above. The fix described here is the one that failed.**
The `pr-self-review` gate first matched the guarded commands with a bare word-boundary
regex. It then denied every `echo`, heredoc and test fixture that merely contained the
string — including the script's own test harness, which could not run. The conclusion
drawn at the time was to anchor guarded patterns to a shell command boundary. That
bought the convenience at the cost of five fail-opens; the friction was the cheaper
side of the trade all along.

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
