/**
 * PRRow — the COST cell (L01) and the grid/column invariant it depends on.
 *
 * The list is a CSS grid, not a <table>: GRID and COLUMN_KEYS are two halves of
 * one column definition and silently misalign every row if they drift apart.
 * That's cheap to guard and expensive to notice by eye, hence the last test.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import { COLUMN_KEYS, GRID } from "../../constants";
import { PRRow } from "./PRRow";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(cleanup);

function pull(o: Partial<PrMeta>): PrMeta {
  return {
    id: "pr-1",
    number: 482,
    title: "Add rate limiting to public API endpoints",
    author: "marisa.koch",
    branch: "feat/rate-limit-public",
    base: "main",
    head_sha: "a1b2c3d4e5f6",
    additions: 247,
    deletions: 38,
    files_count: 9,
    status: "needs_review",
    opened_at: "2026-06-01T06:00:00.000Z",
    updated_at: "2026-06-01T09:00:00.000Z",
    score: 61,
    total_cost_usd: null,
    ...o,
  };
}

function renderRow(pr: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={pr} repoId="repo-1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — cost cell", () => {
  it("shows the PR's total run cost", () => {
    renderRow(pull({ total_cost_usd: 0.014 }));
    expect(screen.getByText("$0.014")).toBeInTheDocument();
  });

  it("shows a dash — not $0.00 — when no run of this PR was priced", () => {
    renderRow(pull({ total_cost_usd: null }));
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("still shows $0.00 for a PR whose runs were genuinely free", () => {
    renderRow(pull({ total_cost_usd: 0 }));
    expect(screen.getByText("$0.00")).toBeInTheDocument();
  });
});

describe("PR list column definition", () => {
  it("GRID has exactly one track per column key", () => {
    expect(GRID.trim().split(/\s+/)).toHaveLength(COLUMN_KEYS.length);
  });

  it("keeps `updated` last — the header right-aligns the final column by index", () => {
    expect(COLUMN_KEYS[COLUMN_KEYS.length - 1]).toBe("updated");
  });
});
