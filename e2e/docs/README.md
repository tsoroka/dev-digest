# docs/

Deep dives on individual topics — the material that would bloat the package's
`README.md`. That README stays the entry point and links here.

One file per topic, named in `kebab-case.md`.

This is stable documentation. If the material goes stale weekly, it belongs in
`docs/specs/` (intent) or `../INSIGHTS.md` (conclusions) instead.

## `docs/specs/` — the e2e exception

Feature specs live in `docs/specs/`, not in `../specs/`. In this package the
top-level `specs/` directory holds the flow tests themselves (`*.flow.json`,
read by `run.ts`), so the feature-spec folder is nested here instead. Every
other package keeps its specs at `<package>/specs/`.
