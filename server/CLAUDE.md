# @devdigest/api

Fastify 5 + Drizzle ORM + Postgres (pgvector). Node ≥22, TypeScript ESM —
relative imports **must** carry the `.js` suffix.

## Commands

- `pnpm dev` (:3001) · `pnpm typecheck` · `pnpm build`
- `pnpm db:migrate` · `pnpm db:seed` (idempotent) · `pnpm db:generate`
- unit: `pnpm exec vitest run --exclude '**/*.it.test.ts'`
- integration: `pnpm exec vitest run .it.test` (needs Docker)

## Where things live

- `src/modules/<name>/` — feature plugin: `routes.ts` → `service.ts` → `repository.ts`
- `src/platform/` — config, DI container, errors, jobs, SSE
- `src/adapters/<port>/` — the outside world behind an interface
- `src/db/schema/` — Drizzle schema · `src/db/migrations/` — SQL
- `src/vendor/shared/` — vendored Zod contracts

## Conventions (non-default)

- A new module = a plugin + **one line** in `src/modules/index.ts`. We don't use autoload.
- Routes declare zod `params`/`body`; don't `Schema.parse(req.body)` inside the handler —
  validation must run before it.
- HTTP never reaches SQL: routes → service → repository.
- A new external dependency = an adapter + a getter in `platform/container.ts`. Otherwise
  it can't be mocked via `ContainerOverrides` and tests will hit the network.
- A DB-backed test **must** use the `*.it.test.ts` suffix — otherwise it lands in the
  unit CI job and fails there for lack of Docker.

## Gotchas

- Migrations don't run on boot. `relation ... does not exist` means you skipped `pnpm db:migrate`.
- The schema already contains tables for future lessons. An empty table is expected, not a bug.
- Reaping stale `running` runs on boot assumes a **single** API instance per DB.
- `NODE_ENV=test` disables the global rate limit and silences logs.
- Secrets are not part of `AppConfig`. After writing a new key you need
  `container.invalidateSecretCaches()`, or the provider keeps serving the cached old one.

## Do not touch without an explicit request

- `src/vendor/shared/**` — vendored copy of the contracts.
- Registration order in `app.ts`: plugins and the error handler come **before** modules.
  Modules are encapsulated plugins and inherit that context; reorder it and things break silently.

## Read when

- You need the API map, the DI flow, or env vars → `README.md`
- You're touching the indexer (pipeline, limits, rank, repo-map) → `src/modules/repo-intel/README.md`
- You can't tell whether a test is unit or integration → `../TESTING.md`
- You're starting a feature → `specs/` · you don't understand why something is the way it is → `INSIGHTS.md`
- You need a deeper dive into a subsystem → `docs/`
