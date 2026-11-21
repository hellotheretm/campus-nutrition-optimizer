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

export const GOAL_MODES = {
  balanced: {
    label: "Balanced day",
    description: "Covers the day's vitamin and mineral references with protein spread across meals. No calorie target.",
  },
  daily: {
    label: "Daily goals",
    description: "Meets your daily references, with optional strict calorie, protein, fat and carb targets (adults).",
  },
  per_meal: {
    label: "Per-meal goals",
    description: "Splits the day's references across meals so each meal pulls its weight.",
  },
  mixed: {
    label: "Mixed",
    description: "Calories and protein per meal; vitamins and minerals across the whole day.",
  },
} as const;

export type GoalMode = keyof typeof GOAL_MODES;

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

/**
 * Strict daily targets (daily goal mode, adults only). Calories are not sent:
 * they are always 4P + 9F + 4C, so the four targets can't disagree.
 */
export const macroTargetsSchema = z
  .object({
    protein: z.number().min(20).max(400),
    fat: z.number().min(10).max(300),
    carbohydrate: z.number().min(20).max(900),
    /** Allowed deviation from each target, in percent. */
    tolerancePct: z.union([z.literal(3), z.literal(5), z.literal(10)]).default(5),
  })
  .refine((m) => macroCalories(m) >= 1000 && macroCalories(m) <= 6000, "Calories from these macros must be between 1,000 and 6,000.");

export type MacroTargets = z.infer<typeof macroTargetsSchema>;
export type MacroId = "energy" | "protein" | "fat" | "carbohydrate";

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
  goalMode: z.enum(["balanced", "daily", "per_meal", "mixed"]).default("balanced"),
  strategy: z.enum(STRATEGY_KEYS as [StrategyKey, ...StrategyKey[]]).default("balanced"),
  reference: z
    .object({
      standard: z.enum(["fda_dv", "dri"]).default("fda_dv"),
      ageGroup: z.enum(["under_19", "19_30", "31_50", "51_70", "71_plus", "unspecified"]).default("unspecified"),
      sex: z.enum(["female", "male", "unspecified"]).default("unspecified"),
    })
    .default({ standard: "fda_dv", ageGroup: "unspecified", sex: "unspecified" }),
  /** Optional calorie range (adults only; ignored for people under 19). */
  energy: z
    .object({
      min: z.number().min(600).max(6000).nullable().default(null),
      max: z.number().min(600).max(6000).nullable().default(null),
    })
    .nullable()
    .default(null),
  proteinMin: z.number().min(10).max(300).nullable().default(null),
  macroTargets: macroTargetsSchema.nullable().default(null),
  mealShares: z.partialRecord(periodEnum, z.number().min(0.05).max(1)).optional(),
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
  maxItemsPerMeal: z.number().int().min(1).max(8).default(4),
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
    .array(z.object({ period: periodEnum, foodIds: z.array(z.string().max(100)).max(12) }))
    .max(5)
    .default([]),
});

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
  goalMode: GoalMode;
  referenceLabel: string;
  meals: PlanMeal[];
  targets: TargetSummary[];
  coverage: CoverageRow[];
  energy: { value: number | null; low: number | null; high: number | null; min: number | null; max: number | null; shown: boolean };
  /** Strict daily targets and how the plan compares, when they were used. */
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
