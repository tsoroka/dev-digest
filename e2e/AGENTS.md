# @devdigest/e2e

Deterministic browser flows for the web app, driven by Vercel **agent-browser**
(Rust + CDP). No Playwright, no LLM, no API keys.

## Commands

- `pnpm e2e:hermetic` — **recommended**: brings up its own isolated stack
  (Postgres :5433, API :3101, web :3100), runs the flows, tears it all down
- `pnpm test` — against an already-running stack · `pnpm typecheck`
- One-time setup: `npm i -g agent-browser && agent-browser install`

## Where things live

`specs/NN-name.flow.json` — the flows themselves · `run.ts` — the runner ·
`lib/assert.ts` — assertions · `agent-browser.json` — config ·
`test-results/` — failure screenshots (git-ignored).

**Naming exception:** in this package `specs/` holds the *tests*, not feature
specifications — `run.ts` reads `*.flow.json` from there. Feature specs live in
`docs/specs/` instead. Everywhere else in the repo `specs/` means feature specs.

## Conventions (non-default)

- A flow is JSON **data**, not code. A new scenario is a new `NN-<name>.flow.json`
  under `specs/`; the numeric prefix sets run order (lexical).
- The commands *are* the assertions: `wait --text` / `wait --url` exit non-zero when
  the condition never holds. No separate assertion layer is needed.
- Locators stay deterministic only (`--url`, `--text`, `find role|text|label`).
  Never use the AI `chat` command — it would end the suite's determinism.
- Data comes from `pnpm db:seed`. Don't build your own state where the seed suffices.

## Gotchas

- Flows 02/04/05 follow the home redirect to the **first** repo, so they assume the
  seeded `acme/payments-api` is the only one. Your dev DB usually isn't like that —
  hence the hermetic runner as the default, not `pnpm test`.
- **Never** "reset" the dev DB with `docker compose down -v` — the `-v` flag drops the
  volume along with every repo and review you've imported.
- A red e2e run more often means a moved selector or a seed mismatch than a product bug.
  Check that first.

## Read when

- You need the flow format, env knobs, or what's covered → `README.md`
- You're adding a scenario for a new feature → `docs/specs/`
- A flow behaves oddly and you're probably not the first to see it → `INSIGHTS.md`
- **You're starting any work here → `LEARNINGS.md` first** — what past sessions hit and how they got out
