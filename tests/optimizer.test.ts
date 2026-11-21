import { describe, expect, it } from "vitest";
import type { MealPeriod } from "@/db/schema";
import type { NutrientEstimate, NutrientEstimates } from "@/lib/nutrition/estimator";
import type { NutrientId } from "@/lib/nutrition/nutrients";
import { computeCoverage, planLines } from "@/lib/optimizer/coverage";
import { checkFood, termMatches } from "@/lib/optimizer/filters";
import { optimize, planSignature, type Candidate, type MealCandidates } from "@/lib/optimizer/model";
import { buildTargets } from "@/lib/optimizer/targets";
import { planRequestSchema, type PlanRequestInput } from "@/lib/optimizer/types";

const prefs = (p: Partial<PlanRequestInput["preferences"]> = {}) => planRequestSchema.parse({ universityId: "u", date: "2026-11-20", meals: [{ period: "lunch" }], preferences: p }).preferences;

describe("dietary filters", () => {
  const food = (over: Partial<{ name: string; ingredients: string | null; allergens: string[]; dietaryLabels: string[] }>) => ({
    name: "Dish",
    ingredients: null,
    allergens: [],
    dietaryLabels: [],
    ...over,
  });

  it("requires a vegan label for vegan plans (no guessing from names)", () => {
    expect(checkFood(food({ name: "Garden Salad" }), prefs({ pattern: "vegan" })).ok).toBe(false);
    expect(checkFood(food({ name: "Garden Salad", dietaryLabels: ["vegan"] }), prefs({ pattern: "vegan" })).ok).toBe(true);
  });

  it("excludes labeled allergens and ingredient mentions, but not plant milks for dairy", () => {
    expect(checkFood(food({ allergens: ["peanut"] }), prefs({ avoidAllergens: ["peanut"] })).reasons).toContain("labeled: peanut");
    expect(checkFood(food({ ingredients: "Rice, Butter, Salt" }), prefs({ avoidDairy: true })).ok).toBe(false);
    expect(checkFood(food({ ingredients: "Oats, Oat Milk, Salt" }), prefs({ avoidDairy: true })).ok).toBe(true);
  });

  it("matches whole words for exclusions and dislikes", () => {
    expect(termMatches("pineapple chunks", "apple")).toBe(false);
    expect(termMatches("green apple slices", "apple")).toBe(true);
    expect(checkFood(food({ name: "Mushroom Risotto" }), prefs({ dislikes: ["mushroom"] })).reasons[0]).toMatch(/disliked/);
  });
});

/* ------------------------------------------------------------------ */
/* Optimizer on synthetic menus                                        */
/* ------------------------------------------------------------------ */

const est = (value: number, confidence: NutrientEstimate["confidence"] = "high"): NutrientEstimate => ({
  value,
  low: value,
  high: value,
  provenance: "official",
  confidence,
});

function cand(foodId: string, period: MealPeriod, locationId: string, n: Partial<Record<NutrientId, number>>, extra: Partial<Candidate> = {}): Candidate {
  const nutrients: Partial<NutrientEstimates> = {};
  for (const [k, v] of Object.entries(n)) nutrients[k as NutrientId] = est(v);
  return {
    foodId,
    lineageKey: foodId,
    name: foodId,
    station: null,
    period,
    locationId,
    locationName: locationId,
    servingLabel: "1 serving",
    servingGrams: 150,
    step: 1,
    nutrients,
    confidence: "high",
    allergens: [],
    dietaryLabels: [],
    preferred: false,
    plant: false,
    ...extra,
  };
}

function meal(period: MealPeriod, candidates: Candidate[]): MealCandidates {
  return { period, candidates, unavailableNote: null, filteredOut: 0, filterSummary: [] };
}

const BASIC = { energy: 400, protein: 15, carbohydrate: 50, fat: 12, fiber: 4, sodium: 500, iron: 2, calcium: 100, vitamin_c: 10 };

function lunchMenu(): Candidate[] {
  return [
    cand("bowl", "lunch", "A", { ...BASIC, protein: 25, iron: 4 }),
    cand("salad", "lunch", "A", { ...BASIC, energy: 150, vitamin_c: 60, fiber: 6, sodium: 200 }),
    cand("soup", "lunch", "A", { ...BASIC, sodium: 900, calcium: 200 }),
    cand("wrap", "lunch", "B", { ...BASIC, protein: 20 }),
    cand("fruit", "lunch", "B", { energy: 80, carbohydrate: 20, fiber: 3, vitamin_c: 50 }),
    cand("pasta", "lunch", "B", { ...BASIC, energy: 600 }),
  ];
}

async function run(input: Partial<PlanRequestInput>, meals: MealCandidates[]) {
  const req = planRequestSchema.parse({ universityId: "u", date: "2026-11-20", meals: meals.map((m) => ({ period: m.period })), ...input });
  const targets = buildTargets(req, meals.map((m) => m.period));
  return { req, targets, plan: await optimize(req, meals, targets) };
}

describe("meal optimizer", () => {
  it("plans each meal at a single dining location", async () => {
    const { plan } = await run({}, [meal("lunch", lunchMenu())]);
    expect(plan.status).toBe("optimal");
    const lunch = plan.meals[0];
    expect(lunch.items.length).toBeGreaterThan(0);
    expect(new Set(lunch.items.map((i) => lunchMenu().find((c) => c.foodId === i.foodId)!.locationId)).size).toBe(1);
  });

  it("keeps the total under a tolerable upper intake level even when a food is very rich in it", async () => {
    // Two servings of this would exceed the iron UL (45 mg) while chasing the iron goal.
    const menu = [cand("fortified", "breakfast", "A", { energy: 200, carbohydrate: 40, iron: 30 }), cand("toast", "breakfast", "A", { energy: 150, carbohydrate: 25, iron: 1 })];
    const { plan } = await run({ maxServingsPerItem: 3 }, [meal("breakfast", menu)]);
    const lines = planLines(plan.meals);
    const iron = lines.reduce((s, l) => s + (l.nutrients.iron?.high ?? 0) * l.servings, 0);
    expect(iron).toBeLessThanOrEqual(45);
    expect(plan.warnings.join(" ")).not.toMatch(/upper/i);
  });

  it("keeps locked items with their exact servings", async () => {
    const { plan } = await run({ locks: [{ period: "lunch", foodId: "soup", servings: 1.5 }] }, [meal("lunch", lunchMenu())]);
    const soup = plan.meals[0].items.find((i) => i.foodId === "soup");
    expect(soup?.servings).toBe(1.5);
    expect(soup?.locked).toBe(true);
  });

  it("honours a lock on a food served at several locations, picking a location that has everything locked", async () => {
    const menu = [...lunchMenu(), cand("soup", "lunch", "B", { ...BASIC, sodium: 900, calcium: 200 })];
    const { plan } = await run(
      { locks: [{ period: "lunch", foodId: "soup", servings: 1 }, { period: "lunch", foodId: "wrap", servings: 1 }] },
      [meal("lunch", menu)],
    );
    expect(plan.status).toBe("optimal");
    expect(plan.meals[0].locationId).toBe("B");
    expect(plan.meals[0].items.map((i) => i.foodId)).toEqual(expect.arrayContaining(["soup", "wrap"]));
  });

  it("explains why a plan is impossible instead of returning an empty plan", async () => {
    const { plan } = await run(
      { locks: [{ period: "lunch", foodId: "bowl", servings: 1 }, { period: "lunch", foodId: "wrap", servings: 1 }] },
      [meal("lunch", lunchMenu())],
    );
    expect(plan.status).toBe("infeasible");
    expect(plan.infeasibility?.reasons.join(" ")).toMatch(/same dining location/);
    expect(plan.infeasibility?.suggestions.length).toBeGreaterThan(0);
  });

  it("never uses calorie targets for people under 19", async () => {
    const { targets, plan } = await run(
      { goalMode: "daily", energy: { min: 1200, max: 1400 }, reference: { standard: "dri", ageGroup: "under_19", sex: "female" } },
      [meal("lunch", lunchMenu())],
    );
    expect(targets.energy).toEqual([]);
    expect(targets.notes.join(" ")).toMatch(/not used for people under 19/);
    expect(plan.energy.min).toBeNull();
    expect(plan.energy.max).toBeNull();
  });

  it("applies an adult's calorie range only when they set one in a goal mode", async () => {
    const adult = { standard: "fda_dv" as const, ageGroup: "19_30" as const, sex: "unspecified" as const };
    const balanced = await run({ energy: { min: 600, max: 900 }, reference: adult }, [meal("lunch", lunchMenu())]);
    expect(balanced.targets.energy).toEqual([]);
    const daily = await run({ goalMode: "daily", energy: { min: 600, max: 900 }, reference: adult }, [meal("lunch", lunchMenu())]);
    expect(daily.targets.energy).toEqual([{ min: 600, max: 900, scope: "day" }]);
    const kcal = planLines(daily.plan.meals).reduce((s, l) => s + (l.nutrients.energy?.value ?? 0) * l.servings, 0);
    // Soft range: within 3% of each bound.
    expect(kcal).toBeGreaterThanOrEqual(600 * 0.97 - 1e-6);
    expect(kcal).toBeLessThanOrEqual(900 * 1.03 + 1e-6);
  });

  it("'New meal' keeps at most half of the previous items", async () => {
    const menu = lunchMenu().filter((c) => c.locationId === "A").concat([
      cand("rice", "lunch", "A", { ...BASIC, energy: 300 }),
      cand("beans", "lunch", "A", { ...BASIC, fiber: 9, protein: 12 }),
    ]);
    const first = await run({}, [meal("lunch", menu)]);
    const before = first.plan.meals[0].items.map((i) => i.foodId);
    const again = await run({ freshMeals: [{ period: "lunch", foodIds: before }] }, [meal("lunch", menu)]);
    const after = again.plan.meals[0].items.map((i) => i.foodId);
    const kept = after.filter((id) => before.includes(id)).length;
    expect(kept).toBeLessThanOrEqual(Math.floor(before.length / 2));
  });

  it("'Another option' never repeats a plan already shown", async () => {
    const meals = [meal("lunch", lunchMenu())];
    const first = await run({}, meals);
    const second = await run({ avoidSignatures: [first.plan.signature] }, meals);
    expect(second.plan.signature).not.toBe(first.plan.signature);
    expect(planSignature(second.plan.meals)).toBe(second.plan.signature);
  });

  it("discounts uncertain estimates when deciding whether a goal is met", async () => {
    const shaky = cand("shaky", "lunch", "A", { energy: 300, iron: 18 });
    shaky.nutrients.iron = { value: 18, low: 6, high: 30, provenance: "usda_recipe", confidence: "low" };
    const { plan, targets } = await run({}, [meal("lunch", [shaky])]);
    const row = computeCoverage(planLines(plan.meals), targets.summary).find((r) => r.id === "iron")!;
    expect(row.percent).toBeCloseTo(100 * (plan.meals[0].items[0].servings * 18) / 18);
    expect(row.conservative!).toBeLessThan(row.value!);
  });
});

describe("bulk portion guard", async () => {
  const { bulkPortionReason } = await import("@/lib/optimizer/candidates");
  it("skips batch-sized servings but keeps ordinary portions", () => {
    expect(bulkPortionReason(454, 120, "lbs")).toMatch(/bulk/);
    expect(bulkPortionReason(null, 60, "1 lbs".replace(/^1 /, ""))).toMatch(/bulk/);
    expect(bulkPortionReason(300, 1282, "cup")).toMatch(/1,000\+ kcal/);
    expect(bulkPortionReason(170, 256, "oz")).toBeNull();
    expect(bulkPortionReason(null, null, null)).toBeNull();
  });
});

describe("strict calorie and macro targets", () => {
  const adult = { standard: "dri" as const, ageGroup: "19_30" as const, sex: "unspecified" as const };
  // Atwater-consistent synthetic items: kcal = 4P + 9F + 4C.
  const item = (id: string, p: number, f: number, c: number, extra: Partial<Record<NutrientId, number>> = {}) =>
    cand(id, "lunch", "A", { energy: 4 * p + 9 * f + 4 * c, protein: p, fat: f, carbohydrate: c, ...extra });
  const menu = () => [
    item("chicken", 31, 4, 0, { iron: 1 }),
    item("rice", 4, 0.5, 45, { fiber: 1 }),
    item("nuts", 6, 14, 6, { fiber: 3 }),
    item("fruit", 1, 0, 25, { vitamin_c: 50, fiber: 3 }),
    item("yogurt", 17, 0, 6, { calcium: 190 }),
    item("pasta", 8, 2, 43, { fiber: 2 }),
    item("salmon", 22, 12, 0),
  ];
  const opts = { maxItemsPerMeal: 8, maxServingsPerItem: 3 };

  it("rejects targets that don't add up, by deriving calories from the macros", () => {
    const req = planRequestSchema.parse({
      universityId: "u", date: "2026-11-20", meals: [{ period: "lunch" }], goalMode: "daily", reference: adult,
      macroTargets: { protein: 90, fat: 40, carbohydrate: 120, tolerancePct: 5 },
    });
    const t = buildTargets(req, ["lunch"]);
    expect(t.macros?.targets.energy).toBe(4 * 90 + 9 * 40 + 4 * 120);
    expect(t.amdr).toBe(false);
    expect(t.energy).toEqual([]);
  });

  it("lands every total inside the tolerance band", async () => {
    const { plan } = await run({ goalMode: "daily", reference: adult, ...opts, macroTargets: { protein: 90, fat: 40, carbohydrate: 120, tolerancePct: 5 } }, [meal("lunch", menu())]);
    expect(plan.status).not.toBe("infeasible");
    expect(plan.macroTargets).toHaveLength(4);
    for (const row of plan.macroTargets!) {
      expect(row.value!).toBeGreaterThanOrEqual(row.min - 1e-6);
      expect(row.value!).toBeLessThanOrEqual(row.max + 1e-6);
    }
  });

  it("explains which target the menus can't reach", async () => {
    const { plan } = await run({ goalMode: "daily", reference: adult, ...opts, macroTargets: { protein: 300, fat: 10, carbohydrate: 20, tolerancePct: 3 } }, [meal("lunch", menu())]);
    expect(plan.status).toBe("infeasible");
    expect(plan.infeasibility!.reasons.join(" ")).toMatch(/protein/);
    expect(plan.infeasibility!.suggestions.join(" ")).toMatch(/tolerance/);
  });

  it("never chooses items whose macros are unknown", async () => {
    const mystery = cand("mystery", "lunch", "A", { energy: 500, protein: 40, carbohydrate: 30, iron: 18, vitamin_c: 90 }); // fat unknown
    const { plan } = await run({ goalMode: "daily", reference: adult, ...opts, macroTargets: { protein: 90, fat: 40, carbohydrate: 120, tolerancePct: 10 } }, [meal("lunch", [...menu(), mystery])]);
    expect(plan.meals[0].items.map((i) => i.foodId)).not.toContain("mystery");
    expect(plan.warnings.join(" ")).toMatch(/left out/);
  });

  it("ignores macro targets without an adult age group", async () => {
    const { targets, plan } = await run({ goalMode: "daily", ...opts, macroTargets: { protein: 90, fat: 40, carbohydrate: 120, tolerancePct: 5 } }, [meal("lunch", menu())]);
    expect(targets.macros).toBeNull();
    expect(plan.macroTargets ?? null).toBeNull();
  });
});
