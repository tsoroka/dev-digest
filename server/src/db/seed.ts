import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import type { RunTrace } from '@devdigest/shared';
import {
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
} from './seed-prompts.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, the three built-in agents (General + Security +
 * Performance) on the default openrouter/deepseek-v4-flash provider+model, and
 * three demo agent runs (+ their traces) so the run-cost surfaces have data
 * without anyone spending a token — one of them deliberately unpriced.
 *
 * Course lessons populate the other tables (skills, conventions, memory, eval,
 * …) once their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  let [ws] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  if (!ws) {
    [ws] = await db
      .insert(t.workspaces)
      .values({ name: DEFAULT_WORKSPACE_NAME })
      .returning();
  }
  const workspaceId = ws!.id;

  let [user] = await db.select().from(t.users).where(eq(t.users.email, SYSTEM_USER_EMAIL));
  if (!user) {
    [user] = await db
      .insert(t.users)
      .values({ email: SYSTEM_USER_EMAIL, name: 'You' })
      .returning();
  }
  const userId = user!.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  let [repo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  if (!repo) {
    [repo] = await db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api',
        defaultBranch: 'main',
        clonePath: null,
        createdBy: userId,
      })
      .returning();
  }
  const repoId = repo!.id;

  // ---- PR #482 (rate limiting) ----
  let [pr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  if (!pr) {
    [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit-public',
        base: 'main',
        headSha: 'a1b2c3d4e5f6',
        additions: 247,
        deletions: 38,
        filesCount: 9,
        status: 'needs_review',
        body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
      })
      .returning();

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId: pr!.id, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId: pr!.id, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId: pr!.id, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId: pr!.id, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId: pr!.id,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr!.id,
        kind: 'review',
        verdict: 'request_changes',
        summary:
          'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
        score: 61,
        model: 'seed',
      })
      .returning();

    await db.insert(t.findings).values([
      {
        reviewId: review!.id,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId: review!.id,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
    ]);
  }

  // ---- built-in agents (the three starter presets) ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // ---- demo agent runs for PR #482 (L01 run-cost badge) ----
  // Lives here, not in the `if (!pr)` block above, because runs need the agent
  // ids seeded just above. Guarded on "this PR has NO runs at all" so re-seeding
  // is a no-op and a real run you triggered locally is never clobbered.
  const existingRuns = await db.select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr!.id));
  if (existingRuns.length === 0) {
    const agentRows = await db
      .select()
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId));
    const agentByName = new Map(agentRows.map((a) => [a.name, a]));

    // ranAt is explicit and staggered so the newest-first timeline order — and
    // therefore the e2e flow's "first run row" — is deterministic.
    const newest = Date.UTC(2026, 5, 1, 9, 14, 2); // 2026-06-01 09:14:02Z
    const demoRuns: Array<{
      agent: string;
      model: string;
      durationMs: number;
      tokensIn: number;
      tokensOut: number;
      /** null = the model had no price; the run stores NULL and renders "—". */
      costUsd: number | null;
      score: number;
      findings: number;
      blockers: number;
      grounding: string;
      minutesAgo: number;
    }> = [
      {
        agent: 'Security Reviewer',
        model: DEFAULT_MODEL,
        durationMs: 8200,
        tokensIn: 8200,
        tokensOut: 919,
        costUsd: 0.0013,
        score: 61,
        findings: 2,
        blockers: 1,
        grounding: '2/2 passed',
        minutesAgo: 0,
      },
      {
        agent: 'General Reviewer',
        model: DEFAULT_MODEL,
        durationMs: 11400,
        tokensIn: 11000,
        tokensOut: 1500,
        costUsd: 0.0127,
        score: 78,
        findings: 1,
        blockers: 0,
        grounding: '1/1 passed',
        minutesAgo: 37,
      },
      {
        // Unpriced model: neither OpenRouter's usage.cost nor the static PRICING
        // table knows it, so the run stores NULL. Demonstrates the "—" state and
        // proves null is SKIPPED by the PR total rather than counted as 0.
        agent: 'Performance Reviewer',
        model: 'qwen/qwen3-next-80b',
        durationMs: 3900,
        tokensIn: 3900,
        tokensOut: 400,
        costUsd: null,
        score: 88,
        findings: 0,
        blockers: 0,
        grounding: '0/0 passed',
        minutesAgo: 73,
      },
    ];

    for (const d of demoRuns) {
      const agent = agentByName.get(d.agent);
      if (!agent) continue;
      const [run] = await db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          agentId: agent.id,
          prId: pr!.id,
          ranAt: new Date(newest - d.minutesAgo * 60_000),
          provider: agent.provider,
          model: d.model,
          durationMs: d.durationMs,
          tokensIn: d.tokensIn,
          tokensOut: d.tokensOut,
          costUsd: d.costUsd,
          status: 'done',
          source: 'local',
          findingsCount: d.findings,
          grounding: d.grounding,
          score: d.score,
          blockers: d.blockers,
        })
        .returning();

      const trace: RunTrace = {
        config: {
          agent: agent.name,
          version: String(agent.version),
          provider: agent.provider,
          model: d.model,
          pr: 482,
          source: 'local',
        },
        stats: {
          duration_ms: d.durationMs,
          tokens_in: d.tokensIn,
          tokens_out: d.tokensOut,
          cost_usd: d.costUsd,
          findings: d.findings,
          grounding: d.grounding,
        },
        prompt_assembly: {
          system: agent.systemPrompt,
          user: 'Review the diff of PR #482 (rate limiting on public API endpoints).',
        },
        tool_calls: [],
        raw_output: '{}',
        memory_pulled: [],
        specs_read: [],
        log: [
          { t: '00.00', kind: 'info', msg: `${agent.name} started` },
          { t: '00.01', kind: 'result', msg: `Run complete — ${d.findings} finding(s)` },
        ],
      };
      await db.insert(t.runTraces).values({ runId: run!.id, trace });

      // Link the seeded review to the newest run so "jump to this run's
      // findings" resolves on the timeline (the review's score is 61, which is
      // why the Security run carries the same score).
      if (d.agent === 'Security Reviewer') {
        await db
          .update(t.reviews)
          .set({ runId: run!.id, agentId: agent.id })
          .where(and(eq(t.reviews.prId, pr!.id), eq(t.reviews.kind, 'review')));
      }
    }
  }

  return { workspaceId, userId };
}

// CLI entrypoint — pathToFileURL, not `file://${argv[1]}`: on win32 argv[1] is a
// backslashed drive path, so the naive template never matches and `pnpm db:seed`
// silently no-ops (exit 0, nothing seeded).
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
