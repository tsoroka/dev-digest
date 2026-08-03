# docs/specs/

What we're about to build — written **before** the work. One spec = one feature
or one lesson. After merge the spec stays as a record of intent; the conclusions
move to `../../INSIGHTS.md`.

Nested under `docs/` because this package's top-level `specs/` holds the flow
tests themselves. Every other package keeps its specs at `<package>/specs/`.

Naming: `NN-<kebab-name>.md` (e.g. `01-run-cost-badge.md`).

## Template

```markdown
# <Title>

**Status:** draft | in progress | done
**Context:** why this exists, one or two sentences.

## Scope
- what's included
- what's deliberately excluded

## Acceptance criteria
- [ ] a checkable statement, not "make it good"
- [ ] ...

## Open questions
```
