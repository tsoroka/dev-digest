---
name: engineering-insights
description: >-
  Read and append a module's LEARNINGS.md — the accumulated operational knowledge for
  client/, server/, reviewer-core/ and e2e/. Use at the START of any coding, debugging,
  refactor or review task in this repo to load what earlier sessions learned about that
  module, and at the END of such a task to append what is genuinely new. Also use when
  the user says wrap up, what did we learn, record this, lessons, learnings, gotchas,
  or asks why something keeps breaking.
allowed-tools: Read, Grep, Glob
---

# Engineering Insights

Lessons live next to the code they are about. Each module owns a `LEARNINGS.md`;
the next session in that module reads its own lessons, not the whole repo's.

This skill has exactly two jobs. Do the right one for the moment you're in.

## 1. Before work — read

The moment the task's module is known, `Read` that module's `LEARNINGS.md`
**before** touching code. Treat it as high-confidence guidance from a colleague who
already hit these walls.

- Read only the module(s) actually in scope. Never read all five.
- Missing file, or every section still `_Nothing yet._` → note it and move on.
- A lesson that contradicts what you're about to do: say so out loud rather than
  silently picking one.

## 2. After work — append

Re-read the file, then append only what survives the quality gate below.
**Writing nothing is a normal and frequent outcome.** A session that fixed a typo
has produced no lessons; say so and stop.

Never rewrite or delete existing entries during a wrap-up. Append-only.

## Which file

| Touched | File |
|---|---|
| `client/**` | `client/LEARNINGS.md` |
| `server/**` (including `src/modules/repo-intel/**`) | `server/LEARNINGS.md` |
| `reviewer-core/**` | `reviewer-core/LEARNINGS.md` |
| `e2e/**` | `e2e/LEARNINGS.md` |
| root configs, `scripts/`, `docs/`, `.github/`, or a genuinely cross-package lesson | `LEARNINGS.md` |

Multi-module session: each lesson goes to the module it is **about**. Don't mirror
one lesson into several files.

## LEARNINGS.md vs INSIGHTS.md vs AGENTS.md

The repo already has two other homes for knowledge. Route deliberately:

- **A decision with rejected alternatives** — chose X over Y, and Y was genuinely
  tried → `INSIGHTS.md`, in that file's own `Context / Tried / Chose` format.
- **Discovered behaviour** — what breaks, why, what to do instead → `LEARNINGS.md`.
- **A lesson that hardened into a rule everyone must follow** → promote it to that
  package's `AGENTS.md` under "Conventions (non-default)", and drop it from
  `LEARNINGS.md`. Don't leave it in both.

## The seven sections

Fixed. Never rename, reorder, or add to them.

| Section | What goes in |
|---|---|
| `What Works` | Approaches and solutions that held up |
| `What Doesn't Work` | Dead ends and antipatterns |
| `Codebase Patterns` | Conventions and structure you discovered the hard way |
| `Tool & Library Notes` | Dependency quirks, versions, flags |
| `Recurring Errors & Fixes` | A specific error text → its fix |
| `Session Notes` | Dated 1–3 sentence summaries |
| `Open Questions` | What was left unresolved |

`What Doesn't Work` is the section people skip and the one that pays off most.
A dead end you don't record is a dead end someone walks into again.

## Entry format

Append-only, **newest first within its section** — matching the `INSIGHTS.md`
convention already used repo-wide. `###` entries under the `##` section headings:

```markdown
### 2026-08-02 — `pnpm install` at the repo root installs nothing
There is no workspace; each package has its own lockfile. Run it inside `server/`,
`client/`, `reviewer-core/` or `e2e/`. Symptom: imports resolve in the editor but
`pnpm dev` dies with ERR_MODULE_NOT_FOUND.
```

On the first write to a section, replace its `_Nothing yet._` placeholder.
`Session Notes` uses the same dated heading with a short summary of what was done.

## The quality gate

All five must pass. If one fails, write nothing — a thin `LEARNINGS.md` beats a
padded one.

1. **Concrete.** Names a file path, symbol, command, version, threshold, or the
   literal error text.
2. **Actionable cold.** Someone who wasn't in this session knows what to do,
   without re-investigating.
3. **Not already there.** Read first. If a near-duplicate exists, extend that entry
   instead of adding a second one.
4. **Not recoverable from the code.** If it would be obvious to anyone reading the
   code, `README.md`, or `AGENTS.md` — don't write it.
5. **Right file.** Not a decision-with-alternatives (that's `INSIGHTS.md`).

Calibration:

- ❌ "Promises can be tricky." · ❌ "Be careful with async."
- ✅ "`Promise.all()` on the ingest pipeline times out past 30 items — use
  `Promise.allSettled()` in batches of 10 for this module."
- ✅ "Checkout state always goes through Zustand (`cartStore.ts`); three components
  share the cart, so local state silently desyncs."

## Maintenance

Run these when asked, not as part of a wrap-up.

- **Prune** after a dependency upgrade — notes about old quirks become actively
  harmful advice. Review roughly monthly.
- **Resolve conflicts explicitly.** One entry saying "always do X" and another saying
  "X fails here" means the next agent picks at random. Fix it rather than stacking.
- **Split at scale.** Past ~200 entries in one file the signal drops; split by domain
  (`LEARNINGS-Database.md`) and point at it from that package's `AGENTS.md`.
- **It's a draft, not truth.** A wrap-up gets most of it right, but an LLM summary can
  be confidently wrong. These files are in git — a bad entry is one revert away.
