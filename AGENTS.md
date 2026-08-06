# DevDigest

Local-first AI pull-request reviewer. Course starter: works end to end; lessons
L01–L08 add features on top.

## Packages — 4 standalone, NOT a pnpm workspace

| Path | Package | What it is | Port |
|---|---|---|---|
| `server/` | `@devdigest/api` | Fastify 5 + Drizzle/Postgres | 3001 |
| `client/` | `@devdigest/web` | Next.js 15 | 3000 |
| `reviewer-core/` | `@devdigest/reviewer-core` | pure review engine | — |
| `e2e/` | `@devdigest/e2e` | deterministic browser flows | — |

Each has its own `package.json` and lockfile. Run `pnpm install` **inside the
package directory**, not at the root. Cross-package code is shared through
tsconfig path aliases, not published modules — so a change in `reviewer-core`
hits the server immediately, with no build step in between.

## Commands

- From zero: `./scripts/dev.sh` — Docker Postgres + `.env` + deps + migrations + seed + both servers
- DB only: `./scripts/dev.sh --db-only` · skip seed: `--no-seed` · skip web: `--no-client`
- Migrations are **not** applied on boot: `cd server && pnpm db:migrate`

## Repo conventions

- Documentation is the source of truth. AGENTS.md only **points** at it, never restates it.
- Package conventions live in that package's `AGENTS.md`, not here. Don't duplicate them at the root.
- Agent instructions live in `AGENTS.md`; `CLAUDE.md` beside it is a symlink to the same
  file — Claude Code only discovers `CLAUDE.md`, every other tool reads `AGENTS.md`.
  On Windows the symlinks need `git config core.symlinks true` and Developer Mode enabled.
- Every package has the same layout: `README.md` (how it works today) ·
  `docs/` (deep dives) · `specs/` (what we're building) · `INSIGHTS.md` (why it is this way) ·
  `LEARNINGS.md` (what past sessions learned the hard way).
  **One exception:** in `e2e/`, `specs/` holds the flow tests themselves, so its feature
  specs live in `e2e/docs/specs/`.
- Secrets never go in the DB or in git — `~/.devdigest/secrets.json` via `SecretsProvider`.

## Read when

- You need the architecture or the end-to-end review flow → `README.md`
- You're writing or moving a test and unsure where it belongs → `TESTING.md`
- You're touching the built-in agents' system prompts → `docs/agent-prompts/`
- You hit a repo-level decision (why this layout, what was already tried) → `INSIGHTS.md`
- **You're starting work in a module → read its `LEARNINGS.md` first** (`engineering-insights` skill)
- You're working inside a package → its `AGENTS.md` loads automatically by location

## Do not touch without an explicit request

- `*/src/vendor/**` — vendored copies of `@devdigest/shared` and `@devdigest/ui`.
  Edit only when the task is specifically about them.
