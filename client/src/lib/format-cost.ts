/**
 * Run-cost formatting (L01). ONE adaptive rule for every cost surface — the PR
 * list cell, the Agent Runs timeline, and the trace drawer's COST tile — so no
 * call site has to pick a number of decimal places.
 *
 * Rule: 2 significant digits, trailing zeros stripped. That single rule yields
 * $0.06, $0.014 and $0.0013 from the same function.
 */

/** Shown when we have no cost for a run. Matches the app-wide empty metric. */
export const NO_COST = "—";

/** Below this the digits are noise; show a bound instead of $0.0000. */
const MIN_SHOWN_USD = 0.0001;

/**
 * `null`/`undefined` and `0` are NOT the same thing and must not collapse:
 *   null  → we don't know (unpriced model, cold PriceBook, failed run) → "—"
 *   0     → a genuinely free but *priced* model (e.g. z-ai/glm-4.7-flash) → "$0.00"
 * A truthiness check (`!usd`) would merge them and destroy the empty state.
 *
 * `undefined` is accepted on purpose: run traces written while cost was absent
 * from the contract have no `cost_usd`, and `GET /runs/:id/trace` casts the
 * jsonb rather than parsing it, so the field arrives undefined for old rows.
 */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return NO_COST;
  if (usd === 0) return "$0.00";
  if (usd < MIN_SHOWN_USD) return "<$0.0001";
  // Number(x.toPrecision(2)) drops trailing zeros: 0.060 → 0.06, 0.0130 → 0.013.
  return `$${Number(usd.toPrecision(2))}`;
}

/**
 * Thousands grouping without a locale — `toLocaleString` varies by browser
 * locale and the e2e flows assert on the literal string.
 */
export function formatTokenCount(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
