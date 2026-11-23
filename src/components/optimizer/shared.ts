/**
 * Types and pure helpers shared by the optimizer page and its client
 * components (no server imports).
 */
import type { MenuDayStatus } from "@/db/schema";
import type { NutrientId } from "@/lib/nutrition/nutrients";
import type { AgeGroup, ReferenceSex, ReferenceStandard } from "@/lib/nutrition/references";
import { computeCoverage, dayLines, energyTotal, ulWarnings } from "@/lib/optimizer/coverage";
import { allotMealCalories } from "@/lib/optimizer/targets";
import type {
  CoverageRow,
  DietFilterInput,
  DiaryMode,
  MacroTargetsInput,
  MealCalorieMode,
  MenuChoice,
  PlanItem,
  PlanMeal,
  PlanPeriod,
  PlanRequest,
  PlanResult,
  StrategyKey,
} from "@/lib/optimizer/types";
import {
  DIARY_MODES,
  dietaryPreferencesSchema,
  MAX_ITEMS_NO_LIMIT,
  MAX_MEALS,
  MEAL_CALORIE_MODES,
  MEAL_CALORIES_MAX,
  MEAL_CALORIES_MIN,
  mealKeySchema,
  PLAN_PERIODS,
  resolveMacroTargets,
  STRATEGY_KEYS,
} from "@/lib/optimizer/types";
import { z } from "zod";

export interface PeriodAvailability {
  period: PlanPeriod;
  label: string;
  locations: { id: string; name: string; status: MenuDayStatus | "missing"; itemCount: number; hours: string | null }[];
}

export interface OptimizerUniversity {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  isDemo: boolean;
  autoSyncAllowed: boolean;
  integrationStatus: string;
  menuSourceUrl: string | null;
}

export interface OptimizerDefaults {
  reference: { standard: ReferenceStandard; ageGroup: AgeGroup; sex: ReferenceSex };
  preferences: DietFilterInput;
  /** Daily targets saved in Settings (all blank when none). */
  targets: MacroTargetsInput;
}

/** Totals of what's in the diary for the plan's date (signed-in users), for "all" and "logged" entries. */
export interface DiaryCounts {
  entries: number;
  energy: number | null;
  protein: number | null;
  fat: number | null;
  carbohydrate: number | null;
}
export interface DiarySummary {
  all: DiaryCounts;
  logged: DiaryCounts;
}

export interface SavedPlanView {
  id: string;
  name: string | null;
  request: PlanRequest;
  result: PlanResult;
}

export const EMPTY_TARGETS: MacroTargetsInput = { energy: null, protein: null, fat: null, carbohydrate: null, tolerancePct: 5 };

/** One meal to plan. Several meals may share a period (two lunches at different markets). */
export interface MealInput {
  key: string;
  period: PlanPeriod;
  /** Empty: any market serving this meal. */
  locationIds: string[];
  /** Calories for this meal when calories are split per meal (blank shares what's left). */
  calories: number | null;
}

export interface Inputs {
  meals: MealInput[];
  /** How the day's calories are split over the meals (only with a calorie target). */
  mealCalories: MealCalorieMode;
  /** Which diary entries count toward the day (signed-in users). */
  diary: DiaryMode;
  strategy: StrategyKey;
  reference: OptimizerDefaults["reference"];
  /** Optional daily calorie and macro targets. */
  targets: MacroTargetsInput;
  preferences: DietFilterInput;
  maxItemsPerMeal: number;
  maxServingsPerItem: number;
  focus: NutrientId[];
}

/** The plan on screen: what the optimizer returned plus the user's edits. */
export interface Working {
  request: PlanRequest;
  result: PlanResult;
  meals: PlanMeal[];
  edited: boolean;
  /** Signatures already shown, so "another option" never repeats one. */
  seen: string[];
  planId: string | null;
  savedName: string | null;
  /** Earlier versions of each meal (food ids, by meal key), so "New breakfast" doesn't cycle back. */
  mealHistory?: Record<string, string[][]>;
}

export const servable = (a: PeriodAvailability) => a.locations.filter((l) => l.status === "available" && l.itemCount > 0);

const meal = (period: PlanPeriod, key: string = period): MealInput => ({ key, period, locationIds: [], calories: null });

/** Breakfast, lunch and dinner when served (brunch replaces breakfast on days without it). Late night is opt-in. */
export function defaultMeals(availability: PeriodAvailability[]): MealInput[] {
  const has = (p: PlanPeriod) => servable(availability.find((a) => a.period === p)!).length > 0;
  const out: MealInput[] = [];
  if (has("breakfast")) out.push(meal("breakfast"));
  else if (has("brunch")) out.push(meal("brunch"));
  if (has("lunch")) out.push(meal("lunch"));
  if (has("dinner")) out.push(meal("dinner"));
  return out.length ? out : [meal("lunch")];
}

/** A new meal of the given period, with a key no other meal uses. */
export function newMeal(meals: MealInput[], period: PlanPeriod): MealInput {
  const used = new Set(meals.map((m) => m.key));
  if (!used.has(period)) return meal(period);
  let n = 2;
  while (used.has(period + "-" + n)) n++;
  return meal(period, period + "-" + n);
}

/** Meals in the order of the day (by period; meals of the same period keep the order they were added). */
export function orderMeals<T extends { period: string }>(meals: T[]): T[] {
  return meals
    .map((m, i) => ({ m, i }))
    .sort((a, b) => periodIndex(a.m.period) - periodIndex(b.m.period) || a.i - b.i)
    .map((x) => x.m);
}

export function inputsFromRequest(req: PlanRequest, availability: PeriodAvailability[]): Inputs {
  void availability;
  return {
    meals: req.meals.map((m) => ({ key: m.key, period: m.period, locationIds: m.locationIds, calories: m.calories ?? null })),
    mealCalories: req.mealCalories ?? "flexible",
    diary: req.diary ?? "all",
    strategy: req.strategy,
    reference: req.reference,
    targets: req.macroTargets ? { ...EMPTY_TARGETS, ...req.macroTargets } : EMPTY_TARGETS,
    preferences: req.preferences,
    maxItemsPerMeal: req.maxItemsPerMeal,
    maxServingsPerItem: req.maxServingsPerItem,
    focus: req.focus as NutrientId[],
  };
}

export interface CalorieBudget {
  /** The day's calorie target (set, or worked out from macro targets), or null without one. */
  dayTarget: number | null;
  /** Calories already in the diary that count toward the day. */
  diaryKcal: number;
  /** What's left for the planned meals, or null without a target. */
  left: number | null;
  /** Calories for each meal (by key) when they're split evenly or per meal. */
  perMeal: Record<string, number>;
  tolerance: number;
  error: string | null;
}

/** The same calorie math the server uses, for showing shares and catching mistakes before planning. */
export function calorieBudget(inputs: Inputs, availability: PeriodAvailability[], diary: DiarySummary | null): CalorieBudget {
  const resolved = resolveMacroTargets(inputs.targets);
  const dayTarget = !resolved.error && resolved.targets.energy !== undefined ? resolved.targets.energy : null;
  const counted = diary && inputs.diary !== "none" ? diary[inputs.diary] : null;
  const diaryKcal = counted?.energy ?? 0;
  const tolerance = inputs.targets.tolerancePct / 100;
  if (dayTarget === null) return { dayTarget, diaryKcal, left: null, perMeal: {}, tolerance, error: null };
  const left = dayTarget - diaryKcal;
  const fmt = (v: number) => `${Math.round(v).toLocaleString("en-US")} kcal`;
  if (left <= 0) {
    return {
      dayTarget,
      diaryKcal,
      left,
      perMeal: {},
      tolerance,
      error: `Your diary already has ${fmt(diaryKcal)} for this day, at or above your ${fmt(dayTarget)} target. Plan another day, or don't count the diary.`,
    };
  }
  const open = inputs.meals.filter((m) => servable(availability.find((a) => a.period === m.period)!).length > 0);
  const allot = allotMealCalories(
    inputs.mealCalories,
    left,
    open.map((m) => ({ key: m.key, calories: inputs.mealCalories === "custom" ? m.calories : null })),
    tolerance,
  );
  return { dayTarget, diaryKcal, left, perMeal: allot.targets, tolerance, error: allot.error };
}

/** A meal's key (older saved plans have none; the period stands in). */
export const keyOf = (m: { key?: string; period: string }) => m.key ?? m.period;

export function lockedOf(meals: PlanMeal[], filter: (m: PlanMeal, i: PlanItem) => boolean = (_m, i) => i.locked) {
  return meals.flatMap((m) => m.items.filter((i) => filter(m, i)).map((i) => ({ meal: keyOf(m), foodId: i.foodId, servings: i.servings })));
}

export function selectionOf(meals: PlanMeal[]) {
  return meals
    .filter((m) => m.items.length)
    .map((m) => ({
      key: keyOf(m),
      period: m.period as PlanPeriod,
      locationId: m.locationId,
      items: m.items.map((i) => ({ foodId: i.foodId, servings: i.servings, locked: i.locked })),
    }));
}

/** The day's totals as edited: the plan's items plus the diary food the plan was built around. */
export function liveTotals(meals: PlanMeal[], result: PlanResult) {
  const lines = dayLines(meals.filter((m) => m.items.length), result.diary);
  const coverage = computeCoverage(lines, result.targets);
  return { lines, coverage, energy: energyTotal(lines), uls: ulWarnings(coverage, lines) };
}

/** Goals met after the conservative discount (the same test the optimizer uses). */
export function goalsMet(rows: CoverageRow[]): { met: number; total: number } {
  const goals = rows.filter((r) => r.kind === "goal" && r.amount);
  return { met: goals.filter((r) => (r.conservative ?? 0) >= (r.amount ?? Infinity)).length, total: goals.length };
}

export function itemFromChoice(c: MenuChoice, servings: number, maxServings: number): PlanItem {
  return {
    foodId: c.foodId,
    name: c.name,
    station: c.station,
    servings,
    step: c.step,
    maxServings,
    servingLabel: c.servingLabel,
    servingGrams: c.servingGrams,
      gramsExact: c.gramsExact,
    nutrients: c.nutrients,
    confidence: c.confidence,
    allergens: c.allergens,
    dietaryLabels: c.dietaryLabels,
    locked: true,
    why: ["Added by you"],
  };
}

export const periodIndex = (p: string) => PLAN_PERIODS.indexOf(p as PlanPeriod);

// v3: meals are a list (any number, any period) with calorie shares; diary counting added.
const STORAGE_KEY = "cno:optimizer:settings:v3";
const storedSchema = z
  .object({
    strategy: z.enum(STRATEGY_KEYS as [StrategyKey, ...StrategyKey[]]),
    reference: z.object({
      standard: z.enum(["fda_dv", "dri"]),
      ageGroup: z.enum(["under_19", "19_30", "31_50", "51_70", "71_plus", "unspecified"]),
      sex: z.enum(["female", "male", "unspecified"]),
    }),
    targets: z.object({
      energy: z.number().min(0).max(10000).nullable(),
      protein: z.number().min(0).max(1000).nullable(),
      fat: z.number().min(0).max(1000).nullable(),
      carbohydrate: z.number().min(0).max(2000).nullable(),
      tolerancePct: z.union([z.literal(3), z.literal(5), z.literal(10)]),
    }),
    preferences: dietaryPreferencesSchema,
    maxItemsPerMeal: z.number().int().min(1).max(MAX_ITEMS_NO_LIMIT),
    maxServingsPerItem: z.number().min(1).max(3),
    focus: z.array(z.string().max(40)).max(8),
    meals: z
      .array(
        z.object({
          key: mealKeySchema,
          period: z.enum(PLAN_PERIODS),
          locationIds: z.array(z.string().max(200)).max(20),
          calories: z.number().min(MEAL_CALORIES_MIN).max(MEAL_CALORIES_MAX).nullable(),
        }),
      )
      .min(1)
      .max(MAX_MEALS)
      .refine((ms) => new Set(ms.map((m) => m.key)).size === ms.length),
    mealCalories: z.enum(MEAL_CALORIE_MODES),
    diary: z.enum(DIARY_MODES),
  })
  .partial();

type Stored = z.infer<typeof storedSchema>;

/**
 * Settings are remembered in this browser only: guests in localStorage,
 * signed-in users for this tab (their defaults live in Settings). Every
 * access is guarded because storage can be unavailable.
 */
function storage(persistent: boolean): Storage | null {
  try {
    return persistent ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadStoredSettings(persistent: boolean): Stored | null {
  try {
    const raw = storage(persistent)?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function storeSettings(inputs: Inputs, persistent: boolean): void {
  try {
    storage(persistent)?.setItem(STORAGE_KEY, JSON.stringify(inputs));
  } catch {
    /* storage unavailable: settings simply aren't remembered */
  }
}

export function clearStoredSettings(persistent: boolean): void {
  try {
    storage(persistent)?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Restores remembered settings. Signed-in users' daily targets always come from Settings, never from storage. */
export function applyStored(prev: Inputs, s: Stored, signedIn: boolean): Inputs {
  return {
    ...prev,
    ...s,
    targets: signedIn ? prev.targets : (s.targets ?? prev.targets),
    meals: s.meals ?? prev.meals,
    focus: (s.focus ?? prev.focus) as NutrientId[],
    reference: s.reference ?? prev.reference,
    preferences: s.preferences ?? prev.preferences,
  };
}

export function initialInputs(defaults: OptimizerDefaults, availability: PeriodAvailability[]): Inputs {
  return {
    meals: defaultMeals(availability),
    mealCalories: "flexible",
    diary: "all",
    strategy: "balanced",
    reference: defaults.reference,
    targets: defaults.targets,
    preferences: defaults.preferences,
    maxItemsPerMeal: 4,
    maxServingsPerItem: 2,
    focus: [],
  };
}
