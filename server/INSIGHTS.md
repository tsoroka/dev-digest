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

> The entries below were written up retroactively from code comments (2026-08-01),
> so the dates mark when they were recorded, not when the decisions were made.

## 2026-08-01 — `decl_file` stays NULL when the candidate isn't unique

**Context:** `resolveReferences` resolves `(from_path → to_symbol)` to a declaring
file through the import graph.

**Tried:** falling back to the nearest name match when there are several candidates
or none. Rejected: that turns "I don't know" into a plausible fabrication.

**Chose:** resolve only when there is **exactly one** candidate (`HAVING count(*) = 1`),
otherwise `NULL`. That `NULL` isn't a hole in the data, it's load-bearing: phantom-symbol
detection (L06) is built on it. Guessing would make that gate worthless.

## 2026-08-01 — A 110s soft budget against JobRunner's hard 120s

**Context:** `JobRunner` wraps handlers in `withTimeout(120s)`; a full index of a large
repo may not finish in time.

**Tried:** relying on the outer timeout plus a retry. Rejected: a handler **cannot catch
its own outer timeout**, so the run is simply killed with no state written — and the retry
burns the same budget again for the same result.

**Chose:** self-monitoring via `INDEX_SOFT_BUDGET_MS ≈ 110s`. On reaching it the indexer
stops enqueuing files, skips the graph→rank→repo-map block, and honestly finishes as
`partial`. Trade-off: a `partial` index yields thinner prompt context — but it is written,
observable, and doesn't spin in retries.

## 2026-08-01 — Rank is pure PageRank; hotness is always 0

**Context:** file rank was meant to combine structural importance with change frequency.

**Tried:** adding git hotness over a `HOTNESS_WINDOW_DAYS = 180` window. It ran into the
clone being **shallow** (`CLONE_DEPTH = 1`) — there is no churn window at all. Deepening
the clone just for this was too expensive on every repo import.

**Chose:** v1 is `rank = pagerank`, `hotness = 0`. The `hotness` column **stays in the
schema** so it can be switched on later without a migration (`rank` would become
`pagerank * (1 + hotness)`). This is also closer to Aider, which ranks by graph, not churn.

## 2026-08-01 — Stale-run reaping is awaited **before** accepting requests

**Context:** a process that dies mid-review leaves `agent_runs` rows in `running` — they
hang forever in the UI with no runner left to cancel them.

**Tried:** reaping asynchronously so boot isn't blocked. Rejected: it opens a race — a
fresh run created in the window between `listen` and the reaper finishing gets caught and
killed by its own process.

**Chose:** `await` it before the server starts accepting requests. At that point the
process has no in-flight runs of its own (they only start via `POST /review`), so every
`running` row is genuinely orphaned. **The trade-off is explicit:** this assumes a
**single** API instance per DB. Multiple replicas would need heartbeats or per-instance
scoping — but that isn't this app's deployment model.

## 2026-08-01 — Secrets live outside `AppConfig` and outside the DB

**Context:** LLM keys and `GITHUB_TOKEN` need to be enterable from the UI at runtime.

**Tried:** keeping them in config / the settings table alongside everything else.
Rejected: the key then leaks into DB dumps, config logs, and the seed.

**Chose:** `~/.devdigest/secrets.json` (mode `0600`) with `process.env` as a fallback, and
a **single read chokepoint** — `LocalSecretsProvider`. The server boots with no keys at
all: `loadConfig` marks every secret optional. The easy-to-forget consequence: providers
are cached, so after writing a key you need `container.invalidateSecretCaches()` or the
old one keeps being used.

## 2026-08-01 — The incremental index rebuilds the graph globally

**Context:** on refresh, symbols are re-parsed only for changed files.

**Tried:** patching edges for changed files only. Rejected for v1: one changed dependency
redistributes PageRank across the **whole** graph, so a correct patch touches the entire
rank anyway — the complexity doesn't pay for itself.

**Chose:** a slice for symbols plus a full rebuild of the graph and rank. That's still far
cheaper than the whole-tree AST parse it avoids. In the same place `resolveReferences` is
called with `reset: true` — a changed decl file would otherwise leave a stale resolution
behind. Trade-off: on very large repos this is the most expensive part of the "cheap" path.
