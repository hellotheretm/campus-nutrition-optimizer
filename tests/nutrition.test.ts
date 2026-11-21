import { describe, expect, it } from "vitest";
import { coverageOf, groupByDate, overallConfidence, totalsOf } from "@/lib/nutrition/daily";
import { parseIngredientStatement, splitTopLevel } from "@/lib/nutrition/ingredients";
import { labelInterval, roundForLabel } from "@/lib/nutrition/label-rounding";
import type { NutrientEstimate } from "@/lib/nutrition/estimator";
import { getReferenceProfile, goalsAllowed, isMinorAgeGroup } from "@/lib/nutrition/references";

const est = (value: number | null, confidence: NutrientEstimate["confidence"] = "high"): NutrientEstimate => ({
  value,
  low: value,
  high: value,
  provenance: value === null ? "unknown" : "official",
  confidence: value === null ? "none" : confidence,
});

describe("ingredient statements", () => {
  it("splits on top-level commas only", () => {
    expect(splitTopLevel("Water, Sauce (Soy Sauce [Wheat, Soybeans], Sugar), Salt")).toEqual([
      "Water",
      "Sauce (Soy Sauce [Wheat, Soybeans], Sugar)",
      "Salt",
    ]);
  });

  it("keeps sub-ingredients, order, stated percentages and the 2% marker", () => {
    const parsed = parseIngredientStatement(
      "Tomatoes (32%), Cheese (Milk, Salt, Enzymes), Water, Contains 2% or less of: Garlic, Basil. Contains: Milk",
    );
    const names = parsed.ingredients.map((i) => i.name.toLowerCase());
    expect(names.slice(0, 3)).toEqual(["tomatoes", "cheese", "water"]);
    expect(parsed.ingredients[0].statedPercent).toBe(32);
    expect(parsed.ingredients[1].subIngredients.map((s) => s.name.toLowerCase())).toContain("milk");
    expect(parsed.minorStartIndex).toBe(3);
    expect(parsed.ingredients.filter((i) => i.minor).map((i) => i.name.toLowerCase())).toEqual(["garlic", "basil"]);
    expect(parsed.allergenStatement.map((a) => a.toLowerCase())).toContain("milk");
  });

  it("returns an empty statement for missing text instead of inventing ingredients", () => {
    expect(parseIngredientStatement(null).ingredients).toEqual([]);
    expect(parseIngredientStatement("   ").ingredients).toEqual([]);
  });
});

describe("FDA label rounding", () => {
  it("rounds calories to 5 below 50 and to 10 above", () => {
    expect(roundForLabel("energy", 3)).toBe(0);
    expect(roundForLabel("energy", 47)).toBe(45);
    expect(roundForLabel("energy", 237)).toBe(240);
  });

  it("turns a printed value back into the interval of true values it could represent", () => {
    const i = labelInterval("energy", 240);
    expect(i.low).toBeLessThanOrEqual(235);
    expect(i.high).toBeGreaterThanOrEqual(245);
    const zero = labelInterval("energy", 0);
    expect(zero.low).toBe(0);
    expect(zero.high).toBeGreaterThan(0);
  });

  it("round-trips: a true value always falls inside the interval of its rounded label", () => {
    for (const v of [0.3, 4.9, 12, 49, 51, 199, 640]) {
      const label = roundForLabel("energy", v);
      const i = labelInterval("energy", label);
      expect(v).toBeGreaterThanOrEqual(i.low - 1e-9);
      expect(v).toBeLessThanOrEqual(i.high + 1e-9);
    }
  });
});

describe("references and goals", () => {
  it("never allows calorie goals for people under 19 or with no age given", () => {
    expect(goalsAllowed("under_19")).toBe(false);
    expect(goalsAllowed("unspecified")).toBe(false);
    expect(goalsAllowed("19_30")).toBe(true);
    expect(isMinorAgeGroup("under_19")).toBe(true);
  });

  it("uses FDA Daily Values by default", () => {
    const p = getReferenceProfile();
    expect(p.values.iron?.amount).toBe(18);
    expect(p.limits.sodium).toBe(2300);
  });
});

describe("daily totals", () => {
  it("shows unknown as unknown, never as zero", () => {
    const totals = totalsOf([{ nutrients: { vitamin_d: est(null), iron: est(4) } }]);
    const rows = coverageOf(totals, getReferenceProfile(), ["vitamin_d", "iron"]);
    const vd = rows.find((r) => r.id === "vitamin_d")!;
    expect(vd.value).toBeNull();
    expect(vd.percent).toBeNull();
    const iron = rows.find((r) => r.id === "iron")!;
    expect(iron.value).toBe(4);
    expect(iron.percent).toBeCloseTo((4 / 18) * 100);
  });

  it("summarizes confidence by the most common level among known values", () => {
    const totals = totalsOf([{ nutrients: { iron: est(4, "medium"), calcium: est(100, "medium"), zinc: est(2, "high") } }]);
    const rows = coverageOf(totals, getReferenceProfile(), ["iron", "calcium", "zinc", "vitamin_d"]);
    expect(overallConfidence(rows)).toBe("medium");
    expect(overallConfidence([])).toBe("none");
  });

  it("groups diary entries by date, newest first", () => {
    const g = groupByDate([{ date: "2026-11-18" }, { date: "2026-11-20" }, { date: "2026-11-18" }]);
    expect(g.map(([d, list]) => [d, list.length])).toEqual([
      ["2026-11-20", 1],
      ["2026-11-18", 2],
    ]);
  });
});
