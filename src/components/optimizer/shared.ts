/**
 * Types and pure helpers shared by the optimizer page and its client
 * components (no server imports).
 */
import type { MenuDayStatus } from "@/db/schema";
import type { NutrientId } from "@/lib/nutrition/nutrients";
import type { AgeGroup, ReferenceSex, ReferenceStandard } from "@/lib/nutrition/references";
import { computeCoverage, energyTotal, planLines, ulWarnings } from "@/lib/optimizer/coverage";
import type { CoverageRow, DietFilterInput, MacroTargetsInput, MenuChoice, PlanItem, PlanMeal, PlanPeriod, PlanRequest, PlanResult, StrategyKey } from "@/lib/optimizer/types";
import { dietaryPreferencesSchema, PLAN_PERIODS, STRATEGY_KEYS } from "@/lib/optimizer/types";
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

export interface SavedPlanView {
  id: string;
  name: string | null;
  request: PlanRequest;
  result: PlanResult;
}

export const EMPTY_TARGETS: MacroTargetsInput = { energy: null, protein: null, fat: null, carbohydrate: null, tolerancePct: 5 };

export interface Inputs {
  meals: Record<PlanPeriod, { enabled: boolean; locationIds: string[] }>;
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
  /** Earlier versions of each meal (food ids), so "New breakfast" doesn't cycle back. */
  mealHistory?: Partial<Record<PlanPeriod, string[][]>>;
}

export const servable = (a: PeriodAvailability) => a.locations.filter((l) => l.status === "available" && l.itemCount > 0);

/** Breakfast, lunch and dinner when served (brunch replaces breakfast on days without it). Late night is opt-in. */
export function defaultMeals(availability: PeriodAvailability[]): Inputs["meals"] {
  const has = (p: PlanPeriod) => servable(availability.find((a) => a.period === p)!).length > 0;
  const out = Object.fromEntries(PLAN_PERIODS.map((p) => [p, { enabled: false, locationIds: [] as string[] }])) as Inputs["meals"];
  if (has("breakfast")) out.breakfast.enabled = true;
  else if (has("brunch")) out.brunch.enabled = true;
  if (has("lunch")) out.lunch.enabled = true;
  if (has("dinner")) out.dinner.enabled = true;
  return out;
}

export function inputsFromRequest(req: PlanRequest, availability: PeriodAvailability[]): Inputs {
  const meals = Object.fromEntries(PLAN_PERIODS.map((p) => [p, { enabled: false, locationIds: [] as string[] }])) as Inputs["meals"];
  for (const m of req.meals) meals[m.period] = { enabled: true, locationIds: m.locationIds };
  void availability;
  return {
    meals,
    strategy: req.strategy,
    reference: req.reference,
    targets: req.macroTargets ? { ...EMPTY_TARGETS, ...req.macroTargets } : EMPTY_TARGETS,
    preferences: req.preferences,
    maxItemsPerMeal: req.maxItemsPerMeal,
    maxServingsPerItem: req.maxServingsPerItem,
    focus: req.focus as NutrientId[],
  };
}

export function lockedOf(meals: PlanMeal[], filter: (m: PlanMeal, i: PlanItem) => boolean = (_m, i) => i.locked) {
  return meals.flatMap((m) => m.items.filter((i) => filter(m, i)).map((i) => ({ period: m.period as PlanPeriod, foodId: i.foodId, servings: i.servings })));
}

export function selectionOf(meals: PlanMeal[]) {
  return meals
    .filter((m) => m.items.length)
    .map((m) => ({
      period: m.period as PlanPeriod,
      locationId: m.locationId,
      items: m.items.map((i) => ({ foodId: i.foodId, servings: i.servings, locked: i.locked })),
    }));
}

export function liveTotals(meals: PlanMeal[], result: PlanResult) {
  const lines = planLines(meals.filter((m) => m.items.length));
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
    nutrients: c.nutrients,
    confidence: c.confidence,
    allergens: c.allergens,
    dietaryLabels: c.dietaryLabels,
    locked: true,
    why: ["Added by you"],
  };
}

export const periodIndex = (p: string) => PLAN_PERIODS.indexOf(p as PlanPeriod);

// v2: goal modes and the separate calorie range were replaced by one set of daily targets.
const STORAGE_KEY = "cno:optimizer:settings:v2";
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
    maxItemsPerMeal: z.number().int().min(1).max(8),
    maxServingsPerItem: z.number().min(1).max(3),
    focus: z.array(z.string().max(40)).max(8),
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
    const { meals: _meals, ...rest } = inputs;
    void _meals;
    storage(persistent)?.setItem(STORAGE_KEY, JSON.stringify(rest));
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

export function applyStored(prev: Inputs, s: Stored): Inputs {
  return {
    ...prev,
    ...s,
    focus: (s.focus ?? prev.focus) as NutrientId[],
    reference: s.reference ?? prev.reference,
    preferences: s.preferences ?? prev.preferences,
  };
}

export function initialInputs(defaults: OptimizerDefaults, availability: PeriodAvailability[]): Inputs {
  return {
    meals: defaultMeals(availability),
    strategy: "balanced",
    reference: defaults.reference,
    targets: defaults.targets,
    preferences: defaults.preferences,
    maxItemsPerMeal: 4,
    maxServingsPerItem: 2,
    focus: [],
  };
}
