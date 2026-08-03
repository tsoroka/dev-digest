# @devdigest/reviewer-core

The pure review engine: diff → prompt → LLM → grounded findings.
Dependencies: `zod` + the `openai` SDK. Nothing else.

## Commands

`pnpm test` (vitest, hermetic) · `pnpm typecheck` — which is also `build`; we never emit JS.

## The one rule

This package has no side effects beyond the injected `LLMProvider`. No DB, no GitHub,
no fs, no env, no clock. If a feature needs I/O, that I/O lives in the caller
(the server or the CI runner) and arrives here as an already-resolved string.

## Where things live

`prompt.ts` (assembly + injection guard) · `grounding.ts` (citation gate) ·
`llm/structured.ts` (Zod→JSON Schema, parse-with-repair) · `review/run.ts` (orchestration) ·
`review/reduce.ts` · `output/to-review.ts`. The public API is `src/index.ts` only.

## Do not weaken — invariants, not implementation details

- `INJECTION_GUARD` in `prompt.ts` is the one shared defense. Don't replace it with a
  keyword scan of untrusted text: a denylist catches one phrasing, the guard catches all.
- All external content goes through `wrapUntrusted`.
- Grounding is mandatory: a finding that doesn't cite a real diff line is dropped.
- The score is computed from the findings that **survived** grounding. The model's
  self-reported score is ignored.
- A new prompt section is an optional slot only: empty → section omitted → the prompt
  is identical to the previous one.

## Gotchas

- The server consumes TypeScript **source** through a path alias. Changing an export in
  `src/index.ts` breaks the server instantly, with no build step to catch it.
- The `skills` / `memory` / `specs` slots exist but stay unfilled in the starter —
  that's not dead code, the lessons turn them on.

## Read when

- You need the pipeline diagram or the public API → `README.md`
- You're starting an engine change → `specs/`
- You don't understand why an invariant is what it is, or what was already tried → `INSIGHTS.md`
- **You're starting any work here → `LEARNINGS.md` first** — what past sessions hit and how they got out
- You need a deeper dive → `docs/`
