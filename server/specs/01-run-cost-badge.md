# Run cost badge — storage and aggregation

**Status:** done
**Context:** Every review run costs money, but the number was thrown away: `reviewer-core`
computes `ReviewOutcome.costUsd` and `run-executor` destructured it out. This restores the
column and the two read shapes the UI needs — one cost per run, and one total per PR.

## Scope

Included:
- `agent_runs.cost_usd` (`double precision`, nullable), re-added by migration
  `0010_add_agent_run_cost`. It was dropped by `0009_complex_runaways`; this is the reverse.
- `costUsd` threaded through `run-executor` → `completeAgentRun` → the run row, and into the
  `run_traces` document's `stats`.
- Contract fields: `RunStats.cost_usd` and `RunSummary.cost_usd` (both `z.number().nullable()`),
  and `PrMeta.total_cost_usd` (`z.number().nullish()`), mirrored in **both** vendored copies
  (`server/src/vendor/shared/`, `client/src/vendor/shared/`).
- `GET /repos/:id/pulls` returns `total_cost_usd` = SUM of `cost_usd` over every run of that
  PR, computed on read via one `inArray` query + JS grouping — the same shape as the existing
  latest-review `score` in the same handler.

Deliberately excluded:
- Denormalizing cost onto `pull_requests`. The run count per PR is tiny; on-read matches how
  `score` already works.
- Any budget, cap, or alerting on spend.
- Any new estimator. `PriceBook` (live OpenRouter prices) and `estimateCost` (static table)
  already exist and are untouched — see "zero extra model calls" below.
- `reviewer-core/` — it already accumulates and returns `costUsd`. **Nothing in that package
  changes**; don't go looking.

## Acceptance criteria

- [x] Migration `0010` is additive and nullable: existing rows keep working and read back `NULL`.
- [x] A completed run persists the cost that `ReviewOutcome` carried; a failed or cancelled run
      persists `NULL`, never `0`.
- [x] `GET /pulls/:id/runs` returns `cost_usd` per run; `GET /runs/:id/trace` returns
      `stats.cost_usd`.
- [x] `GET /repos/:id/pulls` returns `total_cost_usd` summed over all runs, `null` when no run of
      that PR was priced, and `0` when a run was priced at zero (a free model is *known* to cost
      nothing — that is not the same as *unknown*).
- [x] Zero extra model calls: no new call site touches `container.llm`, `PriceBook`, or
      `estimateCost`. `grep -rn "priceBook\|estimateCost" src/modules/` stays empty.
- [x] `pnpm db:seed` inserts three demo runs (+ traces) for PR #482 — two priced, one unpriced —
      so the surfaces have data without spending a token. Idempotent: guarded on the PR having no
      runs at all, so it never clobbers a real local run.

## Open questions

- `PriceBook.estimate` is synchronous and returns the static-table fallback until the background
  `/models` refresh lands (6h TTL). The first run after a restart can therefore be priced from
  the static table and a later one from live prices, and a PR total can mix the two. The spread is
  a few percent; we accept it rather than making the estimator async.
- `reviewer-core/src/review/run.ts` propagates null virally across map-reduce chunks: one unpriced
  chunk nulls the whole run. That is correct (a partial sum understates cost) but means a real run
  on an unknown model legitimately shows "—". Not a bug.
- The migration was hand-written (all three artifacts: `.sql`, `_journal.json`, `0010_snapshot.json`)
  because no Node toolchain was available. If `pnpm db:generate` is ever re-run, it should produce
  an empty diff — if it re-emits `ADD COLUMN "cost_usd"`, the snapshot is wrong.
