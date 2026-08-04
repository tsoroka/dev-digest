# Run cost badge — browser coverage

**Status:** done
**Context:** The cost feature spans three screens and two packages, so a unit test on either side
can pass while the number never reaches a user. One flow walks all three surfaces end to end.

## Scope

Included — `specs/08-run-cost-badge.flow.json`:
- PR list: the `COST` column shows `$0.014` for PR #482 (the SUM of its runs).
- PR detail → Agent runs: the newest timeline row shows `9,119 tok · $0.0013`.
- The same run's trace drawer shows `$0.0013` in the `COST` stat tile.

Deliberately excluded:
- Triggering a review. The flow is read-only against seeded data, so it makes **zero** model
  calls and stays deterministic.
- Asserting the `COST` column *header*. `s.headRow` applies `text-transform: uppercase`, so the
  DOM text (`Cost`) and the rendered text (`COST`) differ and which one CDP matches is an
  implementation detail. Assert on values only.

## Seed values this flow depends on

`server/src/db/seed.ts` inserts three `agent_runs` (+ `run_traces`) for PR #482, newest first:

| Agent | Model | Tokens in/out | `cost_usd` |
|---|---|---|---|
| Security Reviewer | `deepseek/deepseek-v4-flash` | 8200 / 919 | `0.0013` |
| General Reviewer | `deepseek/deepseek-v4-flash` | 11000 / 1500 | `0.0127` |
| Performance Reviewer | `qwen/qwen3-next-80b` (unpriced) | 3900 / 400 | `null` |

Change any of these and the flow's literals go with them:
- `0.0013 + 0.0127 = 0.0140` → `$0.014` in the list. The unpriced run contributes nothing, which
  is the point: `null` is skipped, not counted as `0`.
- `8200 + 919 = 9119` → `9,119 tok` on the newest row.
- `ranAt` is explicit and staggered, so "newest first" — and therefore which run
  `find label "Open run trace & logs"` clicks — is deterministic.

## Acceptance criteria

- [x] The flow passes under `pnpm e2e:hermetic` against a freshly-seeded DB.
- [x] It makes no model call and needs no API key.
- [x] It fails if cost stops reaching any one of the three surfaces.

## Open questions

- The flow assumes `acme/payments-api` is the first repo, like flows 02/04/05 — fine under the
  hermetic runner, not against a dev DB with other repos imported.
