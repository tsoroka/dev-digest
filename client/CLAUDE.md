# @devdigest/web

Next.js 15 (App Router) + React 19 + TanStack Query 5 + next-intl 3 + Tailwind 4.
Tests run on vitest + jsdom.

## Commands

`pnpm dev` (:3000) · `pnpm build` · `pnpm start` · `pnpm typecheck` · `pnpm test`

## Where things live

- `src/app/**/page.tsx` — routes; pages stay thin
- `src/app/**/_components/<Name>/` — feature logic + its own `*.test.tsx` alongside
- `src/lib/hooks/*` — all data · `src/lib/api.ts` — the single fetch chokepoint
- `src/components/app-shell` — nav, breadcrumbs, `g`-then-key shortcuts
- `messages/<locale>/*.json` — copy
- `src/vendor/{ui,shared}` — vendored primitives and contracts

## Conventions (non-default)

- A component **never fetches on its own**. New endpoint → a hook in `src/lib/hooks/`,
  called through `src/lib/api.ts`. A bare `fetch` inside a component is a reason to stop.
- No literal copy in JSX: everything goes through `next-intl` + `messages/`.
- Pages stay thin — logic moves into `_components/`.
- The API base comes from `NEXT_PUBLIC_API_BASE`, never hardcoded.
- Tests mock `fetch`: they need neither the API nor a browser.

## Gotchas

- Real browser journeys live in `e2e/`, not here. If a test needs a running stack,
  it's in the wrong package.
- Run progress arrives over SSE. Don't build polling where a stream already exists.

## Read when

- You need the route map and which endpoints each screen leans on → `README.md`
- You're starting a screen or a feature → `specs/`
- You can't tell why a component is shaped the way it is → `INSIGHTS.md`
- You need a deeper dive → `docs/`
