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

### 2026-08-02 — Adding a PR-list column: `GRID` and `COLUMN_KEYS` are one definition, and order matters
`app/repos/[repoId]/pulls/constants.ts` holds `GRID` (a CSS grid template) and `COLUMN_KEYS`
(the i18n header keys). They are two halves of one column definition — the header row and
`PRRow` both consume `GRID`, so if their lengths drift every row misaligns with no error.
Worse, `page.tsx` right-aligns the header cell via `i === COLUMN_KEYS.length - 1`: appending a
new column at the END silently steals `UPDATED`'s right alignment. Insert new columns *before*
`updated`, add the matching track to `GRID`, and add the `list.columns.<key>` message.
`PRRow.test.tsx` guards both invariants.

## Tool & Library Notes

_Nothing yet._

## Recurring Errors & Fixes

_Nothing yet._

## Session Notes

### 2026-08-02 — Added the run cost surfaces (L01 Run Cost Badge)
New `src/lib/format-cost.ts` (one adaptive rule: 2 significant digits, trailing zeros
stripped — yields `$0.06`, `$0.014`, `$0.0013`) and `src/components/run-cost-badge/`
(`compact` for the PR-list cell, `inline` for the timeline row). The trace drawer reuses only
the formatter inside its existing `Stat` tile. Load-bearing rule everywhere: `null` renders
`—` (unknown), `0` renders `$0.00` (a priced free model) — never collapse them with a
truthiness check.

## Open Questions

_Nothing yet._
