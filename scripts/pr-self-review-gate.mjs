#!/usr/bin/env node
/**
 * PR Self Review — the deterministic half.
 *
 * The `/pr-self-review` skill and the PreToolUse hook both call this script, so
 * they can never disagree about what "the current change" is. Three subcommands:
 *
 *   scope       what would land in the PR: files, changed lines, lanes, scope_hash
 *   guardrails  the AGENTS.md violations that need no judgement — zero LLM
 *   hook        PreToolUse gate for `gh pr create|ready|merge`
 *
 * Node ESM, no dependencies (Node >= 22 is already required by server/).
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERDICT_REL = '.claude/pr-self-review/verdict.json';
const DISMISSED_REL = '.claude/pr-self-review/dismissed.json';
const LANES_REL = '.claude/skills/pr-self-review/lanes.json';
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Commands the hook refuses to run without a fresh, clean verdict.
 *
 * There used to be a `shellLiveText()` pass here that reduced a command to the
 * parts a shell would actually execute, so `echo "gh pr create"` was allowed
 * while `bash -c "gh pr create"` was denied. It was deleted: three review rounds
 * produced five fail-opens and *every one* was in that function — `$(…)` inside
 * double quotes, `<<<` misread as a heredoc, a quoted `<<` swallowing the rest of
 * the command, `/bin/sh -c`, `bash --norc -c`. Each fix revealed the next case.
 *
 * The rule that replaced it: **complexity is allowed only in the widening
 * direction.** The old parser was intricate in order to *narrow* — to let
 * mentions through — so every bug in it was a fail-open. What is below is
 * intricate in order to *widen*, and its worst case is a spurious deny. That
 * asymmetry is the whole design: a false DENY costs the user a workaround, a
 * false ALLOW costs the gate its reason to exist.
 *
 * So: normalize away the two things that hide a real invocation — line
 * continuations and quotes — then match `gh … pr … <sub>`, tolerating any
 * intervening token that is not a command separator. Round 4 found that insisting
 * on three *adjacent* words missed `gh pr \⏎create`, `gh.exe pr create`,
 * `"gh" pr create`, `gh pr "create"` and `gh -R o/r pr create` (that last one
 * verified against the real binary — `gh` does accept `-R` before the subcommand).
 *
 * Two things are subtle enough to spell out, because both were review findings:
 *
 * 1. **Case-insensitive.** Round 5: `GH pr create` runs on Windows — verified,
 *    `GH --version` prints the real gh — and this is a Windows repo. A
 *    case-sensitive match here fails open on every non-lowercase spelling, which
 *    made the `.exe` branch guard the one platform whose casing it ignored.
 * 2. **Both normalizations are tested, not one.** Replacing a quote with a *space*
 *    keeps tokens apart, which is what catches `x"gh" pr create`. But it also
 *    splits a token that a quote sits inside, which is how `gh pr cre"ate"` and
 *    `gh p\⏎r create` slipped through. Removing the quote instead closes those
 *    and breaks the first. Neither normalization dominates, so try both and deny
 *    if either matches — widening, per the rule above.
 *
 * Accepted limit, so nobody trusts this further than it goes: it is not a shell
 * parser and cannot be. A construct that hides the program name from *both*
 * normalizations gets through. `$(command -v gh) pr create` is **not** such a case
 * — the literal `gh` inside satisfies the match. If a real miss turns up, widen
 * again; never narrow.
 *
 * Practical consequence, worth knowing before it surprises you: a Bash call that
 * merely *writes* about these commands is denied too. Split the phrase — the test
 * file does exactly that — or use the Write tool instead.
 */
const GUARDED = /\bgh(?:\.exe)?\b[^\n;&|]*\bpr\b[^\n;&|]*\b(?:create|ready|merge)\b/i;

/** Does this command line name a guarded `gh pr` subcommand? */
export function isGuardedCommand(command) {
  const s = String(command ?? '');
  // Spacing preserves token boundaries; removing closes tokens a quote or a line
  // continuation splits. Neither wins outright, so either match is a deny.
  const spaced = s.replace(/\\\r?\n/g, ' ').replace(/["'`]/g, ' ');
  const joined = s.replace(/\\\r?\n/g, '').replace(/["'`]/g, '');
  return GUARDED.test(spaced) || GUARDED.test(joined);
}

/**
 * Never reviewed, never hashed — build output, deps, our own run artifacts.
 * Vendored skill packs are deliberately NOT here: they only enter a change set
 * when someone actually re-vendors one, and then that IS the change. Which lane
 * (if any) picks them up is lanes.json's call, not this list's.
 */
const IGNORED = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '.claude/pr-self-review/**',
];

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------

function git(args, { cwd = process.cwd(), allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (allowFail) return null;
    throw err;
  }
}

function repoRoot() {
  const out = git(['rev-parse', '--show-toplevel']);
  return out.trim();
}

/**
 * The base of the change: merge-base with the trunk. Falls back through the
 * usual trunk names, then to HEAD (so a repo with no trunk still reviews the
 * dirty worktree rather than the whole history).
 */
function resolveBase(root) {
  for (const ref of ['main', 'origin/main', 'master', 'origin/master']) {
    if (!git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, allowFail: true }))
      continue;
    const mb = git(['merge-base', ref, 'HEAD'], { cwd: root, allowFail: true });
    if (mb) return { base: mb.trim(), trunk: ref };
  }
  const head = git(['rev-parse', '--verify', '--quiet', 'HEAD'], { cwd: root, allowFail: true });
  return { base: head ? head.trim() : EMPTY_TREE, trunk: null };
}

// ---------------------------------------------------------------------------
// globs — `**`, `*`, `?`, `{a,b}`; `/` is a hard boundary for a single `*`
// ---------------------------------------------------------------------------

export function expandBraces(glob) {
  const open = glob.indexOf('{');
  if (open === -1) return [glob];
  let depth = 0;
  let close = -1;
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === '{') depth++;
    else if (glob[i] === '}' && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close === -1) return [glob];
  const head = glob.slice(0, open);
  const tail = glob.slice(close + 1);
  const parts = [];
  let depth2 = 0;
  let cur = '';
  for (const ch of glob.slice(open + 1, close)) {
    if (ch === '{') depth2++;
    if (ch === '}') depth2--;
    if (ch === ',' && depth2 === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts.flatMap((p) => expandBraces(head + p + tail));
}

export function globToRegex(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:[^/]+/)*';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$');
}

const regexCache = new Map();
export function matches(file, glob) {
  let list = regexCache.get(glob);
  if (!list) {
    list = expandBraces(glob).map(globToRegex);
    regexCache.set(glob, list);
  }
  return list.some((r) => r.test(file));
}

const matchesAny = (file, globs) => globs.some((g) => matches(file, g));
const isIgnored = (file) => matchesAny(file, IGNORED);

// ---------------------------------------------------------------------------
// diff parsing
// ---------------------------------------------------------------------------

/**
 * Parse `git diff -U0` into `path -> [[start, end], ...]` of new-side line
 * numbers, plus the added lines themselves. This is the local equivalent of
 * `buildLineIndex()` in reviewer-core/src/grounding.ts — it is what lets the
 * skill drop a finding that cites a line nobody changed.
 */
export function parseUnifiedDiff(text) {
  /** @type {Map<string, {ranges: number[][], added: {line: number, text: string}[], binary: boolean}>} */
  const files = new Map();
  let cur = null;
  let inHunk = false;
  let newLine = 0;

  const open = (file) => {
    const entry = files.get(file) ?? { ranges: [], added: [], binary: false };
    files.set(file, entry);
    return entry;
  };

  for (const raw of text.split('\n')) {
    // `diff --git a/x b/y` always precedes a file, including binary ones and
    // renames, which emit no `+++` at all. Taking the path from HERE rather than
    // from `+++` is what makes binary detection reachable.
    if (raw.startsWith('diff --git ')) {
      inHunk = false;
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
      cur = m ? open(m[2]) : null;
      continue;
    }

    // Header lines are only headers BEFORE the first hunk. Inside a hunk they
    // are content: an added line reading `++ b/foo` renders as `+++ b/foo` and
    // used to be mistaken for a file header, silently reattributing every later
    // hunk to a phantom path.
    if (!inHunk) {
      if (raw.startsWith('+++ ')) {
        const p = raw.slice(4).trim();
        cur = p === '/dev/null' ? null : open(p.startsWith('b/') ? p.slice(2) : p);
        continue;
      }
      if (raw.startsWith('--- ')) continue;
      if (raw.startsWith('Binary files ') || raw.startsWith('GIT binary patch')) {
        if (cur) cur.binary = true;
        continue;
      }
    }

    if (raw.startsWith('@@')) {
      const m = /^@@+ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (!m || !cur) continue;
      inHunk = true;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      if (count > 0) cur.ranges.push([start, start + count - 1]);
      newLine = start;
      continue;
    }

    if (!inHunk || !cur) continue;
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    if (raw.startsWith('+')) {
      cur.added.push({ line: newLine, text: raw.slice(1) });
      newLine++;
    } else if (!raw.startsWith('-')) {
      newLine++; // context line (only appears with -U>0, but keep the counter honest)
    }
  }
  return files;
}

/** Every line of an untracked file counts as changed. */
function wholeFileEntry(abs) {
  let text = '';
  try {
    text = readFileSync(abs, 'utf8');
  } catch {
    return { ranges: [], added: [], binary: true };
  }
  if (text.includes('\0')) return { ranges: [], added: [], binary: true };
  const lines = text.split('\n');
  const n = Math.max(lines.length, 1);
  return {
    ranges: [[1, n]],
    added: lines.map((t, i) => ({ line: i + 1, text: t })),
    binary: false,
  };
}

// ---------------------------------------------------------------------------
// scope
// ---------------------------------------------------------------------------

function loadLanes(root) {
  const p = path.join(root, LANES_REL);
  if (!existsSync(p)) return { lanes: [], packages: {}, excluded: [] };
  return JSON.parse(readFileSync(p, 'utf8'));
}

function computeScope(root) {
  const { base, trunk } = resolveBase(root);
  const branch = (git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, allowFail: true }) ?? '')
    .trim();
  const head = (git(['rev-parse', 'HEAD'], { cwd: root, allowFail: true }) ?? '').trim();

  // `--no-renames` must match the --name-status call below. Without it git
  // reports a rename as `similarity index / rename from / rename to` with no
  // hunks at all, while --name-status reports `D old` + `A new` — so the new
  // path arrived with an empty changed-line range and nothing, not even a
  // guardrail finding anchored on it, could be grounded against it.
  const diffText =
    git(['diff', '-U0', '--no-color', '--no-renames', base], { cwd: root, allowFail: true }) ?? '';
  const statusText =
    git(['diff', '--name-status', '--no-renames', base], { cwd: root, allowFail: true }) ?? '';
  const untrackedText =
    git(['ls-files', '--others', '--exclude-standard'], { cwd: root, allowFail: true }) ?? '';

  const parsed = parseUnifiedDiff(diffText);

  /** @type {Map<string, string>} */
  const status = new Map();
  for (const line of statusText.split('\n')) {
    if (!line.trim()) continue;
    const [code, file] = line.split('\t');
    if (file) status.set(file, code[0]);
  }

  const untracked = untrackedText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => !isIgnored(f));

  const lanesCfg = loadLanes(root);
  const files = [];

  const add = (file, st, entry) => {
    if (isIgnored(file)) return;
    const lanes = lanesCfg.lanes
      .filter((l) => matchesAny(file, l.globs) && !matchesAny(file, l.exclude ?? []))
      .map((l) => l.id);
    files.push({
      path: file,
      status: st,
      binary: entry.binary,
      changed_lines: entry.ranges,
      lanes,
      excluded: matchesAny(file, lanesCfg.excluded ?? []),
    });
  };

  for (const [file, code] of status) {
    if (code === 'D') {
      add(file, 'deleted', { ranges: [], added: [], binary: false });
      continue;
    }
    add(file, code === 'A' ? 'added' : 'modified', parsed.get(file) ?? { ranges: [], added: [], binary: false });
  }
  for (const file of untracked) add(file, 'untracked', wholeFileEntry(path.join(root, file)));

  files.sort((a, b) => a.path.localeCompare(b.path));

  // Freshness. One definition, used by both the skill (stores it) and the hook
  // (recomputes it). Untracked content is folded in so a new file counts.
  const h = createHash('sha256');
  h.update(base);
  h.update('\0');
  h.update(diffText);
  for (const file of [...untracked].sort()) {
    h.update('\0');
    h.update(file);
    h.update('\0');
    try {
      h.update(readFileSync(path.join(root, file)));
    } catch {
      /* unreadable — path alone still moves the hash */
    }
  }

  const active = new Set(files.flatMap((f) => (f.excluded ? [] : f.lanes)));
  const pkgs = new Set();
  for (const f of files) {
    for (const [pkg, prefix] of Object.entries(lanesCfg.packages ?? {})) {
      if (f.path.startsWith(prefix)) pkgs.add(pkg);
    }
  }

  return {
    base,
    head,
    trunk,
    branch,
    scope_hash: h.digest('hex'),
    file_count: files.length,
    files,
    lanes: lanesCfg.lanes.filter((l) => active.has(l.id)),
    packages: [...pkgs].sort(),
    // Changed, not excluded, and matched by no lane — so no reviewer will ever
    // see it. Silently reviewing nothing is the one failure a review tool must
    // not have, so this is surfaced rather than left to be noticed.
    unrouted: files.filter((f) => !f.excluded && f.lanes.length === 0).map((f) => f.path),
    _diff: parsed,
    _untracked: untracked,
  };
}

// ---------------------------------------------------------------------------
// guardrails — documented invariants, checked mechanically
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'OpenAI-style API key'],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, 'private key'],
  [/\b(?:api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"][A-Za-z0-9+/_-]{24,}['"]/i, 'hardcoded credential'],
];

function finding(o) {
  return {
    severity: 'CRITICAL',
    category: 'bug',
    kind: 'finding',
    confidence: 1,
    source: 'guardrail',
    suggestion: null,
    ...o,
  };
}

function firstLine(f) {
  return f.changed_lines.length ? f.changed_lines[0][0] : 1;
}

/** Working-tree contents, or null. */
function fileText(root, p) {
  try {
    return readFileSync(path.join(root, p), 'utf8');
  } catch {
    return null;
  }
}

/** Contents at the merge-base, or null when the file is new. */
function baseText(root, base, p) {
  return git(['show', `${base}:${p}`], { cwd: root, allowFail: true });
}

/** Names a module exports — `export { a, b as c }`, `export const d`, `export type E`. */
export function exportedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const raw of m[1].split(',')) {
      const part = raw.trim().replace(/^type\s+/, '');
      if (!part) continue;
      const alias = /\sas\s+(\w+)$/.exec(part);
      names.add(alias ? alias[1] : part.split(/\s+/)[0]);
    }
  }
  for (const m of src.matchAll(
    /export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|function|class|type|interface|enum)\s+(\w+)/g,
  )) {
    names.add(m[1]);
  }
  names.delete('');
  return names;
}

/** Resolve a dotted next-intl key inside a namespace object. */
export function hasMessageKey(obj, key) {
  let cur = obj;
  for (const seg of key.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(seg in cur)) return false;
    cur = cur[seg];
  }
  return typeof cur === 'string';
}

/** Drizzle builders whose appearance in a schema diff implies a DDL change. */
const DDL_SIGNAL =
  /\b(?:pgTable|pgEnum|pgView|uniqueIndex|primaryKey|foreignKey|references|notNull|serial|bigserial)\b|\b(?:text|varchar|char|integer|bigint|smallint|uuid|timestamp|date|time|jsonb|json|boolean|real|doublePrecision|numeric|decimal|vector|index|unique)\s*\(/;

function computeGuardrails(root, scope) {
  const out = [];
  const paths = new Set(scope.files.map((f) => f.path));
  const addedOf = (file) =>
    scope.files.find((f) => f.path === file)?.status === 'untracked'
      ? wholeFileEntry(path.join(root, file)).added
      : (scope._diff.get(file)?.added ?? []);

  for (const f of scope.files) {
    const p = f.path;
    const line = firstLine(f);

    // Root AGENTS.md — "Do not touch without an explicit request".
    if (matches(p, '*/src/vendor/**')) {
      out.push(
        finding({
          category: 'bug',
          title: 'Vendored file modified',
          file: p,
          start_line: line,
          end_line: line,
          rationale:
            '`*/src/vendor/**` holds vendored copies of `@devdigest/shared` and `@devdigest/ui`. ' +
            'Root `AGENTS.md` puts it under "Do not touch without an explicit request" — edits here are ' +
            'silently overwritten on the next vendor sync and drift the two copies apart.',
          suggestion: 'Revert this file, and change the upstream package instead.',
        }),
      );
    }

    // Secrets never go in git.
    if (matches(p, '**/.env') || matches(p, '**/.env.*') || matches(p, '**/secrets.json')) {
      out.push(
        finding({
          category: 'security',
          kind: 'secret_leak',
          title: 'Secret-bearing file staged for commit',
          file: p,
          start_line: line,
          end_line: line,
          rationale:
            'Secrets never go in the DB or in git — they live in `~/.devdigest/secrets.json` and are read ' +
            'through `SecretsProvider` (root `AGENTS.md`).',
          suggestion: 'Remove the file from the change set and add it to `.gitignore`.',
        }),
      );
    }

    if (f.binary || f.status === 'deleted') continue;
    const added = addedOf(p);

    for (const { line: n, text } of added) {
      for (const [re, what] of SECRET_PATTERNS) {
        if (re.test(text)) {
          out.push(
            finding({
              category: 'security',
              kind: 'secret_leak',
              title: `Possible ${what} in an added line`,
              file: p,
              start_line: n,
              end_line: n,
              rationale: `An added line matches the ${what} pattern. Committed credentials must be treated as leaked even if the commit is later removed.`,
              suggestion: 'Move the value into `~/.devdigest/secrets.json` and read it via `SecretsProvider`.',
            }),
          );
          break;
        }
      }

      // server/AGENTS.md — TypeScript ESM: relative imports must carry `.js`.
      // `server/src/db/**` is exempt and measurably so: all 56 extensionless
      // relative imports in the server live there, against 230 elsewhere that
      // carry the suffix. Those files are read by drizzle-kit's own bundler, not
      // by Node's ESM resolver, so the rule genuinely does not apply to them.
      if (
        (matches(p, 'server/src/**/*.ts') && !matches(p, 'server/src/db/**')) ||
        matches(p, 'reviewer-core/src/**/*.ts')
      ) {
        const m = /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]|\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]/.exec(text);
        const spec = m?.[1] ?? m?.[2];
        if (spec && !/\.(js|json|css|md|node|mjs|cjs)$/.test(spec)) {
          out.push(
            finding({
              category: 'bug',
              title: 'Relative import missing the `.js` extension',
              file: p,
              start_line: n,
              end_line: n,
              rationale:
                `\`${spec}\` has no extension. This package is TypeScript ESM (Node >= 22) — relative ` +
                'imports **must** carry `.js` or the module fails to resolve at runtime, which `tsc` will not catch.',
              suggestion: `Import from \`${spec}.js\`.`,
            }),
          );
        }
      }

      // client/AGENTS.md — a bare fetch inside a component is a reason to stop.
      const isComponent =
        (matches(p, 'client/src/app/**/_components/**/*.tsx') ||
          matches(p, 'client/src/components/**/*.tsx')) &&
        !matches(p, '**/*.test.tsx');
      // A focused test silently disables every other test in the file. Note that
      // `.skip` is NOT flagged: `hasDocker ? describe : describe.skip` is the
      // documented way integration tests self-skip without Docker.
      if (matches(p, '**/*.test.{ts,tsx}') && /\b(?:describe|it|test)\.only\b/.test(text)) {
        out.push(
          finding({
            category: 'test',
            title: 'Focused test left in the suite',
            file: p,
            start_line: n,
            end_line: n,
            rationale:
              '`.only` silences every other test in this file. CI stays green while running a fraction ' +
              'of the suite, which is worse than a red build because nobody looks.',
            suggestion: 'Drop the `.only` before committing.',
          }),
        );
      }

      // server/AGENTS.md: the API logs through Pino. The two CLI entrypoints
      // (seed, migrate) legitimately print to the console.
      if (
        matches(p, 'server/src/**/*.ts') &&
        !matches(p, 'server/src/db/seed*.ts') &&
        !matches(p, 'server/src/db/migrate.ts') &&
        /(?<![.\w])console\.(?:log|info|debug)\s*\(/.test(text)
      ) {
        out.push(
          finding({
            severity: 'WARNING',
            category: 'style',
            title: '`console` call in the API',
            file: p,
            start_line: n,
            end_line: n,
            rationale:
              'The server logs through Pino (`fastify.log` / the request logger), which is what carries the ' +
              'request id and what `NODE_ENV=test` silences. A bare `console` call escapes both.',
            suggestion: 'Use `req.log` / `fastify.log` instead.',
          }),
        );
      }

      if (isComponent && /(?<![.\w])fetch\s*\(/.test(text)) {
        out.push(
          finding({
            category: 'bug',
            title: 'Bare `fetch` inside a component',
            file: p,
            start_line: n,
            end_line: n,
            rationale:
              'A component never fetches on its own (`client/AGENTS.md`, "a reason to stop"). Data goes ' +
              'through a hook in `src/lib/hooks/`, which calls the single chokepoint `src/lib/api.ts` — ' +
              'that is also what makes the component testable with a mocked fetch.',
            suggestion: 'Move the call into `src/lib/api.ts` and expose it as a hook in `src/lib/hooks/`.',
          }),
        );
      }
    }

    // client/AGENTS.md — no literal copy in JSX, everything through next-intl.
    // A key missing from messages/en/<ns>.json renders as the raw key at runtime;
    // neither typecheck nor the unit tests notice.
    if (matches(p, 'client/src/**/*.tsx') && !matches(p, '**/*.test.tsx')) {
      const src = fileText(root, p) ?? '';
      const bindings = new Map();
      for (const m of src.matchAll(
        /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(\s*['"`]([\w.-]+)['"`]\s*\)/g,
      )) {
        bindings.set(m[1], m[2]);
      }

      const nsCache = new Map();
      const loadNs = (ns) => {
        if (!nsCache.has(ns)) {
          const raw = fileText(root, `client/messages/en/${ns}.json`);
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = null;
          }
          nsCache.set(ns, parsed);
        }
        return nsCache.get(ns);
      };

      for (const { line: n, text } of added) {
        for (const [name, ns] of bindings) {
          const call = new RegExp(`(?<![.\\w])${name}(?:\\.rich|\\.raw|\\.markup)?\\(\\s*['"]([^'"]+)['"]`, 'g');
          for (const m of text.matchAll(call)) {
            const messages = loadNs(ns);
            if (messages && hasMessageKey(messages, m[1])) continue;
            out.push(
              finding({
                category: 'bug',
                title: messages ? `Missing translation key \`${ns}.${m[1]}\`` : `Missing message namespace \`${ns}\``,
                file: p,
                start_line: n,
                end_line: n,
                rationale: messages
                  ? `\`${name}('${m[1]}')\` resolves to \`${ns}.${m[1]}\`, which is not in ` +
                    '`client/messages/en/' + ns + '.json`. next-intl renders the raw key — a visible defect ' +
                    'that no typecheck or unit test catches.'
                  : `\`useTranslations('${ns}')\` has no \`client/messages/en/${ns}.json\`. Namespaces are ` +
                    'file-per-feature, merged by `loadMessages()` in `src/i18n/request.ts`.',
                suggestion: messages
                  ? `Add \`${m[1]}\` to \`client/messages/en/${ns}.json\`.`
                  : `Create \`client/messages/en/${ns}.json\`.`,
              }),
            );
          }
        }
      }
    }

    // TESTING.md — a DB-backed test must use the `*.it.test.ts` suffix.
    if (
      matches(p, 'server/test/**/*.test.ts') &&
      !matches(p, '**/*.it.test.ts') &&
      added.some(({ text }) => /helpers\/pg(\.js)?['"]/.test(text))
    ) {
      const at = added.find(({ text }) => /helpers\/pg(\.js)?['"]/.test(text));
      out.push(
        finding({
          category: 'test',
          title: 'DB-backed test without the `.it.test.ts` suffix',
          file: p,
          start_line: at.line,
          end_line: at.line,
          rationale:
            'This test imports `server/test/helpers/pg`, so it needs Postgres. Without the `*.it.test.ts` ' +
            'suffix it lands in the unit CI lane, which has no Docker, and fails there (`TESTING.md`).',
          suggestion: `Rename to \`${path.basename(p).replace(/\.test\.ts$/, '.it.test.ts')}\`.`,
        }),
      );
    }

    // e2e/AGENTS.md — flows are deterministic; never the AI `chat` command.
    if (matches(p, 'e2e/specs/*.flow.json') && added.some(({ text }) => /"(?:command|cmd)"\s*:\s*"chat"/.test(text))) {
      const at = added.find(({ text }) => /"(?:command|cmd)"\s*:\s*"chat"/.test(text));
      out.push(
        finding({
          category: 'test',
          title: 'E2E flow uses the AI `chat` command',
          file: p,
          start_line: at.line,
          end_line: at.line,
          rationale:
            'Flows are deterministic data: only `--url`, `--text` and `find` are allowed. The AI `chat` ' +
            'command makes the run non-reproducible (`e2e/AGENTS.md`).',
          suggestion: 'Replace it with a deterministic `wait --text` / `wait --url` assertion.',
        }),
      );
    }
  }

  // Root AGENTS.md — CLAUDE.md is a symlink to AGENTS.md, checked via the index
  // mode so it holds on Windows without core.symlinks.
  for (const p of paths) {
    if (path.basename(p) !== 'CLAUDE.md') continue;
    const ls = git(['ls-files', '-s', '--', p], { cwd: root, allowFail: true });
    const mode = ls?.trim().split(/\s+/)[0];
    if (mode && mode !== '120000') {
      out.push(
        finding({
          category: 'bug',
          title: '`CLAUDE.md` is no longer a symlink',
          file: p,
          start_line: 1,
          end_line: 1,
          rationale:
            `Recorded in the index with mode ${mode}, not \`120000\`. \`CLAUDE.md\` must stay a symlink to ` +
            '`AGENTS.md` — two real files drift, and every non-Claude tool then reads stale instructions.',
          suggestion: 'Edit `AGENTS.md` and restore the symlink (`git config core.symlinks true` + Developer Mode).',
        }),
      );
    }
  }

  // server/AGENTS.md — migrations do not run on boot, and a schema edit without a
  // generated migration surfaces as `relation ... does not exist` at runtime.
  const migrationAdded = scope.files.some(
    (f) =>
      (f.status === 'added' || f.status === 'untracked') && matches(f.path, 'server/src/db/migrations/*.sql'),
  );
  if (!migrationAdded) {
    for (const f of scope.files) {
      if (!matches(f.path, 'server/src/db/schema/**/*.ts') && f.path !== 'server/src/db/schema.ts') continue;
      if (f.status === 'deleted' || f.binary) continue;
      const at = addedOf(f.path).find(({ text }) => DDL_SIGNAL.test(text));
      if (!at) continue;
      out.push(
        finding({
          category: 'bug',
          title: 'Schema changed without a migration',
          file: f.path,
          start_line: at.line,
          end_line: at.line,
          rationale:
            'This edit changes the Drizzle schema, but no new `server/src/db/migrations/*.sql` is in the ' +
            'change set. Migrations are **not** applied on boot — the running database keeps the old shape ' +
            'and the first query fails with `relation ... does not exist` (`server/AGENTS.md`).',
          suggestion: 'Run `cd server && pnpm db:generate`, then commit the generated migration.',
        }),
      );
      break;
    }
  }

  // reviewer-core/AGENTS.md — the server consumes this package's TypeScript
  // source through a path alias. There is no build step in between to fail.
  const API = 'reviewer-core/src/index.ts';
  if (paths.has(API)) {
    const before = baseText(root, scope.base, API);
    const after = fileText(root, API);
    if (before && after) {
      const removed = [...exportedNames(before)].filter((n) => !exportedNames(after).has(n));
      if (removed.length) {
        const f = scope.files.find((x) => x.path === API);
        out.push(
          finding({
            category: 'bug',
            title: `Public API export removed: ${removed.join(', ')}`,
            file: API,
            start_line: firstLine(f),
            end_line: firstLine(f),
            rationale:
              `\`${removed.join('`, `')}\` no longer leaves \`src/index.ts\`, which is the package's only ` +
              'public API. The server and the CI runner import the TypeScript source through a tsconfig path ' +
              'alias, so this breaks them immediately with no build step to catch it.',
            suggestion: 'Re-export it, or update every consumer in the same change.',
          }),
        );
      }
    }
  }

  // server/AGENTS.md — a new external dependency is an adapter PLUS a getter in
  // the container; without it, tests can't mock it and start hitting the network.
  const CONTAINER = 'server/src/platform/container.ts';
  if (!paths.has(CONTAINER)) {
    for (const f of scope.files) {
      if (f.status !== 'added' && f.status !== 'untracked') continue;
      if (!matches(f.path, 'server/src/adapters/*/index.ts')) continue;
      out.push(
        finding({
          severity: 'WARNING',
          category: 'test',
          title: 'New adapter without a container getter',
          file: f.path,
          start_line: firstLine(f),
          end_line: firstLine(f),
          rationale:
            'A new external dependency is an adapter **plus** a getter in `platform/container.ts` ' +
            '(`server/AGENTS.md`). Without the getter it cannot be swapped through `ContainerOverrides`, ' +
            'so every test that reaches this code path hits the real network.',
          suggestion: `Add a getter for it in \`${CONTAINER}\` and a mock in \`server/src/adapters/mocks.ts\`.`,
        }),
      );
    }
  }

  // server/AGENTS.md — a new module is a plugin plus ONE line in modules/index.ts.
  const newModules = scope.files.filter(
    (f) => (f.status === 'added' || f.status === 'untracked') && matches(f.path, 'server/src/modules/*/index.ts'),
  );
  if (newModules.length && !paths.has('server/src/modules/index.ts')) {
    for (const f of newModules) {
      out.push(
        finding({
          severity: 'WARNING',
          category: 'bug',
          title: 'New module never registered',
          file: f.path,
          start_line: firstLine(f),
          end_line: firstLine(f),
          rationale:
            'There is no autoload: a new module is a plugin **plus one line** in `server/src/modules/index.ts` ' +
            '(`server/AGENTS.md`). Unregistered, its routes simply never exist.',
          suggestion: 'Register the plugin in `server/src/modules/index.ts`.',
        }),
      );
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// grounding — the citation gate, ported from reviewer-core/src/grounding.ts
// ---------------------------------------------------------------------------

/**
 * Full-file scanners aren't tied to a hunk: they ground against the file being
 * in the change set at all. Same set as reviewer-core.
 */
const FULL_FILE_KINDS = new Set(['secret_leak', 'lethal_trifecta', 'phantom', 'hook']);

export function inRanges(ranges, start, end) {
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return ranges.some(([a, b]) => lo <= b && hi >= a);
}

/**
 * Keep a finding only if its line range intersects a real changed range in the
 * same file. This is a blocking decision, so it is made here rather than by the
 * model that produced the findings — the same reason reviewer-core ignores the
 * model's self-reported score.
 */
export function groundFindings(findings, scope) {
  const byPath = new Map(scope.files.map((f) => [f.path, f]));
  const kept = [];
  const dropped = [];

  for (const f of findings) {
    const file = byPath.get(f.file);
    if (!file) {
      dropped.push({ finding: f, reason: `file '${f.file}' not present in the change set` });
      continue;
    }
    if (f.kind && FULL_FILE_KINDS.has(f.kind)) {
      kept.push(f);
      continue;
    }
    const start = Number(f.start_line);
    const end = Number(f.end_line ?? f.start_line);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      dropped.push({ finding: f, reason: 'missing or non-numeric line range' });
      continue;
    }
    if (inRanges(file.changed_lines, start, end)) kept.push(f);
    else
      dropped.push({
        finding: f,
        reason: `lines ${start}-${end} intersect no changed range in '${f.file}'`,
      });
  }
  return { kept, dropped };
}

/**
 * The severity vocabulary, in one place. `SEV_RANK` and `SEVERITY_PENALTY` below
 * are pure lookups derived from it — adding a row to either must never be what
 * decides whether the gate accepts a new severity.
 */
export const SEVERITIES = ['CRITICAL', 'WARNING', 'SUGGESTION'];

/** Same file, overlapping range, same category → one finding, worst severity wins. */
const SEV_RANK = { SUGGESTION: 1, WARNING: 2, CRITICAL: 3 };

export function dedupe(findings) {
  const out = [];
  for (const f of findings) {
    const hit = out.find(
      (g) =>
        g.file === f.file &&
        g.category === f.category &&
        inRanges([[g.start_line, g.end_line ?? g.start_line]], f.start_line, f.end_line ?? f.start_line),
    );
    if (!hit) {
      out.push({ ...f });
      continue;
    }
    if ((SEV_RANK[f.severity] ?? 0) > (SEV_RANK[hit.severity] ?? 0)) {
      hit.severity = f.severity;
      hit.title = f.title;
      hit.rationale = f.rationale;
      hit.suggestion = f.suggestion ?? hit.suggestion;
    }
    hit.merged = (hit.merged ?? 1) + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// dismissals — the release valve
// ---------------------------------------------------------------------------

/**
 * A gate with no way to say "this one is wrong" gets bypassed wholesale the
 * first time it is wrong, and then it protects nothing. Dismissals are the
 * narrow alternative: per-finding, reason mandatory, tracked in git so the PR
 * reviewer sees what was silenced, and echoed in every run so they never rot
 * quietly.
 *
 * A dismissal with no reason is not applied — the requirement is mechanical,
 * not a convention people remember.
 */
function loadDismissals(root) {
  const raw = fileText(root, DISMISSED_REL);
  if (!raw) return { entries: [], malformed: [] };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { entries: [], malformed: [{ reason: `dismissed.json is not valid JSON: ${e.message}` }] };
  }
  const all = Array.isArray(parsed) ? parsed : (parsed.dismissals ?? []);
  const entries = [];
  const malformed = [];
  for (const d of all) {
    if (!d?.file || !d?.title) malformed.push({ entry: d, reason: 'needs both `file` and `title`' });
    else if (!String(d.reason ?? '').trim()) malformed.push({ entry: d, reason: '`reason` is required and must be non-empty' });
    else entries.push(d);
  }
  return { entries, malformed };
}

/** `title: "*"` dismisses every finding of that category in the file. */
function matchDismissal(finding, d) {
  if (d.file !== finding.file) return false;
  if (d.category && d.category !== finding.category) return false;
  return d.title === '*' || d.title === finding.title;
}

const SEVERITY_PENALTY = { SUGGESTION: 97, WARNING: 88, CRITICAL: 65 };

/**
 * Coerce a model-supplied severity into the three the contract allows.
 *
 * The whole design says the model produces findings and the script decides what
 * they mean — so the deciding step must not trust the string it was handed. An
 * unrecognised severity used to fall through into its own bucket, leaving
 * `counts.CRITICAL` at zero and turning a blocking finding into `verdict:
 * comment`: a false ALLOW, the dangerous direction.
 *
 * Case is fixed first (SKILL.md's own report template prints severities
 * lowercase, so that drift is expected). Anything still unknown becomes WARNING
 * — visible and non-blocking. Coercing up would let a garbage string block a PR,
 * which is how a gate earns a bypass.
 */
export function normalizeSeverity(raw) {
  const up = String(raw ?? '').trim().toUpperCase();
  if (SEVERITIES.includes(up)) return { severity: up, changed: up !== raw };
  return { severity: 'WARNING', changed: true, unknown: true };
}

export function normalizeFinding(f) {
  const { severity, changed, unknown } = normalizeSeverity(f.severity);
  if (!changed) return f;
  return {
    ...f,
    severity,
    severity_normalized: { from: f.severity ?? null, to: severity, ...(unknown ? { unknown: true } : {}) },
  };
}

/**
 * Verdict is deterministic from severities under `failOn: 'critical'` — the same
 * rule as `gateTriggered()` in reviewer-core/src/output/to-review.ts.
 */
export function summarize(kept) {
  // Fixed key set only: never let an incoming string introduce a bucket.
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0]));
  for (const f of kept) {
    if (f.severity in counts) counts[f.severity] += 1;
  }
  const worst = counts.CRITICAL ? 'CRITICAL' : counts.WARNING ? 'WARNING' : counts.SUGGESTION ? 'SUGGESTION' : null;
  return {
    counts,
    blockers: counts.CRITICAL,
    score: worst ? SEVERITY_PENALTY[worst] : 100,
    verdict: counts.CRITICAL ? 'request_changes' : kept.length ? 'comment' : 'approve',
  };
}

// ---------------------------------------------------------------------------
// hook
// ---------------------------------------------------------------------------

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

/** Silence is consent: no output, exit 0 → the tool call proceeds normally. */
function allow() {
  process.exit(0);
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function runHook() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    allow();
  }

  if (input?.tool_name !== 'Bash') allow();
  if (!isGuardedCommand(input?.tool_input?.command)) allow();
  if (process.env.PR_SELF_REVIEW_BYPASS === '1') allow();

  const root = repoRoot();
  const verdictPath = path.join(root, VERDICT_REL);

  if (!existsSync(verdictPath)) {
    deny(
      'PR Self Review has not run on these changes.\n' +
        'Run the `pr-self-review` skill (`/pr-self-review`) first, then retry.',
    );
  }

  // A verdict that exists but cannot be read is the `missing` case, not an
  // internal error — deny it. Letting this throw would hit the fail-open catch
  // in main() and allow the command with no review at all.
  let verdict;
  try {
    verdict = JSON.parse(readFileSync(verdictPath, 'utf8'));
  } catch (e) {
    deny(
      `The PR Self Review verdict is unreadable (${e.message}).\n` +
        'Re-run `/pr-self-review` to regenerate it, then retry.',
    );
  }
  if (!verdict || typeof verdict !== 'object' || typeof verdict.scope_hash !== 'string') {
    deny(
      'The PR Self Review verdict is malformed — no `scope_hash`.\n' +
        'Re-run `/pr-self-review` to regenerate it, then retry.',
    );
  }
  // Validate the field the block decision actually reads. Anything unrecognised
  // here used to fall through to allow() — the same "unknown means yes" pattern
  // the severity normalization exists to remove.
  if (!['approve', 'comment', 'request_changes'].includes(verdict.verdict)) {
    deny(
      `The PR Self Review verdict is malformed — unrecognised verdict '${verdict.verdict}'.\n` +
        'Re-run `/pr-self-review` to regenerate it, then retry.',
    );
  }

  // Same rule as the parse above, and the reason it must extend this far: the
  // fail-open catch in main() is for a BROKEN GATE, not for a question the gate
  // simply could not answer. computeScope() reads the hand-edited, git-tracked
  // lanes.json — a conflict marker or trailing comma in it must deny, not allow.
  let scope;
  try {
    scope = computeScope(root);
  } catch (e) {
    deny(
      `The PR Self Review gate cannot compute the change set (${e.message}).\n` +
        'Check `.claude/skills/pr-self-review/lanes.json` and the git state, then re-run `/pr-self-review`.',
    );
  }

  if (verdict.scope_hash !== scope.scope_hash) {
    deny(
      'The PR Self Review verdict is stale — the worktree changed since the last review.\n' +
        `Reviewed ${verdict.file_count ?? '?'} file(s) at ${verdict.generated_at ?? 'unknown time'}; ` +
        `the change set now hashes differently.\nRe-run \`/pr-self-review\`, then retry.`,
    );
  }

  if (verdict.verdict === 'request_changes') {
    const n = verdict.counts?.CRITICAL ?? verdict.blockers ?? 0;
    deny(
      `PR Self Review found ${n} CRITICAL finding(s) — merging these changes is blocked.\n` +
        'See `.claude/pr-self-review/report.md`. Fix the criticals and re-run `/pr-self-review`.\n' +
        'If a finding is a false positive, say so and re-run; to override entirely, set PR_SELF_REVIEW_BYPASS=1.',
    );
  }

  allow();
}

// ---------------------------------------------------------------------------

function publicScope(scope) {
  const { _diff, _untracked, ...rest } = scope;
  return rest;
}

async function main() {
  const cmd = process.argv[2];

  if (cmd === 'hook') return runHook();

  const root = repoRoot();
  const scope = computeScope(root);

  if (cmd === 'scope') {
    process.stdout.write(JSON.stringify(publicScope(scope), null, 2));
    return;
  }
  if (cmd === 'guardrails') {
    process.stdout.write(JSON.stringify({ findings: computeGuardrails(root, scope) }, null, 2));
    return;
  }

  // Findings in on stdin (a bare array, or {findings: [...]}), verdict out. The
  // skill never computes the gate itself — it hands findings over and reports
  // what comes back.
  if (cmd === 'ground') {
    const raw = await readStdin();
    let input;
    try {
      input = JSON.parse(raw);
    } catch (e) {
      process.stderr.write(`ground: stdin is not valid JSON (${e.message})\n`);
      process.exit(2);
    }
    // Normalize before anything reads `severity` — grounding, dedupe and the
    // verdict all key off it.
    const incoming = (Array.isArray(input) ? input : (input.findings ?? [])).map(normalizeFinding);
    const withGuardrails = process.argv.includes('--no-guardrails')
      ? incoming
      : [...computeGuardrails(root, scope), ...incoming];

    const { kept, dropped } = groundFindings(withGuardrails, scope);
    const deduped = dedupe(kept).sort(
      (a, b) =>
        (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0) ||
        a.file.localeCompare(b.file) ||
        a.start_line - b.start_line,
    );

    const { entries, malformed } = loadDismissals(root);
    const active = [];
    const silenced = [];
    for (const f of deduped) {
      const d = entries.find((e) => matchDismissal(f, e));
      if (d) silenced.push({ ...f, dismissed_reason: d.reason, dismissed_at: d.dismissed_at ?? null });
      else active.push(f);
    }

    const verdict = {
      version: 1,
      generated_at: new Date().toISOString(),
      base: scope.base,
      head: scope.head,
      branch: scope.branch,
      scope_hash: scope.scope_hash,
      file_count: scope.file_count,
      lanes: scope.lanes.map((l) => l.id),
      ...summarize(active),
      grounding: {
        received: withGuardrails.length,
        kept: kept.length,
        dropped: dropped.length,
        deduped: kept.length - deduped.length,
        reasons: dropped.map((d) => ({
          file: d.finding.file,
          title: d.finding.title,
          severity: d.finding.severity,
          reason: d.reason,
        })),
      },
      // Never silent: every run reports what was suppressed and why, and
      // every dismissal that failed validation.
      dismissed: silenced,
      dismissals_malformed: malformed,
      findings: active,
    };

    // Write the file HERE rather than letting the caller redirect stdout into
    // it. `> verdict.json` truncates the target to zero bytes before this
    // process starts, so any non-zero exit — bad stdin, a git failure, a crash —
    // used to leave an unparseable verdict behind, which the hook then failed
    // open on. Writing it ourselves also means the directory exists on a fresh
    // clone, where the documented redirect used to fail outright.
    //
    // But ONLY for a real run. `--no-guardrails` strips every mechanical
    // finding while still stamping a matching scope_hash, so writing it would
    // hand the hook a fresh-looking verdict with the criticals removed — a
    // debugging flag that launders a change past the gate. Testing prints to
    // stdout and touches nothing.
    if (process.argv.includes('--no-guardrails')) {
      process.stderr.write('ground: --no-guardrails is a test mode; verdict.json was NOT written\n');
    } else {
      const out = path.join(root, VERDICT_REL);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(verdict, null, 2) + '\n');
    }
    process.stdout.write(JSON.stringify(verdict, null, 2));
    return;
  }

  // Record a dismissal. Exists so the reason requirement is enforced by the
  // tool rather than by whoever remembers to fill it in.
  if (cmd === 'dismiss') {
    const arg = (name) => {
      const i = process.argv.indexOf(`--${name}`);
      return i === -1 ? null : process.argv[i + 1];
    };
    const file = arg('file');
    const title = arg('title');
    const reason = arg('reason');
    const category = arg('category');

    if (!file || !title || !String(reason ?? '').trim()) {
      process.stderr.write(
        'usage: dismiss --file <path> --title <finding title|*> --reason <why> [--category <cat>]\n' +
          'A reason is required: a dismissal nobody can justify later is indistinguishable from a bypass.\n',
      );
      process.exit(2);
    }
    if (!scope.files.some((f) => f.path === file)) {
      process.stderr.write(`dismiss: '${file}' is not in the current change set\n`);
      process.exit(2);
    }

    const p = path.join(root, DISMISSED_REL);
    let doc = { version: 1, dismissals: [] };
    const existing = fileText(root, DISMISSED_REL);
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        doc = Array.isArray(parsed) ? { version: 1, dismissals: parsed } : parsed;
        doc.dismissals ??= [];
      } catch {
        process.stderr.write(`dismiss: ${DISMISSED_REL} exists but is not valid JSON — fix it first\n`);
        process.exit(2);
      }
    }
    doc.dismissals = doc.dismissals.filter((d) => !(d.file === file && d.title === title));
    doc.dismissals.push({
      file,
      title,
      ...(category ? { category } : {}),
      reason: String(reason).trim(),
      dismissed_at: new Date().toISOString(),
      dismissed_against: scope.scope_hash,
    });

    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(doc, null, 2) + '\n');
    process.stdout.write(`dismissed: ${file} — ${title}\nrecorded in ${DISMISSED_REL} (commit it with the change)\n`);
    return;
  }

  process.stderr.write('usage: pr-self-review-gate.mjs <scope|guardrails|ground|dismiss|hook>\n');
  process.exit(2);
}

/**
 * Is this process running the module as a CLI, rather than importing it?
 *
 * `process.argv[1]` is the path as invoked; `import.meta.url` is the realpath
 * Node resolved. Comparing them raw meant that reaching the script through a
 * symlink, a Windows junction, or a differently-cased drive letter made them
 * disagree — `main()` never ran, the hook printed nothing, exited 0, and silence
 * is ALLOW. So: resolve both to a realpath, and compare case-insensitively on
 * Windows.
 */
export function isEntrypoint(argv1, moduleUrl) {
  if (!argv1) return false;
  const norm = (p) => {
    let out = path.resolve(p);
    try {
      out = realpathSync(out);
    } catch {
      // Not on disk (or unreadable) — the resolved path is the best we have.
    }
    return process.platform === 'win32' ? out.toLowerCase() : out;
  };
  try {
    return norm(argv1) === norm(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

/**
 * Is this process meant to run the gate, rather than import a helper from it?
 *
 * `isEntrypoint` is the real answer. The second clause is a backstop for the one
 * failure that must never happen: a `hook` invocation where the entrypoint check
 * says no, so nothing prints and exit 0 reads as ALLOW. It also requires the
 * basename to match — keying off `argv[2]` alone meant any sibling CLI that
 * imported a helper and happened to be run as `node wrapper.mjs hook` executed
 * `main()` inside itself, draining that process's stdin and calling `exit(0)`.
 */
function shouldRunAsCli() {
  if (isEntrypoint(process.argv[1], import.meta.url)) return true;
  if (process.argv[2] !== 'hook') return false;
  try {
    return path.basename(process.argv[1] ?? '') === path.basename(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Only run as a CLI. The pure helpers above are exported so
// `pr-self-review-gate.test.mjs` can pin them without spawning a process.
if (shouldRunAsCli())
  main().catch((err) => {
  // Fail OPEN. A broken gate must never brick the Bash tool — it fails closed
  // only on the three real answers above (missing / stale / blocked verdict).
  if (process.argv[2] === 'hook') process.exit(0);
  process.stderr.write(`pr-self-review-gate: ${err?.message ?? err}\n`);
  process.exit(1);
});
