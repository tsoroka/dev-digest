# Run cost badge — the three surfaces

**Status:** done
**Context:** Cost is invisible in the UI today, so nobody can tell what a review cost until they
read the provider's dashboard. This puts the number where the decisions are made: the PR list,
the run timeline, and the run's trace.

## Scope

Included — three placements:
1. **PR list** — a new `COST` column between `STATUS` and `UPDATED`, showing
   `PrMeta.total_cost_usd` (the PR's total across all runs), e.g. `$0.014`.
2. **Agent runs timeline** — a trailing usage line on each run row: `9,119 tok · $0.0013`.
3. **Trace drawer** — a fourth `COST` stat tile in the Stats row, after `TOKENS`.

Plus the two pieces they share:
- `src/lib/format-cost.ts` — `formatCost` (the single formatting rule) and `formatTokenCount`.
- `src/components/run-cost-badge/` — `RunCostBadge` with two variants, `compact` and `inline`.

Deliberately excluded:
- The `VerdictBanner` line on PR detail. Three surfaces, not four.
- Sorting or filtering the PR list by cost.
- Any per-agent or per-model cost breakdown (that's a later lesson's dashboard).
- A third `RunCostBadge` variant for the drawer: the `Stat` tile already owns the chrome and
  reuses only the formatter. That is why `formatCost` lives in `src/lib/` and not in the
  component file.

## Acceptance criteria

- [x] One formatting rule, one place: 2 significant digits, trailing zeros stripped. The same
      function yields `$0.06`, `$0.014` and `$0.0013` with no per-callsite decision.
- [x] `null`/`undefined` renders `—` (the app-wide empty metric); `0` renders `$0.00`. They never
      collapse — a truthiness check (`!usd`) would merge "unknown" with "free" and destroy the
      empty state the lesson is about.
- [x] `formatCost` accepts `undefined`: `GET /runs/:id/trace` casts the stored jsonb rather than
      parsing it, so traces written before the contract carried `cost_usd` deliver `undefined`.
- [x] A timeline row with no tokens and no cost (failed / cancelled run) renders nothing at all.
- [x] `GRID` and `COLUMN_KEYS` stay the same length, and `updated` stays last — the header
      right-aligns the final column by index, so appending `cost` would silently steal that
      alignment. Guarded by a test.
- [x] No new hook and no `api.ts` change: cost rides on the existing `PrMeta`, `RunSummary` and
      `RunTrace` payloads.
- [x] No literal copy in JSX — two new i18n keys: `prReview.list.columns.cost` and
      `runs.trace.stat.cost`.

## Open questions

- The `" tok"` unit lives in the component rather than in `messages/`, matching how the repo
  already bakes units into formatters (`formatSeconds` → `"8.2s"`, `formatTokens` → `"12k→1.5k"`).
  If a second locale ever lands, units become a real i18n question across all of them at once.
- `formatTokenCount` groups thousands by hand instead of using `toLocaleString`, because the
  latter varies by browser locale and the e2e flow asserts on the literal string.
