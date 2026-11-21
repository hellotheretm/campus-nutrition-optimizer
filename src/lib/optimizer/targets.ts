/**
 * Turns a plan request into nutrient goals, limits and upper limits.
 *
 * Goals come from the selected reference standard (FDA Daily Values or the
 * DRIs for an age/sex group). They are population benchmarks, not personal
 * prescriptions. There is one way to plan: cover as many of the day's
 * vitamin, mineral, protein and fiber references as possible, and hit any
 * calorie and macro targets the person set, within their tolerance.
 */
import type { MealPeriod } from "@/db/schema";
import { NUTRIENTS, type NutrientId } from "@/lib/nutrition/nutrients";
import { getReferenceProfile, type ReferenceProfile } from "@/lib/nutrition/references";
import { hasMacroTargets, MACRO_IDS, resolveMacroTargets, type MacroId, type PlanRequest, type StrategyKey, type TargetSummary } from "./types";

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

/** Daily targets: each total that has a target must land within ±tolerance of it. */
export interface MacroSpec {
  /** Only the targets the person set (or that 4/9/4 math filled in). */
  targets: Partial<Record<MacroId, number>>;
  /** Fraction, e.g. 0.05 for ±5%. */
  tolerance: number;
}

export interface Targets {
  profile: ReferenceProfile;
  goals: GoalSpec[];
  limits: LimitSpec[];
  uls: UlSpec[];
  /** Without calorie or macro targets: keep protein/fat/carbohydrate energy within the AMDR. */
  amdr: boolean;
  /** Calorie and macro targets, or null when none were set. */
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

const TARGET_NAMES: Record<MacroId, string> = { energy: "kcal", protein: "g protein", fat: "g fat", carbohydrate: "g carbohydrate" };

/** "2,500 kcal, 150 g protein and 80 g fat" */
export function describeMacroTargets(targets: Partial<Record<MacroId, number>>): string {
  const parts = MACRO_IDS.filter((id) => targets[id] !== undefined).map(
    (id) => `${Math.round(targets[id]!).toLocaleString("en-US")} ${TARGET_NAMES[id]}`,
  );
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : (parts[0] ?? "");
}

export function buildTargets(req: PlanRequest, periods: MealPeriod[]): Targets {
  const profile = getReferenceProfile(req.reference);
  const minor = profile.isMinor;
  const shares = mealShares(periods);
  const notes: string[] = [];
  const focus = new Set(req.focus);

  // Calorie and macro targets, for anyone who sets them.
  let macros: MacroSpec | null = null;
  if (hasMacroTargets(req.macroTargets)) {
    const resolved = resolveMacroTargets(req.macroTargets!);
    if (!resolved.error) {
      macros = { targets: resolved.targets, tolerance: req.macroTargets!.tolerancePct / 100 };
      notes.push(`Your targets: ${describeMacroTargets(resolved.targets)}, each within ±${req.macroTargets!.tolerancePct}%.`);
      if (minor && resolved.targets.energy !== undefined) {
        notes.push("Teens are still growing and need enough energy every day; a doctor or registered dietitian can help choose calorie targets.");
      }
    }
  }

  const goals: GoalSpec[] = [];
  const summary: TargetSummary[] = [];

  for (const id of GOAL_NUTRIENTS) {
    const ref = profile.values[id];
    if (!ref) continue;
    let amount = ref.amount;
    const proteinTarget = macros?.targets.protein;
    if (id === "protein" && proteinTarget !== undefined) amount = proteinTarget;
    if (id === "protein" && req.strategy === "protein_forward" && proteinTarget === undefined) {
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
    goals.push({ id, target: amount, weight, scope: "day" });
  }

  // Spread protein across meals a little (each meal gets at least half its share).
  if (periods.length > 1) {
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
    limits.push({ id, limit: amount, weight, scope: "day" });
  }

  const uls: UlSpec[] = [];
  for (const id of UL_NUTRIENTS) {
    const ul = profile.upperLimits[id];
    if (!ul || (ul.appliesTo !== "total" && ul.appliesTo !== "preformed")) continue;
    uls.push({ id, compare: ul.compareWith ?? id, amount: ul.amount });
  }

  summary.push({ id: "energy", kind: "info", amount: null, ul: null, ulCompare: null, weight: 0 });

  if (minor) notes.push("Using Dietary Reference Intakes for ages 14–18.");
  notes.push(...profile.notes.slice(0, 1));

  return {
    profile,
    goals,
    limits,
    uls,
    // Calorie or macro targets replace the gentle AMDR ranges.
    amdr: !macros,
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
