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

## 2026-08-07 — The pre-PR gate decides in a script; the model only produces findings

**Context:** we were adding `pr-self-review`, a gate that blocks `gh pr create` when a
CRITICAL finding survives. The question was where the blocking decision lives. The
skill dispatches lane subagents that read the diff and report findings — the obvious
design is to let them also say whether the change is safe.

**Tried:** having the lane agents compute the verdict, with `SKILL.md` describing the
grounding rules in prose for them to follow. That makes the same diff able to block on
one run and pass on the next, which is exactly what `reviewer-core` already refused
when it chose to ignore the model's self-reported score. We also considered
`PR_SELF_REVIEW_BYPASS=1` as the only escape hatch for a wrong finding — rejected,
because a gate that can only be turned off entirely gets turned off entirely the first
time it is wrong, and a bypassed gate is worse than no gate: it still looks like
something checked the code.

**Chose:** split the work so the model **produces** findings and
`scripts/pr-self-review-gate.mjs` **decides** what they mean. Scope, the freshness
hash, the documented-invariant guardrails, severity normalization, citation grounding,
dedupe, scoring and the verdict are all in the script; the lanes only return findings.
For wrong findings, a per-finding `dismiss` with a **mandatory reason**, recorded in a
git-tracked `dismissed.json` so the PR reviewer sees what was silenced and why.

**The trade-off we accepted:** the gate is only as good as its mechanical rules, and
those rules encode `AGENTS.md` as it reads today — every documented convention that
changes needs a matching change in `lanes.json` or the guardrails, or the gate starts
enforcing history. We also accepted that dismissals accumulate: nothing expires them,
so they need periodic review the same way `LEARNINGS.md` does.

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
means feature specs in three packages and tests in the fourth, so `e2e/AGENTS.md` carries
an explicit "naming exception" note and the root layout rule flags e2e as the exception.
