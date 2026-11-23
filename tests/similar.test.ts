import { describe, expect, it } from "vitest";
import type { NutrientEstimate, NutrientEstimates } from "@/lib/nutrition/estimator";
import { gramsText, labelWithGrams, servingWeight, weightText } from "@/lib/nutrition/grams";
import type { NutrientId } from "@/lib/nutrition/nutrients";
import { optimize, type Candidate } from "@/lib/optimizer/model";
import { foodFamily, similarGroups } from "@/lib/optimizer/similar";
import { buildTargets } from "@/lib/optimizer/targets";
import { MAX_ITEMS_NO_LIMIT, planRequestSchema, type PlanRequestInput } from "@/lib/optimizer/types";

describe("similar foods", () => {
  it("puts versions of the same food in one family", () => {
    expect(foodFamily("Skim Milk")).toBe("milk");
    expect(foodFamily("Chocolate Milk")).toBe("milk");
    expect(foodFamily("2% Milk")).toBe("milk");
    expect(foodFamily("Milk, chocolate, lowfat")).toBe("milk");
    expect(foodFamily("Pasta")).toBe("pasta");
    expect(foodFamily("Whole Grain Pasta")).toBe("pasta");
    expect(foodFamily("Penne with Marinara")).toBe("pasta");
    expect(foodFamily("Non-Fat Plain Greek Yogurt")).toBe("yogurt");
    expect(foodFamily("Vanilla Yogurt Cup")).toBe("yogurt");
    expect(foodFamily("Tater Tots")).toBe("potato");
    expect(foodFamily("French Fries")).toBe("potato");
    expect(foodFamily("Rice Pilaf")).toBe(foodFamily("Brown Rice"));
    expect(foodFamily("Pasta Primavera")).toBe("pasta");
  });

  it("keeps different foods apart", () => {
    expect(foodFamily("Apple")).not.toBe(foodFamily("Apple Juice"));
    expect(foodFamily("Skim Milk")).not.toBe(foodFamily("Non-Fat Plain Greek Yogurt"));
    expect(foodFamily("Banana")).not.toBe(foodFamily("Orange"));
    expect(foodFamily("%%")).toBeNull();
  });

  it("groups only families with two or more items", () => {
    expect(similarGroups(["Skim Milk", "Banana", "Chocolate Milk", "Spaghetti", "Pasta Primavera"])).toEqual([
      [0, 2],
      [3, 4],
    ]);
  });
});

const est = (value: number): NutrientEstimate => ({ value, low: value, high: value, provenance: "official", confidence: "high" });

function cand(foodId: string, name: string, n: Partial<Record<NutrientId, number>>): Candidate {
  const nutrients: Partial<NutrientEstimates> = {};
  for (const [k, v] of Object.entries(n)) nutrients[k as NutrientId] = est(v);
  return {
    foodId,
    lineageKey: foodId,
    name,
    station: null,
    period: "breakfast",
    mealKey: "breakfast",
    locationId: "A",
    locationName: "A",
    servingLabel: "1 cup",
    servingGrams: 245,
    gramsExact: true,
    step: 1,
    nutrients,
    confidence: "high",
    allergens: [],
    dietaryLabels: [],
    preferred: false,
    plant: false,
  };
}

const MILK = { energy: 90, protein: 8, carbohydrate: 12, fat: 0.5, calcium: 300, vitamin_d: 3, potassium: 380, vitamin_b12: 1.2, riboflavin: 0.45 };

async function breakfast(names: [string, string], input: Partial<PlanRequestInput> = {}) {
  const menu = [
    cand("m1", names[0], MILK),
    cand("m2", names[1], MILK),
    cand("oats", "Oatmeal", { energy: 150, protein: 5, carbohydrate: 27, fat: 3, fiber: 4, iron: 2 }),
    cand("fruit", "Banana", { energy: 105, carbohydrate: 27, fiber: 3, potassium: 420, vitamin_c: 10 }),
  ];
  const req = planRequestSchema.parse({ universityId: "u", date: "2026-11-20", meals: [{ period: "breakfast" }], maxItemsPerMeal: MAX_ITEMS_NO_LIMIT, maxServingsPerItem: 1, ...input });
  const plan = await optimize(req, [{ key: "breakfast", label: "Breakfast", period: "breakfast", candidates: menu, unavailableNote: null, filteredOut: 0, filterSummary: [] }], buildTargets(req));
  return plan.meals[0].items.map((i) => i.foodId).filter((id) => id === "m1" || id === "m2").length;
}

describe("optimizer avoids similar foods in one meal", () => {
  it("accepts 'no limit' on items per meal", () => {
    const req = planRequestSchema.parse({ universityId: "u", date: "2026-11-20", meals: [{ period: "lunch" }], maxItemsPerMeal: MAX_ITEMS_NO_LIMIT });
    expect(req.maxItemsPerMeal).toBe(MAX_ITEMS_NO_LIMIT);
  });

  it("chooses one milk, where two different foods with the same nutrients would both be chosen", async () => {
    // Control: identical nutrients under unrelated names; the optimizer wants both for calcium and vitamin D.
    expect(await breakfast(["Calcium Shake", "Fortified Soy Beverage"])).toBe(2);
    expect(await breakfast(["Skim Milk", "Chocolate Milk"])).toBe(1);
  });
});

describe("serving weights", () => {
  it("shows published weights as exact and estimates with ≈, and never invents one", () => {
    expect(servingWeight({ value: 245, low: 245, high: 245, basis: "stated" }, null)).toEqual({ grams: 245, exact: true });
    expect(servingWeight({ value: 52.4, low: 40, high: 60, basis: "volume" }, null)).toEqual({ grams: 52.4, exact: false });
    expect(servingWeight({ value: null, low: null, high: null, basis: "unknown" }, 170)).toEqual({ grams: 170, exact: true });
    expect(servingWeight(null, null)).toBeNull();
    expect(gramsText(52.4, false)).toBe("≈ 52 g");
    expect(gramsText(245, true, 1.5)).toBe("368 g");
    expect(gramsText(null, true)).toBeNull();
  });

  it("adds the weight to a label without repeating a gram serving", () => {
    expect(labelWithGrams("1 cup", 245, true)).toBe("1 cup · 245 g");
    expect(labelWithGrams("2 tbsp", 16, false)).toBe("2 tbsp · ≈ 16 g");
    expect(labelWithGrams("100 g", 100, true)).toBe("100 g");
    expect(labelWithGrams("1 serving", null, false)).toBe("1 serving");
    expect(weightText("100 g", 100, true, 2)).toBe("200 g");
  });
});
