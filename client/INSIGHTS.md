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

## 2026-08-01 — Agent runtime errors arrive over SSE, bypassing React Query

**Context:** `POST /pulls/:id/review` returns `200` with a `runId` **immediately** — the
review itself executes in the background. So a failing agent is not a mutation or query
error.

**The consequence we hit:** the global error toast wired to React Query never sees those
failures. The user sits in front of a screen where simply nothing happens, until they
reload.

**Chose:** `useRunEvents` watches for `parsed.kind === "error"` in the stream itself and
calls `notify.error(msg)`. So background runs have **two** error channels, deliberately:
the HTTP layer owns starting, SSE owns executing. Any new background process needs both.

## 2026-08-01 — `content-type` is set only when a body actually exists

**Context:** `apiFetch` used to always send `content-type: application/json`.

**The problem:** body-less `POST`/`PUT` calls (refresh, resync, generate) failed in Fastify
with "Body cannot be empty when content-type is application/json" — a client-side bug that
looks like a server bug and takes a long time to find.

**Chose:** the header is added conditionally, only when `init?.body != null`. Don't
"simplify" this away.

## 2026-08-01 — Errors are normalized into `ApiError` for the error-UX taxonomy

**Context:** three different ways to surface an error — toast, inline, full screen — and
the choice between them should be mechanical, not ad hoc per call site.

**Chose:** `apiFetch` collapses everything into `ApiError` with `status` + `code`, and a
network failure gets a synthetic `status: 0` / `code: "network_error"` plus human-readable
text ("Cannot reach the DevDigest engine…"). The UI then branches on status: `0` → full
screen (engine isn't up), `4xx` → inline, everything else → toast. Which is why a new
request must **not** catch its own errors — that drops it out of the taxonomy.

## 2026-08-01 — Run trace and live log are two sources the UI joins

**Context:** run progress is visible in real time, but after a page reload the stream is
already closed.

**Chose:** the server writes **one** `RunTrace` document (config + stats + prompt_assembly
+ tool_calls + the full log) served by `GET /runs/:id/trace`, while live events go
separately over SSE. The drawer joins both: the stream while the run is active, the
document once it finishes or after a reload. This is also why the persisted log in the
trace includes the shared pre-work (diff loading), not just that one agent's events.
