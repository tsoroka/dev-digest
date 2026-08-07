# frontend-architecture — research & sources

Research notes backing a planned skill on **frontend architecture**: where code lives, how
it is split, and which module is allowed to import which. Scope is structural, not runtime —
performance is explicitly out of scope.

## Why a third skill

Two skills in this repo already cover adjacent ground. This one fills the gap between them.

| Skill | Covers | Does not cover |
|---|---|---|
| `react-best-practices` | Code-level rules inside a component: derive-don't-store, hook misuse, keys, memoization | Project layout. Its "Code Organization" section is 8 lines, entirely unelaborated |
| `next-best-practices` | Framework mechanics: RSC boundaries, async APIs, metadata, route handlers | Where *your* code goes around those conventions |
| **`frontend-architecture`** (planned) | Folder topology, module boundaries, layering, placement rules for constants / utils / business logic, import direction | Anything already in the two above |

Overlap to actively avoid when writing `SKILL.md`: the client/server boundary *mechanics*
belong to `next-best-practices`; only the **architectural** consequence (which layer may hold
a `'use client'` boundary) belongs here.

---

## Tier 1 — primary sources, read in full

These were fetched and read end to end. They are the backbone of the skill.

### Structure & layering

**[bulletproof-react — project-structure.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md)**
The single most directly applicable source. Gives the concrete top-level layout
(`app` / `components` / `config` / `features` / `hooks` / `lib` / `stores` / `testing` /
`types` / `utils`) and the per-feature internal layout (`api` / `assets` / `components` /
`hooks` / `stores` / `types` / `utils`), with the explicit caveat *"You don't need all of
these folders for every feature."*
Two rules to lift verbatim:
- **No cross-feature imports** — compose features at the application layer instead.
- **Unidirectional flow** — `shared → features → app`. Features may not import from `app`;
  shared may not import from either.
Ships a copy-pasteable `import/no-restricted-paths` ESLint config that enforces both. This
is the answer to "how do we stop the rules from rotting."

**[bulletproof-react — project-standards.md](https://github.com/alan2207/bulletproof-react/blob/master/docs/project-standards.md)**
Naming and enforcement: kebab-case for all files and folders under `src/` (enforced via the
`check-file` ESLint plugin), path aliases (`@/*` → `./src/*`) over relative `../../../`
chains, Husky for pre-commit validation. Note: contains **no** file-size or module-size
rules — if the skill wants a "max lines" guideline it must come from elsewhere and be
labelled as a heuristic, not as bulletproof-react's position.

**[Feature-Sliced Design — overview](https://feature-sliced.design/docs/get-started/overview)**
The most rigorous formalization of frontend layering. Three orthogonal axes:
- **Layers** (scope of influence): `app` → `pages` → `widgets` → `features` → `entities` →
  `shared`. Max 7, several optional. (`processes` is deprecated — do not include it.)
- **Slices** (business domain) — freely named; `app` and `shared` have none.
- **Segments** (technical purpose): `ui`, `model`, `api`, `lib`, `config`.
Two import rules: a layer may only import from layers **strictly below** it, and **slices
may not import from sibling slices on the same layer**. The segment vocabulary is the
cleanest available answer to the user's "where does business logic go" question — it goes in
`model`, alongside schemas and stores, separate from `ui` and from `api`.

**[Feature-Sliced Design — types guide](https://feature-sliced.design/docs/guides/examples/types)**
Directly answers the constants/types placement question, and answers it *against* the
conventional wisdom: **do not create a catch-all `shared/types` folder**, because "types"
names an essence, not a purpose. Organize by purpose and usage location instead
(`shared/analytics`, `shared/lib/utility-types`). Keep enums close to usage; only truly
common ones go to `shared`. Also documents the `@x` notation for explicitly-permitted
cross-slice imports, and per-slice `index.ts` as public API.

**[Robin Wieruch — React Folder Structure Best Practices](https://www.robinwieruch.de/react-folder-structure/)**
Valuable because it presents structure as a *progression* rather than a fixed target: single
file → technical grouping (`components/` `hooks/` `utils/`) → feature/domain grouping. The
skill should adopt this framing so it doesn't push a 40-folder skeleton onto a 5-component
app. Concrete placement rules: reusable → top-level folder, single-consumer → nested in the
feature; tests colocated (`component.test.js` beside `component.js`); utils organized by
concern (`utils/format/date-time/`). Treats index files as **public API boundaries** that
export only what's meant for external use — while conceding "barrel files are getting out of
fashion."

### Placement principle

**[Kent C. Dodds — Colocation](https://kentcdodds.com/blog/colocation)**
The one-line principle the whole skill can hang on: *"Place code as close to where it's
relevant as possible"* — or, per Dan Abramov, *"things that change together should be located
as close as reasonable."* Benefits framed as discoverability, applicability, and
maintenance (deleting a component deletes its tests and helpers with it — no orphans).
Crucially, it documents **the limits**: integration/E2E tests and system-wide docs belong at
the root, because they span modules and shouldn't need to move when `src/` is refactored.
A skill that only preaches colocation without these caveats would be wrong.

**[React docs — Thinking in React](https://react.dev/learn/thinking-in-react)**
Official, and the authority for *how to split a component*: single responsibility ("a
component should ideally only be concerned with one thing"); split from three angles
(programming, CSS, design); a well-structured data model naturally maps onto the component
hierarchy. Also the canonical state-placement algorithm — the three questions for
identifying minimal state (unchanged over time? passed via props? computable?), then find the
closest common parent of all consumers. This is the rigorous version of "where does state
live."

### Next.js specifics

**[Next.js — Project structure and organization](https://nextjs.org/docs/app/getting-started/project-structure)**
Official and deliberately **unopinionated**: *"choose a strategy that works for you and your
team and be consistent."* Documents the three sanctioned strategies — (1) all code outside
`app`, `app` purely for routing; (2) shared folders at the root of `app`; (3) split by
feature/route with globally-shared code at the `app` root. Mechanics that make colocation
safe: a route is not public until `page.js`/`route.js` exists, so **any** file can be
colocated in `app`; `_folder` private folders opt a subtree out of routing entirely;
`(group)` route groups organize without touching the URL; `src/` separates app code from
config. Explicit note that `components` and `lib` are *placeholders with no framework
significance* — worth quoting, since a lot of blog advice implies otherwise.

**[Next.js — How to Think About Security in Server Components and Actions](https://nextjs.org/blog/security-nextjs-server-components-actions)** (Sebastian Markbåge)
Despite the security framing, this is the strongest **architectural** statement Vercel has
published on where server-side business logic belongs. Offers three data-handling models and
tells you which to pick: HTTP APIs (existing large orgs), **Data Access Layer (recommended
for new projects)**, component-level data access (prototyping only) — plus *"stick to one
approach and don't mix and match."*
The DAL pattern: a dedicated module marked `import 'server-only'`, the sole place that
touches `process.env` and DB packages, which re-reads auth per call (`cache()`-wrapped
`getCurrentUser`) and returns **DTOs**, never ORM models. Server Actions stay thin and must
re-validate arguments and re-authorize. Includes an audit checklist that doubles as a set of
review rules. Directly answers "where does business logic live" for the Next.js half.

---

## Tier 2 — secondary sources

The two load-bearing ones were verified before `SKILL.md` was written; the rest remain
search-summary only and are marked as such.

### Business logic separation
- **[Felix Gerschau — Separation of concerns with React hooks](https://felixgerschau.com/react-hooks-separation-of-concerns/)** — ✅ **verified**
  Backs §6 directly. Three tiers: (1) framework-agnostic business logic as pure functions with
  no React dependency, testable with plain Node; (2) custom hooks as React-specific
  orchestration holding state and handlers; (3) presentational component receiving only props.
  *"Changing the hook doesn't affect the UI and vice-versa."* Carries an important caveat the
  skill adopts: **not every component warrants this separation** — pragmatism over ceremony.
- **[profy.dev — Path To A Clean(er) React Architecture](https://profy.dev/article/react-architecture-business-logic-and-dependency-injection)**
  — ⚠️ **domain did not resolve** (`ENOTFOUND`, Aug 2026). Clean-Architecture framing with
  use-cases and dependency injection. Superseded as a citation by Gerschau above; retry later
  if the DI material is wanted.
- **[Antony Leme — Business vs application logic](https://antonyleme.medium.com/business-vs-application-logic-how-to-separate-and-test-your-reactjs-code-4291d0c983b1)**
  — unverified. Source of the **business logic** (pure functions) vs **application logic**
  (custom hooks) naming, which is a sharper rule than `react-best-practices`' current
  "business logic in hooks/helpers".

### Server state vs client state
- **[TkDodo — React Query as a State Manager](https://tkdodo.eu/blog/react-query-as-a-state-manager)** — ✅ **verified**
  Backs §3. The frontend *doesn't own* server data, so it doesn't belong in a client store;
  React Query is itself the global manager for async state. Explicitly warns against "the urge
  to sync server data to a different state manager." Consequence the skill states: once server
  state is cached, very little genuine global client state remains — be suspicious of a large
  global store.
- **[TkDodo — Practical React Query](https://tkdodo.eu/blog/practical-react-query)** — unverified,
  same author; covers query keys and `staleTime` (more runtime than architecture).

### Barrel files / public API
- **[Steven Lemon — Are TypeScript Barrel Files an Anti-pattern?](https://steven-lemon182.medium.com/are-typescript-barrel-files-an-anti-pattern-72a713004250)**
- **[webpro-nl/unbarrelify](https://github.com/webpro-nl/unbarrelify)** — tooling for removal.
  — Counterweight to Wieruch and FSD, both of which endorse `index.ts` as a public API. The
  case against: bloated module graphs, slower builds/tests, circular-dependency hotspots,
  broken tree-shaking, "Go to Definition" landing on the barrel. **This is a genuine
  conflict between primary sources and must be resolved explicitly in the skill, not papered
  over** — see Open questions.

### Enforcing boundaries
- **[dependency-cruiser — taking frontend architecture seriously](https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/)**
- **[Avoid cross-module dependencies with dependency-cruiser](https://dev.to/jacobandrewsky/avoid-cross-module-dependencies-with-dependency-cruiser)**
  — Complements bulletproof-react's `import/no-restricted-paths` and `eslint-plugin-boundaries`
  with dependency graph visualization and cycle detection. The skill should state that a
  boundary rule not enforced by tooling is a suggestion, not an architecture.

### Component tiers
- **[shadcn/ui best practices](https://medium.com/write-a-catalyst/shadcn-ui-best-practices-for-2026-444efd204f44)**,
  **[The Ultimate shadcn/ui Handbook](https://shadcnspace.com/blog/shadcn-ui-handbook)**
  — The now-dominant three-tier convention: `ui/` (unmodified primitives) → `primitives/`
  (lightly adapted) → `blocks/` (product-level compositions). Pairs with the widely repeated
  UI-primitives → composed-components → feature-modules triad. Atomic Design (atoms/molecules/
  organisms/templates/pages) is largely superseded for app structure but survives as a
  vocabulary **inside the shared component library only** — that hybrid is worth stating.

### General surveys (low weight — cross-check anything taken from these)
- [Sandro Roth — How to structure your React projects](https://sandroroth.com/blog/project-structure/)
- [React Handbook — Project Standards](https://reacthandbook.dev/project-standards)
- [codecentric — Feature-Sliced Design and good frontend architecture](https://www.codecentric.de/en/knowledge-hub/blog/feature-sliced-design-and-good-frontend-architecture)
- [Sentry — Next.js directory organization best practices](https://sentry.io/answers/next-js-directory-organisation-best-practices/)
- [Wisp — Organizing Your Next.js 15 Project Structure](https://www.wisp.blog/blog/the-ultimate-guide-to-organizing-your-nextjs-15-project-structure)
- [Package by Layer vs Package by Feature](https://medium.com/sahibinden-technology/package-by-layer-vs-package-by-feature-7e89cde2ae3a)
  — the backend-origin argument that layer-packaging yields low cohesion + high coupling;
  useful as the *why* behind feature folders.

---

## Coverage map — your questions → sources

| Question | Primary answer from |
|---|---|
| Where do all components live? | bulletproof-react (structure) · Next.js project-structure · Wieruch |
| How should components be split? | React docs (Thinking in React) · shadcn three-tier |
| Where do constants live? | FSD types guide (by purpose, not by "essence") · Wieruch |
| What gets extracted to utils/helpers? | FSD segments (`lib`) · Wieruch (`utils/` by concern) · bulletproof-react |
| Where does business logic live? | FSD `model` segment · Next.js DAL · profy.dev (T2) |
| Where does state live? | React docs (common owner) · TkDodo server-vs-client (T2) |
| What may import what? | bulletproof-react (unidirectional + ESLint) · FSD (layer/slice rules) |
| Next.js specifics | Next.js project-structure · Next.js security/DAL post |

## Open questions — resolved in v1.0.0

1. **Barrel files** → *resolved: boundaries only.* `index.ts` at component/feature folder
   boundaries as public API; nowhere else. No app-wide barrel, no whole-directory re-exports,
   and never import a folder through its own barrel from inside it. This satisfies Wieruch/FSD
   (public API) while avoiding the module-graph and cycle costs the anti-barrel material
   documents. **Settled empirically** — `client/src/components/*/index.ts` is exactly this
   shape and works.
2. **FSD vs bulletproof-react** → *resolved: bulletproof-react as default.* Its topology and
   import rules are the base; FSD contributes the segment vocabulary (`ui`/`model`/`api`/`lib`)
   and the layer/slice import discipline. Full seven-layer FSD is not prescribed — that would
   be the over-engineering `react-best-practices` already warns against.
3. **Scale gating** → *resolved:* §0 gates everything behind a three-stage progression and is
   marked read-first.
4. **Repo fit** → *resolved: generic, with one repo note.* Audit of `client/` showed it is
   **stage 2** (technical grouping — `components/` `lib/` `lib/hooks/`, no `features/`), using
   kebab-case folders, PascalCase component files, `@/*` aliases, colocated tests, and
   per-component `constants.ts`/`helpers.ts`/`styles.ts`/`index.ts`. The skill stays generic
   and adds a single note telling agents not to introduce `features/` here unprompted.
   Note `client/src/vendor/**` is off-limits without an explicit request (root `AGENTS.md`).
5. **Severity tags** → *resolved:* CRITICAL/HIGH/MEDIUM, matching `react-best-practices`.

## Not yet covered — candidates for v1.1

- Dependency injection for testability (blocked on profy.dev being reachable).
- Monorepo/multi-package boundaries — this repo is 4 standalone packages joined by tsconfig
  path aliases, which is its own architectural topic the skill currently says nothing about.
- Where feature flags and i18n resources belong.
- `dependency-cruiser` config example to sit alongside the ESLint one.
