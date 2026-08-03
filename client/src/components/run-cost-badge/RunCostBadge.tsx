/* RunCostBadge (L01) — the USD cost of agent work, in the two shapes the app
   needs it: a standalone cell in the PR list, and a trailing usage line on an
   Agent Runs timeline row. The trace drawer does NOT use this component — its
   Stat tile already owns the chrome and only reuses `formatCost`. */
"use client";

import React from "react";
import { Badge } from "@devdigest/ui";
import { formatCost, formatTokenCount } from "@/lib/format-cost";

export type RunCostVariant = "compact" | "inline";

export interface RunCostBadgeProps {
  /** USD. null/undefined = unpriced — rendered as "—", never $0.00. */
  costUsd: number | null | undefined;
  /** Total tokens of the run. Only read by the "inline" variant. */
  tokens?: number | null;
  variant?: RunCostVariant;
}

/**
 * `compact` — PR list cell: just the money ("$0.014"), or a muted em dash when
 * the PR has no priced run yet. The dash is deliberately NOT a badge: an empty
 * state shouldn't look like data.
 *
 * `inline` — timeline row: "9,119 tok · $0.0013". Renders nothing at all when
 * there is neither a token count nor a cost, which keeps failed and cancelled
 * rows clean.
 */
export function RunCostBadge({ costUsd, tokens, variant = "compact" }: RunCostBadgeProps) {
  if (variant === "inline") {
    const tok = tokens ?? 0;
    if (tok <= 0 && costUsd == null) return null;
    return (
      <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {formatTokenCount(tok)} tok
        {costUsd != null ? ` · ${formatCost(costUsd)}` : ""}
      </span>
    );
  }

  if (costUsd == null) return <span style={{ color: "var(--text-muted)" }}>—</span>;
  return (
    <Badge mono bg="transparent">
      {formatCost(costUsd)}
    </Badge>
  );
}

export default RunCostBadge;
