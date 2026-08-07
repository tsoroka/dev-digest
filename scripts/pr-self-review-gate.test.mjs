/**
 * Tests for the pre-PR gate's pure helpers.
 *
 * Run: `node --test scripts/`  (Node >= 22 — no runner, no new package; the repo
 * is deliberately not a workspace and `scripts/` should not become a fifth one.)
 *
 * Why this file exists: every defect found reviewing this gate was a pure-function
 * behaviour, and one round of fixes introduced two new fail-opens that the next
 * round caught by hand. Those cases are pinned here so the third round doesn't
 * have to. Cases marked REGRESSION are bugs that shipped and were fixed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SEVERITIES,
  dedupe,
  expandBraces,
  globToRegex,
  groundFindings,
  isGuardedCommand,
  matches,
  normalizeSeverity,
  parseUnifiedDiff,
  shellLiveText,
  summarize,
} from './pr-self-review-gate.mjs';

// ---------------------------------------------------------------------------

describe('isGuardedCommand', () => {
  const gh = 'gh' + ' pr '; // never a literal, or this file gates itself

  it('catches the plain invocation and its subcommands', () => {
    for (const sub of ['create', 'ready', 'merge']) {
      assert.equal(isGuardedCommand(`${gh}${sub}`), true, sub);
    }
    assert.equal(isGuardedCommand(`${gh}create --fill --base main`), true);
  });

  it('leaves unrelated commands alone', () => {
    for (const cmd of ['git status', 'gh pr list', 'gh pr view 3', 'gh repo clone x', '']) {
      assert.equal(isGuardedCommand(cmd), false, cmd);
    }
  });

  it('catches it at every command position', () => {
    const cases = [
      `git push && ${gh}create`,
      `git push; ${gh}create`,
      `false || ${gh}create`,
      `( ${gh}create )`,
      `{ ${gh}create; }`,
      `if [ -f x ]; then ${gh}create; fi`, // REGRESSION
      `for b in x; do ${gh}create; done`, // REGRESSION
      `time ${gh}create`, // REGRESSION
      `eval ${gh}create`, // REGRESSION
      `xargs ${gh}create`, // REGRESSION
      `FOO=1 ${gh}create`,
      `git push\n${gh}create`,
    ];
    for (const cmd of cases) assert.equal(isGuardedCommand(cmd), true, cmd);
  });

  it('does not fire on a mention rather than an invocation', () => {
    const cases = [
      `echo "${gh}create"`,
      `echo '${gh}create'`,
      `echo "cd x && ${gh}create"`, // REGRESSION: the quoted && was read as a boundary
      `git commit -m "prep for ${gh}create"`,
      `cat <<'EOF'\n${gh}create\nEOF`, // REGRESSION: heredoc body is data
      `cat <<EOF\n${gh}create\nEOF`,
    ];
    for (const cmd of cases) assert.equal(isGuardedCommand(cmd), false, cmd);
  });

  it('still fires when a shell is handed the string to execute', () => {
    // The hard case: `echo "..."` and `bash -c "..."` both quote the command.
    // What separates them is whether a shell runs it.
    for (const cmd of [`bash -c "${gh}create"`, `sh -lc '${gh}create'`, `\`${gh}create\``]) {
      assert.equal(isGuardedCommand(cmd), true, cmd);
    }
  });

  it('handles junk input without throwing', () => {
    for (const v of [null, undefined, 42, '"unterminated', "'", '`', '\\']) {
      assert.doesNotThrow(() => isGuardedCommand(v));
    }
  });
});

describe('shellLiveText', () => {
  it('blanks quoted text but keeps structure', () => {
    assert.match(shellLiveText('echo "hi" && ls'), /&&\s*ls$/);
  });
  it('drops only the heredoc body, not the command that opened it', () => {
    assert.match(shellLiveText("cat <<'EOF'\nbody\nEOF"), /cat/);
    assert.doesNotMatch(shellLiveText("cat <<'EOF'\nbody\nEOF"), /body/);
  });
});

// ---------------------------------------------------------------------------

describe('parseUnifiedDiff', () => {
  it('reads new-side ranges and added lines', () => {
    const files = parseUnifiedDiff(
      ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,0 +2,2 @@', '+one', '+two'].join('\n'),
    );
    const f = files.get('a.ts');
    assert.deepEqual(f.ranges, [[2, 3]]);
    assert.deepEqual(
      f.added.map((a) => [a.line, a.text]),
      [
        [2, 'one'],
        [3, 'two'],
      ],
    );
  });

  it('REGRESSION: an added line starting with `++ ` is content, not a header', () => {
    // Rendered by git as `+++ b/evil.ts`. It used to be parsed as a file header,
    // redirecting every later hunk to a phantom path and silently losing them.
    const files = parseUnifiedDiff(
      [
        'diff --git a/doc.md b/doc.md',
        '--- a/doc.md',
        '+++ b/doc.md',
        '@@ -1,0 +2,1 @@',
        '+normal',
        '@@ -3,0 +4,1 @@',
        '+++ b/evil.ts',
        '@@ -7,0 +8,1 @@',
        '+last',
      ].join('\n'),
    );
    assert.deepEqual([...files.keys()], ['doc.md']);
    assert.deepEqual(files.get('doc.md').ranges, [
      [2, 2],
      [4, 4],
      [8, 8],
    ]);
  });

  it('REGRESSION: binary files are detected', () => {
    // git emits no ---/+++ pair for a binary, so keying off `+++` left the flag
    // permanently false and binaries were dispatched to lanes as text.
    const files = parseUnifiedDiff(
      [
        'diff --git a/img.png b/img.png',
        'new file mode 100644',
        'Binary files /dev/null and b/img.png differ',
      ].join('\n'),
    );
    assert.equal(files.get('img.png').binary, true);
  });

  it('ignores the no-newline marker', () => {
    const files = parseUnifiedDiff(
      ['diff --git a/a.ts b/a.ts', '+++ b/a.ts', '@@ -1,0 +1,1 @@', '+x', '\\ No newline at end of file'].join('\n'),
    );
    assert.equal(files.get('a.ts').added.length, 1);
  });

  it('survives an empty diff', () => {
    assert.equal(parseUnifiedDiff('').size, 0);
  });
});

// ---------------------------------------------------------------------------

describe('globs', () => {
  it('expands braces, including nested ones', () => {
    assert.deepEqual(expandBraces('a.{ts,tsx}'), ['a.ts', 'a.tsx']);
    assert.deepEqual(expandBraces('{a,b}.{ts,js}'), ['a.ts', 'a.js', 'b.ts', 'b.js']);
    assert.deepEqual(expandBraces('plain'), ['plain']);
  });

  it('treats `/` as a hard boundary for a single `*`', () => {
    assert.equal(globToRegex('src/*.ts').test('src/a.ts'), true);
    assert.equal(globToRegex('src/*.ts').test('src/deep/a.ts'), false);
  });

  it('matches `**` across directories, including zero', () => {
    assert.equal(matches('client/src/app/page.tsx', 'client/src/**'), true);
    assert.equal(matches('a/b/c/d.ts', '**/*.ts'), true);
    assert.equal(matches('d.ts', '**/*.ts'), true);
    assert.equal(matches('server/src/vendor/shared/x.ts', '*/src/vendor/**'), true);
    assert.equal(matches('server/src/db/schema/x.ts', 'server/src/db/**'), true);
    assert.equal(matches('server/src/modules/x.ts', 'server/src/db/**'), false);
  });

  it('escapes regex metacharacters in literal segments', () => {
    assert.equal(matches('a.b.ts', 'a.b.ts'), true);
    assert.equal(matches('axbyts', 'a.b.ts'), false);
  });

  it('keeps the docs-lane exclusion narrow', () => {
    // `.claude/skills/*/**` must exclude vendored per-skill content but NOT the
    // catalog README, which is ours.
    assert.equal(matches('.claude/skills/zod/references/x.md', '.claude/skills/*/**'), true);
    assert.equal(matches('.claude/skills/README.md', '.claude/skills/*/**'), false);
  });
});

// ---------------------------------------------------------------------------

describe('normalizeSeverity', () => {
  it('accepts the three the contract allows', () => {
    for (const s of SEVERITIES) {
      assert.deepEqual(normalizeSeverity(s), { severity: s, changed: false });
    }
  });

  it('REGRESSION: fixes case rather than inventing a bucket', () => {
    // `critical` used to create its own key, leaving counts.CRITICAL at 0 and
    // turning a blocking finding into verdict `comment` — a false ALLOW.
    assert.equal(normalizeSeverity('critical').severity, 'CRITICAL');
    assert.equal(normalizeSeverity(' Critical ').severity, 'CRITICAL');
  });

  it('coerces the unknown DOWN, never up', () => {
    // Up would let a garbage string block a PR, which is how a gate earns a bypass.
    for (const v of ['blocker', 'INFO', 'high', '', null, undefined, 7, {}]) {
      const r = normalizeSeverity(v);
      assert.equal(r.severity, 'WARNING');
      assert.equal(r.unknown, true);
    }
  });
});

describe('summarize', () => {
  const f = (severity) => ({ severity, file: 'a', start_line: 1, end_line: 1, category: 'bug' });

  it('is deterministic from severities under failOn: critical', () => {
    assert.deepEqual(summarize([]), {
      counts: { CRITICAL: 0, WARNING: 0, SUGGESTION: 0 },
      blockers: 0,
      score: 100,
      verdict: 'approve',
    });
    assert.equal(summarize([f('SUGGESTION')]).verdict, 'comment');
    assert.equal(summarize([f('SUGGESTION')]).score, 97);
    assert.equal(summarize([f('WARNING')]).score, 88);
    assert.equal(summarize([f('CRITICAL')]).verdict, 'request_changes');
    assert.equal(summarize([f('CRITICAL')]).score, 65);
  });

  it('worst severity wins the score', () => {
    assert.equal(summarize([f('SUGGESTION'), f('CRITICAL'), f('WARNING')]).score, 65);
  });

  it('REGRESSION: an unexpected severity never introduces a count bucket', () => {
    const s = summarize([f('critical'), f('nonsense')]);
    assert.deepEqual(Object.keys(s.counts).sort(), [...SEVERITIES].sort());
  });
});

// ---------------------------------------------------------------------------

describe('groundFindings', () => {
  const scope = {
    files: [
      { path: 'a.ts', changed_lines: [[10, 12], [20, 20]] },
      { path: 'b.ts', changed_lines: [] },
    ],
  };
  const f = (over) => ({ file: 'a.ts', start_line: 10, end_line: 10, severity: 'WARNING', category: 'bug', ...over });

  it('keeps a finding that intersects a changed range', () => {
    assert.equal(groundFindings([f()], scope).kept.length, 1);
    assert.equal(groundFindings([f({ start_line: 5, end_line: 11 })], scope).kept.length, 1);
    assert.equal(groundFindings([f({ start_line: 20, end_line: 20 })], scope).kept.length, 1);
  });

  it('drops a finding on a line nobody changed', () => {
    const r = groundFindings([f({ start_line: 15, end_line: 16 })], scope);
    assert.equal(r.kept.length, 0);
    assert.match(r.dropped[0].reason, /intersect no changed range/);
  });

  it('drops a finding on a file outside the change set', () => {
    const r = groundFindings([f({ file: 'nope.ts' })], scope);
    assert.equal(r.kept.length, 0);
    assert.match(r.dropped[0].reason, /not present in the change set/);
  });

  it('drops a non-numeric range instead of trusting it', () => {
    assert.equal(groundFindings([f({ start_line: 'oops', end_line: null })], scope).kept.length, 0);
  });

  it('exempts full-file kinds from the hunk check', () => {
    assert.equal(groundFindings([f({ kind: 'secret_leak', start_line: 999, end_line: 999 })], scope).kept.length, 1);
    // ...but still requires the file to be in the change set.
    assert.equal(
      groundFindings([f({ kind: 'secret_leak', file: 'nope.ts', start_line: 1, end_line: 1 })], scope).kept.length,
      0,
    );
  });
});

describe('dedupe', () => {
  const f = (over) => ({ file: 'a.ts', start_line: 10, end_line: 12, severity: 'WARNING', category: 'bug', title: 't', ...over });

  it('merges an overlapping same-category finding, worst severity winning', () => {
    const out = dedupe([f(), f({ start_line: 11, end_line: 11, severity: 'CRITICAL', title: 'worse' })]);
    assert.equal(out.length, 1);
    assert.equal(out[0].severity, 'CRITICAL');
    assert.equal(out[0].merged, 2);
  });

  it('keeps findings apart when category or range differs', () => {
    assert.equal(dedupe([f(), f({ category: 'security' })]).length, 2);
    assert.equal(dedupe([f(), f({ start_line: 90, end_line: 90 })]).length, 2);
    assert.equal(dedupe([f(), f({ file: 'b.ts' })]).length, 2);
  });
});
