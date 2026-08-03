/**
 * PR-list run cost (L01) — GET /repos/:id/pulls returns `total_cost_usd`, the
 * SUM of `agent_runs.cost_usd` over EVERY run of that PR.
 *
 * The load-bearing case is null vs 0: a PR whose runs were all unpriced must
 * come back `null` (the UI renders "—"), not `0`. A JS reduce seeded with 0 —
 * the obvious implementation — gets that wrong, so it is asserted directly.
 *
 * Gated on Docker (needs Postgres to hold runs + PRs), like the other
 * integration tests. Serves persisted rows: no GitHub override is passed, so
 * the route takes its documented offline path.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import type { PrMeta } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let seq = 0;

d('PR list total_cost_usd (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /** A fresh repo with `count` PRs, isolated from the seeded acme/payments-api. */
  async function setupRepo(count: number) {
    const name = `cost-${seq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const prs = [];
    for (let i = 0; i < count; i++) {
      const [pr] = await pg.handle.db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId: repo!.id,
          number: 100 + i,
          title: `PR ${100 + i}`,
          author: 'marisa.koch',
          branch: `feat/${i}`,
          base: 'main',
          headSha: `sha${i}`,
          additions: 1,
          deletions: 0,
          filesCount: 1,
          status: 'open',
        })
        .returning();
      prs.push(pr!);
    }
    return { repo: repo!, prs };
  }

  async function addRun(prId: string, costUsd: number | null) {
    await pg.handle.db.insert(t.agentRuns).values({
      workspaceId,
      prId,
      model: 'deepseek/deepseek-v4-flash',
      status: 'done',
      tokensIn: 100,
      tokensOut: 50,
      costUsd,
    });
  }

  async function listPulls(repoId: string): Promise<PrMeta[]> {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/pulls` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as PrMeta[];
    await app.close();
    return body;
  }

  it('sums every priced run and skips the unpriced ones', async () => {
    const { repo, prs } = await setupRepo(1);
    await addRun(prs[0]!.id, 0.0013);
    await addRun(prs[0]!.id, 0.0127);
    await addRun(prs[0]!.id, null);

    const [pr] = await listPulls(repo.id);
    expect(pr!.total_cost_usd).toBeCloseTo(0.014, 6);
  });

  it('returns null — NOT 0 — when every run of the PR was unpriced', async () => {
    const { repo, prs } = await setupRepo(1);
    await addRun(prs[0]!.id, null);
    await addRun(prs[0]!.id, null);

    const [pr] = await listPulls(repo.id);
    expect(pr!.total_cost_usd).toBeNull();
  });

  it('returns null for a PR that has never been reviewed', async () => {
    const { repo } = await setupRepo(1);
    const [pr] = await listPulls(repo.id);
    expect(pr!.total_cost_usd).toBeNull();
  });

  it('keeps costs of different PRs in the same list separate', async () => {
    const { repo, prs } = await setupRepo(2);
    await addRun(prs[0]!.id, 0.01);
    await addRun(prs[1]!.id, 0.002);
    await addRun(prs[1]!.id, 0.003);

    const body = await listPulls(repo.id);
    const byNumber = new Map(body.map((p) => [p.number, p.total_cost_usd]));
    expect(byNumber.get(100)).toBeCloseTo(0.01, 6);
    expect(byNumber.get(101)).toBeCloseTo(0.005, 6);
  });

  it('counts a genuinely free (priced at 0) run as 0, not as unpriced', async () => {
    const { repo, prs } = await setupRepo(1);
    await addRun(prs[0]!.id, 0);

    const [pr] = await listPulls(repo.id);
    expect(pr!.total_cost_usd).toBe(0);
  });
});
