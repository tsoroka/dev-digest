---
name: pr-self-review
description: >-
  Review everything that would land in a pull request — branch commits plus the dirty
  worktree — before the PR exists. Routes each changed file to the skills that actually
  govern it, applies the repo's own grounding gate, and blocks the PR when a CRITICAL
  finding survives. Use before opening a PR, before pushing for review, or when the user
  says self review, review my changes, am I ready to open a PR, check this before I push,
  pre-PR check.
allowed-tools: Bash, Read, Grep, Glob, Write, Agent
---

# PR Self Review

The last check before a change becomes someone else's problem.

This repo already ships an AI PR reviewer. This skill runs the same discipline on
**local** changes: the vocabulary, the grounding gate and the verdict are the
product's own (`server/src/vendor/shared/contracts/findings.ts`,
`reviewer-core/src/grounding.ts`, `reviewer-core/src/output/to-review.ts`). Don't
invent a parallel one.

Two halves, and the split matters:

| Half | Who | Why |
|---|---|---|
| Scope, freshness, `AGENTS.md` guardrails, grounding, scoring, the verdict | `scripts/pr-self-review-gate.mjs` | Mechanical. Never hallucinated, never skipped, costs nothing, and identical on every run. |
| Judgement about the code | lane subagents | Needs the skills and the surrounding files. |

The line between them is deliberate: the model **produces** findings, the script
**decides** what they mean. Every blocking decision lives on the script side.

| Subcommand | Does |
|---|---|
| `scope` | what would land in the PR: files, changed line ranges, lanes, `scope_hash` |
| `guardrails` | documented invariants checked mechanically — no LLM |
| `ground` | findings in → grounded, deduped, dismissed-filtered `verdict.json` out |
| `dismiss` | record a false positive, with a mandatory reason |
| `hook` | the `PreToolUse` gate on `gh pr create\|ready\|merge` |

**This skill does not fix anything.** It doesn't commit, push, or open the PR. It
reads, judges, and writes a verdict. Offering to fix findings afterwards is fine —
doing it silently inside the run is not.

## The run

### 1. Scope

```bash
node scripts/pr-self-review-gate.mjs scope
```

Returns `base` (merge-base with trunk), `head`, `branch`, `scope_hash`, every changed
file with its **changed new-side line ranges**, the active `lanes`, and the touched
`packages`. Everything downstream uses this — never re-derive the file list with your
own `git diff`, or the hook's freshness check will disagree with what you reviewed.

Stop early, writing nothing, when:

- `file_count` is 0 — say there's nothing to review.
- `branch` is `main` — there is no PR to open. Say so.

### 2. Guardrails

```bash
node scripts/pr-self-review-gate.mjs guardrails
```

Documented invariants checked mechanically: a vendored file touched, a broken
`CLAUDE.md` symlink, secrets, `.js`-less relative imports, a bare `fetch` in a
component, a DB test without `.it.test.ts`, an e2e flow using the AI `chat` command,
an unregistered module, a schema change with no migration, a removed
`reviewer-core` export, a missing i18n key, a focused test, a `console` call in the
API, a new adapter with no container getter.

Run this early to fail fast — a schema change with no migration doesn't need five
agents to find. Show them to the user, then **stop passing them around**: `ground`
adds them back itself in step 5. Never re-word them; they are already grounded and
already say the right thing.

### 3. Typecheck

For each entry in `packages`, inside that directory (never at the root — this is not
a workspace):

```bash
cd <package> && pnpm typecheck
```

A failure is one CRITICAL, `category: bug`, `source: typecheck`, anchored at the first
error's file and line. Quote the compiler's own message in the rationale. If the error
is in a file that isn't in the change set, still report it — a broken build blocks the
PR regardless of who broke it — and note that.

`--full` additionally runs `pnpm test` in each touched package. `server`'s integration
tests need Docker; when it isn't running, skip them and say so in the report rather
than reporting a failure.

### 4. Lanes

Dispatch **one subagent per active lane, all in a single message** so they run in
parallel. Each lane is defined in `lanes.json` — its skills, its docs, its invariants.
Pass each agent:

- `reviewer-brief.md` (this directory) — the shared contract for what comes back
- that lane's `skills`, `docs` and `invariants` from `lanes.json`
- only its own files, each with its `changed_lines`

Files marked `excluded: true` go to no lane. Vendored code is reported by the
guardrails and reviewed by nobody.

### 5. Ground — and let the script decide

Collect every lane's findings into one JSON array and pipe it in:

```bash
node scripts/pr-self-review-gate.mjs ground < findings.json > .claude/pr-self-review/verdict.json
```

**Do not compute the gate yourself.** That one command applies the citation gate
(the port of `reviewer-core/src/grounding.ts`), dedupes overlapping findings, merges
the guardrails in, applies dismissals, scores with the `reduce.ts` penalty table, and
picks the verdict under `failOn: 'critical'`. What it prints **is** `verdict.json` —
write it verbatim, including `scope_hash`.

Same reason `reviewer-core` ignores the model's self-reported score: a blocking
decision has to be reproducible. The same diff must produce the same verdict twice.

What follows from that:

- Don't feed the step-2 guardrail findings back in — `ground` adds them itself.
  (`--no-guardrails` suppresses that; it exists for testing the script.)
- A finding on a line nobody changed is dropped and listed under `grounding.reasons`.
  Read that list. A run that drops nothing usually means the lanes are citing loosely,
  and a run that drops most of a lane's output means that lane's brief needs work.
- `verdict`, `score`, `counts`, `blockers` and `scope_hash` come out of the command.
  Never edit them — an invented hash means the hook denies every PR forever.

Then write `.claude/pr-self-review/report.md`, the same content in prose. It and
`verdict.json` are gitignored; `dismissed.json` beside them deliberately is not.

### 6. Report

Print it in the product's own format — this is `composeBody()` in `to-review.ts`:

```
## PR Self Review — Changes requested

**8 findings** · 2 critical · 3 warning · 3 suggestion

- 🔴 **Bare `fetch` inside a component** (critical, bug) — `client/src/components/x/X.tsx:41`
  - <rationale>
  - _Suggestion:_ <suggestion>
```

🔴 CRITICAL · 🟡 WARNING · 🔵 SUGGESTION. Close with the grounding line
(`kept/total passed`) and the gate results.

Always show two things people skip: what grounding dropped, and what a dismissal
silenced. Both are how you find out the skill itself is drifting.

On `request_changes`, say plainly: **the PR is blocked**, `gh pr create` will be
denied, fix the criticals and re-run. Don't soften it. If a critical looks wrong, the
answer is `dismiss` with a reason — not `PR_SELF_REVIEW_BYPASS`, which you should
never suggest.

## When a finding is wrong

It will happen, and how it's handled decides whether this skill is still in use in
three months. A gate with no way to say "this one is wrong" gets bypassed wholesale
the first time it is wrong — and a bypassed gate is worse than no gate, because it
still looks like something checked the code.

So: never reach for `PR_SELF_REVIEW_BYPASS`, and never suggest it. Dismiss the one
finding instead.

```bash
node scripts/pr-self-review-gate.mjs dismiss \
  --file client/src/components/x/X.tsx \
  --title "Bare \`fetch\` inside a component" \
  --reason "Server component, pre-render only — never runs in the browser."
```

Then re-run step 5. The finding moves to `dismissed` in the verdict and stops
blocking; it stays visible in every future run.

- **The reason is mandatory** and the script enforces it. A dismissal nobody can
  justify later is indistinguishable from a bypass.
- `dismissed.json` is **tracked in git** on purpose — whoever reviews the PR sees what
  was silenced, and the reason is part of the diff they read.
- `--title '*'` with `--category` silences a whole category in one file. Use it rarely.
- Ask the user before dismissing. It is their judgement call, not yours — you wrote
  the finding.

The most valuable dismissals are the ones that turn out not to be the skill's fault:
if the finding was a fair reading of an ambiguous rule, the fix belongs in that
package's `AGENTS.md`, not in `dismissed.json`. Say so when you see it.

## The severity bar

The whole thing is worth nothing if it cries wolf. A gate that blocks on style gets
bypassed within a week, and then it protects nothing.

**CRITICAL** — and therefore blocking — is only:

- a violation of a documented `AGENTS.md` / `TESTING.md` invariant
- a bug with a concrete failure path you can name
- a security hole
- a broken build, a broken contract, or a leaked secret

Everything about naming, structure, style, or "I'd have done it differently" is
SUGGESTION. WARNING is the middle: real, worth fixing, not worth blocking on.

## Non-goals

- Not a substitute for CI. The workflows in `.github/workflows/` still run.
- Not a rewrite pass. Findings only.
- Not a git client. It never commits, pushes, or opens the PR.

## The hook

`.claude/settings.json` registers a `PreToolUse` hook that intercepts
`gh pr create|ready|merge` and denies it when the verdict is missing, stale, or
`request_changes`. The gate fails **open** on any internal error — a broken script
must never brick the Bash tool. `git push` is deliberately not gated; pushing a WIP
branch is normal work.

## Read when

- You're changing the routing, the globs, or a lane's invariants → `lanes.json`
- You're changing what a lane agent returns → `reviewer-brief.md`
- You need the finding contract → `server/src/vendor/shared/contracts/findings.ts` (read-only)
- You want the reference implementations → `reviewer-core/src/grounding.ts`, `output/to-review.ts`, `review/reduce.ts`
