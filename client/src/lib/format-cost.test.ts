/**
 * The one adaptive cost rule that all three surfaces (PR list, timeline, trace
 * drawer) depend on. The load-bearing case is null vs 0: they must NOT collapse
 * — null means "we don't know", 0 means "a priced but free model".
 */
import { describe, it, expect } from "vitest";
import { formatCost, formatTokenCount, NO_COST } from "./format-cost";

describe("formatCost", () => {
  it.each([
    [0.06, "$0.06"], // trace drawer tile
    [0.014, "$0.014"], // PR list total
    [0.0013, "$0.0013"], // one timeline run
    [0.06001, "$0.06"], // 2 significant digits, trailing zeros stripped
    [1.2345, "$1.2"],
    [12.345, "$12"],
  ])("formats %p as %p", (usd, expected) => {
    expect(formatCost(usd)).toBe(expected);
  });

  it("distinguishes an unpriced run from a genuinely free one", () => {
    expect(formatCost(null)).toBe(NO_COST);
    expect(formatCost(undefined)).toBe(NO_COST);
    expect(formatCost(0)).toBe("$0.00");
  });

  it("shows a bound rather than $0.0000 for dust", () => {
    expect(formatCost(0.00001)).toBe("<$0.0001");
  });
});

describe("formatTokenCount", () => {
  it.each([
    [100, "100"],
    [9119, "9,119"],
    [1234567, "1,234,567"],
  ])("groups %p as %p", (n, expected) => {
    expect(formatTokenCount(n)).toBe(expected);
  });
});
