/**
 * Maps nutrient column names used by menu sources and import files onto the
 * app's nutrient ids, converting units where the conversion is unambiguous.
 */
import { NUTRIENTS, isNutrientId, type NutrientId } from "@/lib/nutrition/nutrients";

const ALIASES: Record<string, NutrientId> = {
  calories: "energy",
  calorie: "energy",
  kcal: "energy",
  energy: "energy",
  total_fat: "fat",
  fat: "fat",
  sat_fat: "saturated_fat",
  saturated_fat: "saturated_fat",
  trans_fat: "trans_fat",
  cholesterol: "cholesterol",
  sodium: "sodium",
  carbs: "carbohydrate",
  carb: "carbohydrate",
  carbohydrate: "carbohydrate",
  carbohydrates: "carbohydrate",
  total_carbohydrate: "carbohydrate",
  total_carbs: "carbohydrate",
  fiber: "fiber",
  fibre: "fiber",
  dietary_fiber: "fiber",
  sugar: "sugars",
  sugars: "sugars",
  total_sugar: "sugars",
  total_sugars: "sugars",
  added_sugar: "added_sugars",
  added_sugars: "added_sugars",
  protein: "protein",
  vit_a: "vitamin_a",
  vitamin_a: "vitamin_a",
  vit_c: "vitamin_c",
  vitamin_c: "vitamin_c",
  vit_d: "vitamin_d",
  vitamin_d: "vitamin_d",
  vit_e: "vitamin_e",
  vitamin_e: "vitamin_e",
  vit_k: "vitamin_k",
  vitamin_k: "vitamin_k",
  vitamin_b6: "vitamin_b6",
  vit_b6: "vitamin_b6",
  vitamin_b12: "vitamin_b12",
  vit_b12: "vitamin_b12",
  folate: "folate",
  folate_dfe: "folate",
  calcium: "calcium",
  iron: "iron",
  potassium: "potassium",
  magnesium: "magnesium",
  zinc: "zinc",
  phosphorus: "phosphorus",
};

const UNIT_SUFFIX = /_(kcal|kj|g|mg|mcg|ug|µg|iu)$/;

const MASS_FACTORS: Record<string, number> = { g: 1, mg: 1e-3, "µg": 1e-6 };

export interface ResolvedKey {
  id: NutrientId;
  /** Unit stated in the column name, if any. */
  unit: string | null;
}

export function resolveNutrientKey(raw: string): ResolvedKey | null {
  let key = raw
    .trim()
    .toLowerCase()
    .replace(/[()]/g, "")
    .replace(/[\s\-/]+/g, "_");
  let unit: string | null = null;
  const m = key.match(UNIT_SUFFIX);
  if (m) {
    unit = m[1] === "mcg" || m[1] === "ug" ? "µg" : m[1];
    key = key.slice(0, -m[0].length);
  }
  const id = ALIASES[key] ?? (isNutrientId(key) ? key : null);
  return id ? { id, unit } : null;
}

/**
 * Converts a value stated in `unit` to the nutrient's canonical unit.
 * Returns an error string for conversions that would need assumptions
 * (vitamin A or E in IU), so the value is rejected instead of guessed.
 */
export function toCanonical(id: NutrientId, value: number, unit: string | null): number | string {
  const target = NUTRIENTS[id].unit;
  if (!unit || unit === target) return value;
  if (id === "energy") {
    if (unit === "kj") return value / 4.184;
    return `energy must be in kcal or kJ (got ${unit})`;
  }
  if (unit === "iu") {
    if (id === "vitamin_d") return target === "µg" ? value / 40 : `cannot convert IU for ${id}`;
    return `${NUTRIENTS[id].name} in IU cannot be converted without knowing its chemical form; provide it in ${target}`;
  }
  const from = MASS_FACTORS[unit];
  const to = MASS_FACTORS[target];
  if (from === undefined || to === undefined) return `unsupported unit ${unit} for ${id}`;
  return (value * from) / to;
}

/** Plausible per-serving maximums used to catch unit mistakes in imports. */
export const PLAUSIBLE_MAX: Partial<Record<NutrientId, number>> = {
  energy: 4000,
  fat: 300,
  saturated_fat: 150,
  trans_fat: 50,
  cholesterol: 3000,
  sodium: 15000,
  carbohydrate: 600,
  fiber: 120,
  sugars: 400,
  added_sugars: 400,
  protein: 300,
  calcium: 5000,
  iron: 100,
  potassium: 10000,
  vitamin_d: 250,
  vitamin_c: 3000,
  vitamin_a: 10000,
};
