/**
 * Turns a plan request into nutrient goals, limits and upper limits.
 *
 * Goals come from the selected reference standard (FDA Daily Values or the
 * DRIs for an age/sex group). They are population benchmarks, not personal
 * prescriptions. People under 19 never get calorie or macro targets.
 */
import type { MealPeriod } from "@/db/schema";
import { NUTRIENTS, type NutrientId } from "@/lib/nutrition/nutrients";
import { getReferenceProfile, goalsAllowed, type ReferenceProfile } from "@/lib/nutrition/references";
import { macroCalories, type GoalMode, type MacroId, type PlanRequest, type StrategyKey, type TargetSummary } from "./types";

/** Nutrients the optimizer tries to cover. Biotin, iodine, chromium and molybdenum are left
 * out because food composition data for them is too sparse to plan with. */
export const GOAL_NUTRIENTS: NutrientId[] = [
  "protein",
  "fiber",
  "vitamin_a",
  "vitamin_c",
  "vitamin_d",
  "vitamin_e",
  "vitamin_k",
  "thiamin",
  "riboflavin",
  "niacin",
  "vitamin_b6",
  "folate",
  "vitamin_b12",
  "pantothenic_acid",
  "choline",
  "calcium",
  "iron",
  "magnesium",
  "phosphorus",
  "potassium",
  "zinc",
  "selenium",
  "copper",
  "manganese",
];

/** Relative importance in the objective. Nutrients that are plentiful in most diets, or whose
 * data is sparse, count a little less so they do not dominate the plan. */
const BASE_WEIGHTS: Partial<Record<NutrientId, number>> = {
  protein: 1.5,
  fiber: 1.2,
  vitamin_d: 0.6,
  vitamin_e: 0.8,
  choline: 0.7,
  pantothenic_acid: 0.6,
  phosphorus: 0.5,
  copper: 0.6,
  manganese: 0.6,
  selenium: 0.8,
};

export const LIMIT_NUTRIENTS: NutrientId[] = ["sodium", "saturated_fat", "added_sugars"];

const LIMIT_WEIGHTS: Partial<Record<NutrientId, number>> = {
  sodium: 2,
  saturated_fat: 1.5,
  added_sugars: 1.5,
};

/** Upper limits are only applied to nutrients with usable food data. */
const UL_NUTRIENTS: NutrientId[] = [
  "vitamin_a",
  "vitamin_c",
  "vitamin_d",
  "vitamin_b6",
  "choline",
  "calcium",
  "copper",
  "iron",
  "manganese",
  "phosphorus",
  "selenium",
  "zinc",
];

export const DEFAULT_SHARES: Record<MealPeriod, number> = {
  breakfast: 0.25,
  brunch: 0.35,
  lunch: 0.35,
  dinner: 0.4,
  late_night: 0.15,
  other: 0.2,
};

export type Scope = "day" | MealPeriod;

export interface GoalSpec {
  id: NutrientId;
  target: number;
  weight: number;
  scope: Scope;
}

export interface LimitSpec {
  id: NutrientId;
  limit: number;
  weight: number;
  scope: Scope;
}

export interface UlSpec {
  /** The nutrient the UL is defined for. */
  id: NutrientId;
  /** The nutrient whose total is compared (retinol for vitamin A). */
  compare: NutrientId;
  amount: number;
}

export interface EnergySpec {
  min: number | null;
  max: number | null;
  scope: Scope;
}

/** Strict daily targets: each total must land within ±tolerance of its target. */
export interface MacroSpec {
  targets: Record<MacroId, number>;
  /** Fraction, e.g. 0.05 for ±5%. */
  tolerance: number;
}

export interface Targets {
  profile: ReferenceProfile;
  goals: GoalSpec[];
  limits: LimitSpec[];
  uls: UlSpec[];
  energy: EnergySpec[];
  /** Adults only: keep protein/fat/carbohydrate within the AMDR. */
  amdr: boolean;
  /** Strict calorie and macro targets (daily mode, adults only), or null. */
  macros: MacroSpec | null;
  shares: Partial<Record<MealPeriod, number>>;
  /** Day-level summary used for coverage tables. */
  summary: TargetSummary[];
  notes: string[];
}

export function mealShares(
  periods: MealPeriod[],
  custom?: Partial<Record<MealPeriod, number>>,
): Partial<Record<MealPeriod, number>> {
  const raw = periods.map((p) => custom?.[p] ?? DEFAULT_SHARES[p] ?? 0.25);
  const total = raw.reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(periods.map((p, i) => [p, raw[i] / total]));
}

function strategyWeights(strategy: StrategyKey, id: NutrientId, base: number): number {
  if (strategy === "protein_forward" && id === "protein") return base * 3;
  if (strategy === "plant_forward" && id === "fiber") return base * 1.6;
  return base;
}

export function buildTargets(req: PlanRequest, periods: MealPeriod[]): Targets {
  const profile = getReferenceProfile(req.reference);
  const minor = profile.isMinor;
  const mode: GoalMode = req.goalMode;
  const shares = mealShares(periods, req.mealShares);
  const notes: string[] = [];
  const focus = new Set(req.focus);

  // Strict calorie and macro targets: daily mode, adults who chose an age group only.
  let macros: MacroSpec | null = null;
  if (req.macroTargets && mode === "daily") {
    if (goalsAllowed(req.reference.ageGroup)) {
      const m = req.macroTargets;
      macros = {
        targets: { energy: macroCalories(m), protein: m.protein, fat: m.fat, carbohydrate: m.carbohydrate },
        tolerance: m.tolerancePct / 100,
      };
      notes.push(
        `Strict targets: ${Math.round(macros.targets.energy).toLocaleString("en-US")} kcal, ${m.protein} g protein, ${m.fat} g fat and ${m.carbohydrate} g carbohydrate, each within ±${m.tolerancePct}%.`,
      );
    } else {
      notes.push("Calorie and macro targets are only used for adults who choose an age group of 19 or older.");
    }
  }

  const goals: GoalSpec[] = [];
  const summary: TargetSummary[] = [];
  const perMealIds = new Set<NutrientId>();
  if (mode === "per_meal") GOAL_NUTRIENTS.forEach((id) => perMealIds.add(id));
  if (mode === "mixed") perMealIds.add("protein");

  for (const id of GOAL_NUTRIENTS) {
    const ref = profile.values[id];
    if (!ref) continue;
    let amount = ref.amount;
    if (id === "protein" && req.proteinMin && !minor && (mode === "daily" || mode === "mixed" || mode === "per_meal")) {
      amount = req.proteinMin;
    }
    if (id === "protein" && macros) amount = macros.targets.protein;
    if (id === "protein" && req.strategy === "protein_forward" && !minor && !macros) {
      amount *= 1.2;
      notes.push(`Protein-forward: the protein reference is raised by 20%, to ${Math.round(amount)} g.`);
    }
    let weight = strategyWeights(req.strategy, id, BASE_WEIGHTS[id] ?? 1);
    if (focus.has(id)) weight *= 2;
    const ul = req.reference ? profile.upperLimits[id] : undefined;
    summary.push({
      id,
      kind: "goal",
      amount,
      ul: ul && (ul.appliesTo === "total" || ul.appliesTo === "preformed") && UL_NUTRIENTS.includes(id) ? ul.amount : null,
      ulCompare: ul ? (ul.compareWith ?? id) : null,
      weight,
    });
    if (perMealIds.has(id)) {
      for (const p of periods) goals.push({ id, target: amount * (shares[p] ?? 0), weight: weight * (shares[p] ?? 0), scope: p });
    } else {
      goals.push({ id, target: amount, weight, scope: "day" });
    }
  }

  // Balanced day: also spread protein across meals (each meal gets at least half its share).
  if (mode === "balanced" && periods.length > 1) {
    const protein = summary.find((s) => s.id === "protein");
    if (protein?.amount) {
      for (const p of periods) {
        goals.push({ id: "protein", target: protein.amount * (shares[p] ?? 0) * 0.5, weight: 0.4, scope: p });
      }
    }
  }

  const limits: LimitSpec[] = [];
  for (const id of LIMIT_NUTRIENTS) {
    let amount = profile.limits[id];
    if (!amount) continue;
    let weight = LIMIT_WEIGHTS[id] ?? 1;
    if (id === "sodium" && req.strategy === "lower_sodium") {
      amount *= 0.75;
      weight *= 3;
      notes.push(`Lower sodium: the sodium limit is set to 75% of the standard, ${Math.round(amount).toLocaleString("en-US")} mg.`);
    }
    if (focus.has(id)) weight *= 2;
    summary.push({ id, kind: "limit", amount, ul: null, ulCompare: null, weight });
    if (mode === "per_meal") {
      for (const p of periods) limits.push({ id, limit: amount * (shares[p] ?? 0), weight: weight * (shares[p] ?? 0), scope: p });
    } else {
      limits.push({ id, limit: amount, weight, scope: "day" });
    }
  }

  const uls: UlSpec[] = [];
  for (const id of UL_NUTRIENTS) {
    const ul = profile.upperLimits[id];
    if (!ul || (ul.appliesTo !== "total" && ul.appliesTo !== "preformed")) continue;
    uls.push({ id, compare: ul.compareWith ?? id, amount: ul.amount });
  }

  // Energy: never for minors; only in modes that use explicit goals, and only when the user set a range.
  const energy: EnergySpec[] = [];
  // Strict macro targets replace the calorie range.
  const wantsEnergy = req.energy && (req.energy.min || req.energy.max) && mode !== "balanced" && !macros;
  if (minor && req.energy && (req.energy.min || req.energy.max)) {
    notes.push("Calorie targets are not used for people under 19; the plan focuses on balanced, varied meals instead.");
  } else if (wantsEnergy && req.energy) {
    const { min, max } = req.energy;
    if (mode === "daily") energy.push({ min, max, scope: "day" });
    else {
      for (const p of periods) {
        const s = shares[p] ?? 0;
        energy.push({ min: min ? min * s : null, max: max ? max * s : null, scope: p });
      }
    }
  }
  summary.push({ id: "energy", kind: "info", amount: null, ul: null, ulCompare: null, weight: 0 });

  if (minor) notes.push("Using Dietary Reference Intakes for ages 14–18.");
  notes.push(...profile.notes.slice(0, 1));

  return {
    profile,
    goals,
    limits,
    uls,
    energy,
    // Explicit macro targets replace the AMDR ranges.
    amdr: !minor && !macros,
    macros,
    shares,
    summary,
    notes,
  };
}

/** Nutrient name for use inside a sentence, e.g. "vitamin B12", "thiamin (B1)". */
export function nutrientName(id: NutrientId): string {
  const name = (NUTRIENTS[id]?.name ?? id).replace(/\s*\((RAE|DFE|α-tocopherol|phylloquinone)\)/, "");
  return name.charAt(0).toLowerCase() + name.slice(1);
}
