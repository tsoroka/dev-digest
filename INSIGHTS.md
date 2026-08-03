# Insights

A decision log: **why** something is the way it is, and what was already tried.
Append-only, newest first. This is the part an agent can't recover from the code —
unlike `README.md` (how it works today) and `specs/` (what we're about to build).

An entry is added **after** a task, using this template:

```markdown
## YYYY-MM-DD — <short title>
**Context:** what was being decided.
**Tried:** the rejected options and why they were rejected.
**Chose:** the decision plus the trade-off we knowingly accepted.
```

---

## 2026-08-01 — `e2e/specs/` keeps holding flows; feature specs go to `e2e/docs/specs/`

**Context:** we were introducing the same `docs/` + `specs/` + `INSIGHTS.md` layout
across all four packages. In `e2e/` the name `specs/` was already taken — it holds
`*.flow.json` files, i.e. the tests themselves, not specifications.

**Tried:** renaming the directory to `e2e/flows/`, which would have made `specs/` mean
one single thing repo-wide (and `flows/` is arguably the more accurate name — the files
are `*.flow.json` and the runner's type is `Flow`). The mechanical cost was low: one
constant in `run.ts` plus comments; CI paths aren't hardcoded (`e2e-web.yml` filters on
`e2e/**`). We did it, then reverted it.

**Chose:** leave `e2e/specs/` exactly as it was and put feature specs in `e2e/docs/specs/`
instead. Renaming a directory that every contributor already has muscle memory for — and
that shows up in review links, bookmarks, and any external references — costs more in
practice than the naming inconsistency it fixes. **The trade-off we accepted:** `specs/`
means feature specs in three packages and tests in the fourth, so `e2e/CLAUDE.md` carries
an explicit "naming exception" note and the root layout rule flags e2e as the exception.
