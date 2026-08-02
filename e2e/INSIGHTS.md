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

> The entries below were written up retroactively from code comments and the README
> (2026-08-01), so the dates mark when they were recorded, not when the decisions were made.

## 2026-08-01 — agent-browser instead of Playwright, plus our own thin convention

**Context:** we needed browser journeys without the weight of a full framework.

**Chose:** Vercel agent-browser — a native (Rust + CDP) CLI. But it is **not** a test
framework, so a minimal convention sits on top: a flow is a JSON list of commands executed
in order against one shared browser session.

**The key thing that follows:** the commands *are* the assertions. `wait --text` /
`wait --url` exit non-zero when the condition never holds, and that fails the step. We
deliberately did not build an assertion layer — only a light stdout substring check on top.
The urge to "add proper matchers" here means replacing a mechanism that already works.

## 2026-08-01 — The AI `chat` command is banned; locators stay deterministic

**Context:** agent-browser can do LLM-driven interaction (`chat`).

**Chose:** never use it. Only `--url`, `--text`, and `find role|text|label` are allowed.
Reason: otherwise the suite stops being deterministic and starts requiring an API key —
and the whole point of this package is that it goes red only when something is actually
broken. Side benefit: runs are free and work in CI with no secrets.

## 2026-08-01 — The hermetic runner is the default, not "against your own stack"

**Context:** flows 02/04/05 follow the root redirect to the **first** repo, i.e. they
assume the seeded `acme/payments-api` is the only one in the DB.

**The problem:** that holds in CI, but a local dev DB usually already has imported repos.
`pnpm test` against it lands the flows on the wrong repo and they fail — looking like a
product regression when it's really a data mismatch.

**Tried:** the obvious "just reset the DB" — and this is exactly where the mine is buried:
`docker compose down -v` drops the `devdigest_pgdata` volume along with every real repo and
review the user has imported. That's not a reset, that's data loss.

**Chose:** `pnpm e2e:hermetic` as the recommended path — it brings up its own isolated
stack on alternate ports (PG :5433, API :3101, web :3100) with an ephemeral, volume-less
database, and tears it down afterwards. The dev DB is never touched.
