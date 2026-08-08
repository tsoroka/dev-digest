---
name: frontend-architecture
description: "Frontend architecture — where code lives and what may import what. Use when creating a new component/feature/hook, deciding where to put constants, utils, types or business logic, splitting a file that has grown too large, reviewing project structure, or setting up a new React/Next.js app. Covers folder topology, module boundaries, layering, colocation, and import direction. Architecture only — not runtime performance."
version: 1.0.0
---

# Frontend Architecture

Structural rules: **where code lives, how it is split, and which module may import which.**
Performance is out of scope. For sources behind every rule, see [README.md](README.md).

## Boundary with the other skills

Do not restate what these already cover — defer to them:

- **`react-best-practices`** — rules *inside* a component (derived state, hook misuse, keys, memoization).
- **`next-best-practices`** — framework *mechanics* (RSC rules, async APIs, metadata, route handlers).

This skill owns only the question *"which file does this code go in, and may it import that?"*
Where they touch: `next-best-practices` says how `'use client'` behaves; **this** skill says
which layer is allowed to declare it.

## Severity

Matching `react-best-practices` so review agents can compose the two.

- **CRITICAL** — creates coupling that gets expensive to undo; fix before merge
- **HIGH** — will cause structural drift as the app grows
- **MEDIUM** — consistency and navigability

---

## 0. Scale gating (read first) — CRITICAL

The most common architecture failure is applying large-app topology to a small app. Structure
is a **progression**, not a target. Locate the project before applying anything below.

| Stage | When | Structure |
|---|---|---|
| **1 — Flat** | < ~15 components | `src/components/`, `src/lib/`. No feature folders. |
| **2 — Technical grouping** | one coherent product, < ~40 components | `components/` `lib/` `hooks/` `types/` + routing dir. Split files by *purpose within a folder*. |
| **3 — Feature/domain grouping** | multiple independent domains, or >1 team | `features/<domain>/` owning its own `api` `components` `hooks` `stores` `types` `utils`. |

Rules:

- **Never create a folder before it has two occupants.** An empty-ish `utils/` invites dumping.
- **Do not jump straight to stage 3.** Promote a feature folder when a domain actually
  demonstrates it needs one, not in anticipation.
- Moving 2 → 3 is cheap if stage 2 respected colocation. Moving 3 → 2 never happens, so the
  cost of guessing high is permanent.

> This repo's `client/` is a textbook **stage 2**. Do not introduce `features/` into it
> without an explicit request.

---

## 1. The placement rule — CRITICAL

> **Place code as close to where it's relevant as possible.**
> Things that change together live together.

This one rule answers most placement questions. Its corollaries:

- **Default to local.** New code starts in the folder that uses it. It moves outward only
  when a *second* consumer appears — not because it "feels shared."
- **Deleting the consumer should delete the code.** If deleting a component leaves orphaned
  helpers/constants/tests elsewhere, they were misplaced.
- **One consumer = not shared.** A "shared" module with one importer is premature abstraction.

**Limits of colocation** (do not over-apply):

- E2E/integration tests live at the root — they span modules, and refactoring `src/` must not
  force them to move.
- Cross-cutting docs group at the domain level, not per file.

## 2. Where components live — HIGH

```
components/<kebab-name>/
  ComponentName.tsx     # the component
  constants.ts          # magic values used only here
  helpers.ts            # pure functions used only here
  styles.ts             # style objects/variants
  index.ts              # public API — the ONLY entry other folders may import
  ComponentName.test.tsx
```

- Everything a component owns sits in **its own folder**, not scattered into global
  `constants/` / `helpers/` / `styles/` folders.
- Segment files (`constants` / `helpers` / `styles`) appear **only when they earn it** —
  a component with three constants keeps them at the top of its own file.
- Tests colocate beside their subject.
- Promote to a shared location only on the second consumer, and move the whole folder.

### Component tiers — MEDIUM

Three tiers, not five. Atomic Design's atoms/molecules/organisms is superseded for app
structure; keep it (if at all) as vocabulary *inside* the shared UI library only.

1. **UI primitives** — `components/ui/`. Button, Input, Card. Know nothing about the domain.
2. **Composed components** — domain-agnostic assemblies. Forms, data tables, modals.
3. **Feature modules** — own business meaning; may import 1 and 2, never the reverse.

## 3. How to split a component — HIGH

Split on **responsibility, not line count**. Line thresholds are a smell detector, not a rule
— a 300-line form with one job is fine; a 60-line component doing three things is not.

Split when any of these is true:

- The component has more than one reason to change.
- A subtree could be described with a name that isn't "the middle part of X".
- A distinct slice of the data model maps to a distinct subtree — a well-structured data
  model naturally suggests the component hierarchy.
- Part of the tree needs interactivity and the rest does not (see §7).

Do **not** split to hit a number, and do not split a subtree that can never be rendered or
reasoned about independently — that just adds prop-threading.

### Where state lives

Three questions — if any is yes, **it is not state**:

1. Does it stay unchanged over time?
2. Is it passed in from a parent?
3. Can it be computed from existing props/state?

For what survives: find every component that reads it, then put it in their **closest common
parent**. Not higher.

Client vs server state is an architectural split, not a storage detail:

- **Server state** — the frontend does not own it. It belongs in the query cache
  (TanStack Query et al.), keyed by its inputs. **Never mirror it into a client store**; that
  creates two sources of truth that drift.
- **Client state** — genuinely local UI concerns. Once server state is in the cache, very
  little real global state remains. Be suspicious of a large global store.
- **URL state** — filters, pagination, tabs, search. Belongs in search params.

## 4. Constants — HIGH

Constants go to **the narrowest scope that has all their consumers**:

| Scope | Location |
|---|---|
| One component | top of its file, or its `constants.ts` |
| One feature | `features/<x>/constants.ts` |
| Truly app-wide | `config/` (env, feature flags, app settings) |

- **Do not create a global `constants.ts` barrel.** It becomes an unowned dumping ground
  coupling unrelated modules, and nothing is ever deleted from it.
- **Group by purpose, never by essence.** `shared/analytics` — yes. `shared/constants`,
  `shared/types` — no: "constant" and "type" describe what something *is*, which tells a
  reader nothing about when to reach for it.
- Environment values are read in exactly one place (`config/`), never `process.env` scattered
  through components.

## 5. Utils, helpers, lib — HIGH

Distinguish three things that commonly get merged into one `utils/` swamp:

- **helpers** — pure functions serving *one* module. Live beside it. Most code belongs here.
- **utils** — genuinely generic, domain-free, reusable (`formatDate`, `clamp`). Promote only
  on the second consumer. Organize by concern (`utils/format/date-time`), never one flat file.
- **lib** — preconfigured *third-party* integrations: the HTTP client instance, the query
  client, the i18n setup. This is wrappers around dependencies, not your own logic.

Rules:

- **A function that mentions a domain concept is not a util.** It is feature code — keep it
  in the feature.
- `utils/` must not import from `features/` or the app layer. If a util needs domain types,
  it is misfiled.
- Never a single `utils.ts`. Name the concern.

## 6. Business logic — CRITICAL

The core question, and the one most often answered by smearing logic across components.

Three distinct things, three destinations:

| Kind | Goes in | Shape |
|---|---|---|
| **Business logic** — rules, calculations, validation, transformation | plain modules (`model` / `<feature>/model.ts`) | **pure functions**, no React import |
| **Application logic** — orchestration, wiring state to those rules | **custom hooks** | may use React |
| **Data access** — talking to the backend | `api/` module (server-side: a Data Access Layer) | returns DTOs |

- **Business logic must not import React.** The test: if the codebase moved to another view
  layer tomorrow, this file survives untouched. If it can't, it's application logic.
- **Components render.** A component body holds no rules, no calculations, no fetching — it
  calls a hook and renders. Helper functions are defined outside the component body.
- **Hooks orchestrate, they don't implement.** A 200-line hook full of business rules is the
  same problem as a fat component, moved. Rules go in pure functions the hook calls.
- Pure functions are the target because they are trivially testable without rendering.

## 7. Next.js specifics — HIGH

### Routing dir holds routing

`app/` is for routing. Application code lives outside it, or colocated inside route segments —
pick **one** strategy and hold it project-wide. Mixing is the actual failure mode.

Mechanics that make colocation safe:

- A route is not public until `page.tsx`/`route.ts` exists — any file can safely sit in `app/`.
- `_folder` opts a subtree out of routing entirely.
- `(group)` organizes routes without touching the URL.
- `src/` separates application code from root config.

`components` and `lib` carry **no framework significance** — they are conventional names, not
Next.js concepts. Do not architect around a belief that Next.js cares.

### The client boundary is an architectural decision — CRITICAL

- **`'use client'` belongs at the leaves.** The boundary is inherited: every module a
  `'use client'` file imports joins the client bundle. Declaring it high in the tree drags
  the subtree with it.
- A component needing interactivity is extracted into its own small client component, rather
  than converting its parent.
- Server components compose client components and pass data down — not the reverse.

### Server-side data access — CRITICAL

For new projects, consolidate all data access into a **Data Access Layer**:

- Marked `import 'server-only'` — the build then fails if a client module imports it.
- **The only place** that touches DB packages and `process.env`.
- Re-reads auth per call and re-checks authorization inside each function. Never trusts a
  caller-passed identity, `searchParams`, or route params.
- Returns **DTOs** — minimal plain objects safe to hand to the client. Never ORM models or
  full records; a client component must not receive more data than it renders.
- Server Actions stay **thin**: validate arguments, re-authorize, delegate. Their argument
  list is attacker-controlled regardless of TypeScript types.

Pick one data-handling model (DAL, HTTP APIs, or component-level queries) and stay with it —
consistency is what makes an exception visible.

## 8. Import direction — CRITICAL

The rule that keeps everything above from decaying:

> **Dependencies point one way: `shared → features → app`.**

- `shared/` (components, hooks, lib, utils, types) may be imported by anyone, and imports
  from no one above it.
- `features/` may import shared. **A feature must never import another feature** — compose
  them at the app/route layer instead.
- `app/` composes everything; nothing imports from `app/`.
- No circular imports, ever.

**Cross-feature import is the single highest-value thing to reject in review.** It is what
turns a feature folder back into a mud ball, and it's invisible until unpickable.

If two features need the same thing, one of these is true — pick deliberately:

1. It's generic → move it to `shared/`.
2. It's a domain concept both depend on → extract a lower-level entity module both may import.
3. They are one feature wearing two names → merge them.

### Public API via index — HIGH

- Each **component/feature folder** exposes an `index.ts` — its public API. Other folders
  import the folder, never reach into its internals.
- Export only what is genuinely external. Internal helpers stay unexported — that is what
  makes them safe to change.
- **Do not put barrels anywhere else.** No app-wide `src/index.ts`, no re-exporting whole
  directories, no barrel that only wraps one file. Wide barrels inflate the module graph,
  slow builds and tests, break tree-shaking, and are the usual home of circular imports.
- **Within** a folder, import siblings directly (`./helpers`), never through its own barrel —
  that is the classic self-referential cycle.

### Enforce it in tooling — HIGH

An unenforced boundary is a suggestion. Encode the rules:

```js
// eslint.config.js
'import/no-restricted-paths': ['error', { zones: [
  // no cross-feature imports
  { target: './src/features/billing', from: './src/features', except: ['./billing'] },
  // features may not import the app layer
  { target: './src/features', from: './src/app' },
  // shared may not import features or app
  { target: ['./src/components', './src/hooks', './src/lib', './src/utils', './src/types'],
    from: ['./src/features', './src/app'] },
]}],
```

Add `import/no-cycle`. `dependency-cruiser` covers the same ground with graph visualization
if the project wants it.

## 9. Naming — MEDIUM

Pick one convention and never mix — mixed casing is the real cost, not the choice itself.

- **Folders: kebab-case**, always (`run-cost-badge`).
- **Files:** either kebab-case throughout, or PascalCase for components + kebab-case for
  everything else. Follow whatever the project already does.
- **Anything returning JSX is PascalCase** and is a component — a `renderThing()` function is
  not a component and breaks reconciliation.
- **Path aliases over relative chains.** `@/components/x`, never `../../../components/x`.
  Relative imports are for siblings within a folder.
- Folder name states the domain, not the pattern: `billing/`, not `containers/`.

---

## Review checklist

- [ ] Structure matches the project's **stage** — no anticipatory folders
- [ ] New code sits with its only consumer; nothing promoted to "shared" at one consumer
- [ ] No cross-feature imports; no cycles; dependency direction holds
- [ ] Business rules are pure functions with no React import
- [ ] Components render — no rules, calculations, or fetching in the body
- [ ] Constants at narrowest scope; no global constants dump; no `process.env` outside config
- [ ] Domain-aware function has not been filed under `utils/`
- [ ] Barrels only at folder boundaries; no self-referential barrel imports
- [ ] Server state in the query cache, not mirrored into a client store; URL state in the URL
- [ ] (Next.js) `'use client'` at the leaves; DAL is `server-only` and returns DTOs
- [ ] Boundary rules are encoded in ESLint, not just documented

## Changelog

### 1.0.0 — 2026-08-06
Initial version. Derived from bulletproof-react, Feature-Sliced Design, React docs, Next.js
docs, and Kent C. Dodds' colocation principle — full source list with per-rule attribution in
[README.md](README.md). Resolved two open questions: barrels scoped to folder boundaries only,
and bulletproof-react as the default topology with FSD's segment vocabulary layered on rather
than full seven-layer FSD.
