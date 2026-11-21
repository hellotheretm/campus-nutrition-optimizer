/**
 * Turns Demo University recipes into menu items: an FDA-rounded label, an
 * ingredient statement in descending order by weight, and (for validation
 * only) the ground-truth nutrient profile.
 */
import { COOKING_RETENTION, usdaValue } from "../nutrition/estimator";
import { roundForLabel } from "../nutrition/label-rounding";
import { NUTRIENT_IDS, type NutrientId } from "../nutrition/nutrients";
import { getUsdaFood } from "../nutrition/usda-index";
import { DEMO_HALLS, DEMO_RECIPES, type DemoHall, type DemoPeriod, type DemoRecipe } from "./recipes";

export const DEMO_UNIVERSITY = {
  slug: "demo-university",
  name: "Demo University",
  shortName: "Demo U",
  city: "Fictional City",
  state: "",
  timezone: "America/Chicago",
} as const;

const BASE_LABEL: NutrientId[] = [
  "energy",
  "fat",
  "saturated_fat",
  "trans_fat",
  "cholesterol",
  "sodium",
  "carbohydrate",
  "fiber",
  "sugars",
  "protein",
];
const MINERAL_LABEL: NutrientId[] = ["vitamin_d", "calcium", "iron", "potassium"];

export function recipeTotalGrams(r: DemoRecipe): number {
  return r.ingredients.reduce((s, i) => s + i.grams, 0);
}

/** Ground truth per serving (raw-ingredient sums with typical cooking retention for cooked dishes). */
export function recipeTruth(r: DemoRecipe): Partial<Record<NutrientId, number | null>> {
  const total = recipeTotalGrams(r);
  const out: Partial<Record<NutrientId, number | null>> = {};
  for (const id of NUTRIENT_IDS) {
    if (id === "water") continue;
    let sum = 0;
    let unknownMajor = false;
    for (const ing of r.ingredients) {
      const food = getUsdaFood(ing.fdcId);
      if (!food) throw new Error(`Demo recipe ${r.key}: unknown FDC id ${ing.fdcId}`);
      const v = usdaValue(food, id);
      if (v === null) {
        if (ing.grams / total > 0.02) unknownMajor = true;
        continue;
      }
      sum += (v * ing.grams) / 100;
    }
    if (unknownMajor) {
      out[id] = null;
      continue;
    }
    const ret = r.cooked ? COOKING_RETENTION[id] : undefined;
    out[id] = ret ? sum * ret.mid : sum;
  }
  return out;
}

export function recipeLabel(r: DemoRecipe, truth = recipeTruth(r)): Partial<Record<NutrientId, number>> {
  const ids = r.publishMinerals ? [...BASE_LABEL, ...MINERAL_LABEL] : BASE_LABEL;
  const label: Partial<Record<NutrientId, number>> = {};
  for (const id of ids) {
    const v = truth[id];
    if (v === null || v === undefined) continue;
    label[id] = roundForLabel(id, v);
  }
  return label;
}

export function recipeIngredientStatement(r: DemoRecipe): string {
  const total = recipeTotalGrams(r);
  const sorted = [...r.ingredients].sort((a, b) => b.grams - a.grams);
  const fmt = (i: (typeof sorted)[number]) => (i.sub ? `${i.label} (${i.sub})` : i.label);
  const major = sorted.filter((i) => i.grams / total > 0.02);
  const minor = sorted.filter((i) => i.grams / total <= 0.02);
  if (minor.length < 2) return sorted.map(fmt).join(", ") + ".";
  return `${major.map(fmt).join(", ")}. Contains 2% or less of: ${minor.map(fmt).join(", ")}.`;
}

export interface DemoMenuItem {
  externalId: string;
  recipeKey: string;
  name: string;
  station: string;
  servingAmount: number;
  servingUnit: string;
  servingGrams: number | null;
  official: Partial<Record<NutrientId, number>>;
  ingredients: string;
  allergens: string[];
  dietary: string[];
}

export function demoMenuItem(r: DemoRecipe, externalId: string): DemoMenuItem {
  const truth = recipeTruth(r);
  return {
    externalId,
    recipeKey: r.key,
    name: r.name,
    station: r.station,
    servingAmount: r.serving.amount,
    servingUnit: r.serving.unit,
    servingGrams: r.publishGrams ? Math.round(recipeTotalGrams(r) * r.yield) : null,
    official: recipeLabel(r, truth),
    ingredients: recipeIngredientStatement(r),
    allergens: r.allergens,
    dietary: r.dietary,
  };
}

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T12:00:00Z`) / 86_400_000);
}

export function demoMenuFor(hall: DemoHall, date: string): Partial<Record<DemoPeriod, DemoMenuItem[]>> {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const day = dayNumber(date);
  const out: Partial<Record<DemoPeriod, DemoMenuItem[]>> = {};
  for (const period of hall.periods) {
    if (hall.closed?.[period]?.includes(weekday)) continue;
    const pool = hall.pools[period];
    if (!pool) continue;
    const keys = [...pool.always];
    for (let k = 0; k < pool.perDay && k < pool.rotating.length; k++) {
      keys.push(pool.rotating[(day * 3 + k) % pool.rotating.length]);
    }
    out[period] = [...new Set(keys)].map((key) => {
      const recipe = DEMO_RECIPES.find((r) => r.key === key);
      if (!recipe) throw new Error(`Unknown demo recipe ${key}`);
      return demoMenuItem(recipe, `demo:${hall.key}:${key}`);
    });
  }
  return out;
}

export { DEMO_HALLS, DEMO_RECIPES };
