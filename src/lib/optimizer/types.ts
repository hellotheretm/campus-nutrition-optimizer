/**
 * Meal optimizer request and result types. Requests are validated with zod
 * before they reach the solver; results are plain JSON so they can be stored
 * in meal_plans and sent to the browser.
 */
import { z } from "zod";
import type { MealPeriod } from "@/db/schema";
import { isIsoDate } from "@/lib/dates";
import type { Confidence, NutrientEstimates } from "@/lib/nutrition/estimator";
import type { NutrientId } from "@/lib/nutrition/nutrients";

export const STRATEGIES = {
  balanced: {
    label: "Balanced",
    description: "Even coverage of vitamins, minerals, protein and fiber, with gentle limits on sodium, saturated fat and added sugars.",
  },
  protein_forward: {
    label: "Protein-forward",
    description: "Gives protein extra weight while keeping the rest of the day balanced.",
  },
  plant_forward: {
    label: "Plant-forward",
    description: "Prefers items the dining hall labels vegetarian or vegan, and fiber-rich foods.",
  },
  lower_sodium: {
    label: "Lower sodium",
    description: "Treats sodium more strictly than the standard limit.",
  },
  simple: {
    label: "Fewer items",
    description: "Builds simpler meals with fewer dishes.",
  },
} as const;

export type StrategyKey = keyof typeof STRATEGIES;
export const STRATEGY_KEYS = Object.keys(STRATEGIES) as StrategyKey[];

/** "No limit" on items per meal: above the largest menu the solver ever considers for one meal. */
export const MAX_ITEMS_NO_LIMIT = 50;

export const PLAN_PERIODS = ["breakfast", "brunch", "lunch", "dinner", "late_night"] as const;
export type PlanPeriod = (typeof PLAN_PERIODS)[number];

const periodEnum = z.enum(PLAN_PERIODS);
const shortList = (max: number, len = 80) => z.array(z.string().trim().min(1).max(len)).max(max);

export const dietaryPreferencesSchema = z.object({
  pattern: z.enum(["none", "vegetarian", "vegan", "pescatarian"]).default("none"),
  avoidAllergens: shortList(12, 40).default([]),
  avoidGluten: z.boolean().default(false),
  avoidDairy: z.boolean().default(false),
  avoidNuts: z.boolean().default(false),
  excludedIngredients: shortList(30).default([]),
  dislikes: shortList(30).default([]),
  preferred: shortList(30).default([]),
});

export type DietFilterInput = z.infer<typeof dietaryPreferencesSchema>;

/** Energy per gram (Atwater general factors), used to keep macro targets consistent with calories. */
export const KCAL_PER_GRAM = { protein: 4, fat: 9, carbohydrate: 4 } as const;
export const MACRO_TOLERANCES = [3, 5, 10] as const;

/** Calories implied by macro grams: 4 × protein + 9 × fat + 4 × carbohydrate. */
export function macroCalories(m: { protein: number; fat: number; carbohydrate: number }): number {
  return m.protein * KCAL_PER_GRAM.protein + m.fat * KCAL_PER_GRAM.fat + m.carbohydrate * KCAL_PER_GRAM.carbohydrate;
}

export type MacroId = "energy" | "protein" | "fat" | "carbohydrate";
export const MACRO_IDS: readonly MacroId[] = ["energy", "protein", "fat", "carbohydrate"];
export type Tolerance = (typeof MACRO_TOLERANCES)[number];

/** Allowed range for each target (kcal for energy, grams otherwise). */
export const MACRO_LIMITS: Record<MacroId, { min: number; max: number }> = {
  energy: { min: 1000, max: 6000 },
  protein: { min: 10, max: 400 },
  fat: { min: 10, max: 300 },
  carbohydrate: { min: 20, max: 900 },
};

const MACRO_WORDS: Record<MacroId, string> = { energy: "Calories", protein: "Protein", fat: "Fat", carbohydrate: "Carbs" };
const MACRO_UNITS: Record<MacroId, string> = { energy: "kcal", protein: "g", fat: "g", carbohydrate: "g" };

/**
 * Daily calorie and macro targets. Any of the four may be left blank (null).
 * They are kept consistent with 4/9/4 math: with protein, fat and carbs set,
 * calories are 4P + 9F + 4C; with calories and two macros set, the third is
 * calculated; all four set must add up exactly.
 */
export const macroTargetsSchema = z
  .object({
    energy: z.number().nullable().default(null),
    protein: z.number().nullable().default(null),
    fat: z.number().nullable().default(null),
    carbohydrate: z.number().nullable().default(null),
    /** Allowed deviation from each target, in percent. */
    tolerancePct: z.union([z.literal(3), z.literal(5), z.literal(10)]).default(5),
  })
  .superRefine((m, ctx) => {
    const r = resolveMacroTargets(m);
    if (r.error) ctx.addIssue({ code: "custom", message: r.error });
  });

export type MacroTargets = z.infer<typeof macroTargetsSchema>;
export type MacroTargetsInput = Pick<MacroTargets, MacroId> & { tolerancePct: Tolerance };

export interface ResolvedMacroTargets {
  /** Every target that applies, including a calculated one. */
  targets: Partial<Record<MacroId, number>>;
  /** The target filled in by 4/9/4 math, if any. */
  derived: MacroId | null;
  /** Why the combination can't be used, or null. */
  error: string | null;
}

const fmtTarget = (id: MacroId, v: number) => `${Math.round(v).toLocaleString("en-US")} ${MACRO_UNITS[id]}`;

/** Fills in whatever 4/9/4 math determines and checks the targets agree and are in range. */
export function resolveMacroTargets(m: Pick<MacroTargets, MacroId>): ResolvedMacroTargets {
  const set = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
  const t: Partial<Record<MacroId, number>> = {};
  for (const id of MACRO_IDS) if (set(m[id])) t[id] = m[id]!;
  let derived: MacroId | null = null;
  const grams = (["protein", "fat", "carbohydrate"] as const).filter((id) => t[id] !== undefined);

  if (grams.length === 3) {
    const kcal = macroCalories({ protein: t.protein!, fat: t.fat!, carbohydrate: t.carbohydrate! });
    if (t.energy !== undefined && Math.abs(t.energy - kcal) > 0.5) {
      return {
        targets: t,
        derived: null,
        error: `Calories don't match your macros: ${t.protein} g × 4 + ${t.fat} g × 9 + ${t.carbohydrate} g × 4 = ${fmtTarget("energy", kcal)}. Clear one of the four to have it calculated.`,
      };
    }
    if (t.energy === undefined) derived = "energy";
    t.energy = kcal;
  } else if (grams.length === 2 && t.energy !== undefined) {
    const missing = (["protein", "fat", "carbohydrate"] as const).find((id) => t[id] === undefined)!;
    const used = grams.reduce((s, id) => s + t[id]! * KCAL_PER_GRAM[id], 0);
    t[missing] = Math.round(((t.energy - used) / KCAL_PER_GRAM[missing]) * 10) / 10;
    derived = missing;
  }

  for (const id of MACRO_IDS) {
    const v = t[id];
    if (v === undefined) continue;
    const { min, max } = MACRO_LIMITS[id];
    if (v < min || v > max) {
      const why = derived === id ? ` (calculated from the other targets as ${fmtTarget(id, v)})` : "";
      return { targets: t, derived, error: `${MACRO_WORDS[id]} must be between ${fmtTarget(id, min)} and ${fmtTarget(id, max)}${why}.` };
    }
  }
  if (t.energy !== undefined && grams.length > 0 && grams.length < 3 && derived === null) {
    const used = grams.reduce((s, id) => s + t[id]! * KCAL_PER_GRAM[id], 0);
    if (used > t.energy) {
      return { targets: t, derived, error: `Your macros alone add up to ${fmtTarget("energy", used)}, more than your ${fmtTarget("energy", t.energy)} calorie target.` };
    }
  }
  return { targets: t, derived, error: null };
}

/** True when at least one target is set. */
export function hasMacroTargets(m: Pick<MacroTargets, MacroId> | null | undefined): boolean {
  return Boolean(m && MACRO_IDS.some((id) => typeof m[id] === "number"));
}

export interface MacroTargetRow {
  id: MacroId;
  target: number;
  min: number;
  max: number;
  /** Planned total (published or estimated values), or null if nothing is known. */
  value: number | null;
  /** Items in the plan whose value for this macro is unknown. */
  unknownItems: number;
}

export const planRequestSchema = z.object({
  universityId: z.string().min(1).max(100),
  date: z.string().refine(isIsoDate, "invalid date"),
  meals: z
    .array(
      z.object({
        period: periodEnum,
        /** Empty means every location that serves this meal. */
        locationIds: z.array(z.string().min(1).max(200)).max(20).default([]),
      }),
    )
    .min(1)
    .max(5),
  strategy: z.enum(STRATEGY_KEYS as [StrategyKey, ...StrategyKey[]]).default("balanced"),
  reference: z
    .object({
      standard: z.enum(["fda_dv", "dri"]).default("fda_dv"),
      ageGroup: z.enum(["under_19", "19_30", "31_50", "51_70", "71_plus", "unspecified"]).default("unspecified"),
      sex: z.enum(["female", "male", "unspecified"]).default("unspecified"),
    })
    .default({ standard: "fda_dv", ageGroup: "unspecified", sex: "unspecified" }),
  /** Optional daily calorie and macro targets, hit within the tolerance (anyone may set them). */
  macroTargets: macroTargetsSchema.nullable().default(null),
  focus: z.array(z.string().max(40)).max(8).default([]),
  preferences: dietaryPreferencesSchema.default({
    pattern: "none",
    avoidAllergens: [],
    avoidGluten: false,
    avoidDairy: false,
    avoidNuts: false,
    excludedIngredients: [],
    dislikes: [],
    preferred: [],
  }),
  maxItemsPerMeal: z.number().int().min(1).max(MAX_ITEMS_NO_LIMIT).default(4),
  maxServingsPerItem: z.number().min(1).max(3).default(2),
  locks: z
    .array(z.object({ period: periodEnum, foodId: z.string().min(1).max(100), servings: z.number().min(0.5).max(6) }))
    .max(40)
    .default([]),
  excluded: z.array(z.object({ period: periodEnum, foodId: z.string().min(1).max(100) })).max(300).default([]),
  /** Signatures of plans already shown, so "another option" returns something different. */
  avoidSignatures: z.array(z.string().max(4000)).max(10).default([]),
  /** Meals whose current items must not be repeated exactly (used by "regenerate this meal"). */
  freshMeals: z
    .array(z.object({ period: periodEnum, foodIds: z.array(z.string().max(100)).max(MAX_ITEMS_NO_LIMIT) }))
    .max(5)
    .default([]),
});

/** Items-per-meal choices offered in the app; MAX_ITEMS_NO_LIMIT means no limit. */
export const ITEMS_PER_MEAL_OPTIONS = [2, 3, 4, 5, 6, 7, 8, 10, 12, 15] as const;

export type PlanRequest = z.infer<typeof planRequestSchema>;
export type PlanRequestInput = z.input<typeof planRequestSchema>;

export interface PlanItem {
  foodId: string;
  name: string;
  station: string | null;
  servings: number;
  /** Serving increments the stepper uses (0.5 or 1). */
  step: number;
  maxServings: number;
  servingLabel: string;
  servingGrams: number | null;
  /** True when the serving weight was published, false when estimated (shown with "≈"). */
  gramsExact: boolean;
  /** Per-serving nutrient estimates, so the browser can recompute totals while editing. */
  nutrients: Partial<NutrientEstimates>;
  confidence: Confidence;
  allergens: string[];
  dietaryLabels: string[];
  locked: boolean;
  why: string[];
}

export interface PlanMeal {
  period: MealPeriod;
  status: "planned" | "unavailable";
  locationId: string | null;
  locationName: string | null;
  items: PlanItem[];
  note: string | null;
  /** Items considered for this meal after filters. */
  candidates: number;
}

/** A menu item offered in the manual "choose from the menu" picker. */
export interface MenuChoice {
  foodId: string;
  name: string;
  station: string | null;
  locationId: string;
  locationName: string;
  step: number;
  servingLabel: string;
  servingGrams: number | null;
  /** True when the serving weight was published, false when estimated (shown with "≈"). */
  gramsExact: boolean;
  nutrients: Partial<NutrientEstimates>;
  confidence: Confidence;
  allergens: string[];
  dietaryLabels: string[];
  /** Why it conflicts with the current dietary filters (empty when it fits). */
  conflicts: string[];
}

export type CoverageKind = "goal" | "limit" | "info";

export interface TargetSummary {
  id: NutrientId;
  kind: CoverageKind;
  /** Reference amount (goal) or limit, per day. */
  amount: number | null;
  /** Tolerable Upper Intake Level applied to food totals, when one applies. */
  ul: number | null;
  ulCompare: NutrientId | null;
  weight: number;
}

export interface CoverageRow extends TargetSummary {
  value: number | null;
  low: number | null;
  high: number | null;
  /** Value after discounting uncertain estimates (what the optimizer counted). */
  conservative: number | null;
  percent: number | null;
  unknownItems: number;
  confidence: Confidence;
}

export interface PlanResult {
  status: "optimal" | "feasible" | "infeasible" | "no_menu" | "error";
  universityId: string;
  date: string;
  strategy: StrategyKey;
  referenceLabel: string;
  meals: PlanMeal[];
  targets: TargetSummary[];
  coverage: CoverageRow[];
  energy: { value: number | null; low: number | null; high: number | null; min: number | null; max: number | null; shown: boolean };
  /** Daily calorie and macro targets and how the plan compares, when any were set. */
  macroTargets?: MacroTargetRow[] | null;
  summary: string[];
  warnings: string[];
  infeasibility: { reasons: string[]; suggestions: string[] } | null;
  model: {
    solver: string;
    candidates: number;
    variables: number;
    constraints: number;
    solveMs: number;
    objective: number | null;
    notes: string[];
  };
  signature: string;
  generatedAt: string;
  /** True when the user changed the plan after the optimizer produced it. */
  edited?: boolean;
}
