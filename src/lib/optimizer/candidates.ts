/**
 * Loads optimizer candidates from stored menus: the items served at the
 * chosen locations for each requested meal, after dietary filters.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { diningLocations, foods, menuDays, menuItems, type MealPeriod } from "@/db/schema";
import { formatDate } from "@/lib/dates";
import { perServingNutrients } from "@/lib/nutrition/food-nutrients";
import { normalizeUnit, servingLabel } from "@/lib/nutrition/units";
import { MEAL_PERIOD_LABELS } from "@/lib/menus/types";
import { checkFood, isPlantLabeled, isPreferred, summarizeReasons, type FilterVerdict } from "./filters";
import type { Candidate, MealCandidates } from "./model";
import type { PlanRequest } from "./types";

const HALF_STEP_UNITS = new Set([
  "cup",
  "cups",
  "oz",
  "ounce",
  "ounces",
  "fl oz",
  "g",
  "gram",
  "grams",
  "ml",
  "tbsp",
  "tsp",
  "scoop",
  "scoops",
  "ladle",
  "portion",
  "serving",
  "servings",
  "bowl",
  "spoonful",
]);

export function servingStep(unit: string | null): number {
  return HALF_STEP_UNITS.has(normalizeUnit(unit)) ? 0.5 : 1;
}

/** One published serving at or above these is a batch/bulk record, not a plate portion. */
export const BULK_SERVING_GRAMS = 450;
export const BULK_SERVING_KCAL = 1000;

/**
 * Real menu feeds sometimes list recipe components with bulk servings (e.g. "1 lbs",
 * 1,200+ kcal). They stay on menus, but automatic plans skip them. Returns a reason, or null.
 */
export function bulkPortionReason(servingGrams: number | null, kcal: number | null, unit: string | null): string | null {
  const u = normalizeUnit(unit);
  if ((servingGrams !== null && servingGrams >= BULK_SERVING_GRAMS) || u === "lb" || u === "lbs" || u === "pound" || u === "pounds") {
    return "bulk serving size (about a pound or more)";
  }
  if (kcal !== null && kcal >= BULK_SERVING_KCAL) return "very large serving (1,000+ kcal)";
  return null;
}

/**
 * With keepFiltered, items that fail the dietary filters are returned too,
 * marked with the reasons (used by the manual "choose from the menu" picker).
 */
export async function loadCandidates(db: Db, req: PlanRequest, opts: { keepFiltered?: boolean } = {}): Promise<MealCandidates[]> {
  const periods = req.meals.map((m) => m.period) as MealPeriod[];
  const rows = await db
    .select({
      period: menuDays.period,
      status: menuDays.status,
      locationId: menuDays.locationId,
      locationName: diningLocations.name,
      foodId: foods.id,
      lineageKey: foods.lineageKey,
      name: foods.name,
      station: menuItems.station,
      servingAmount: foods.servingAmount,
      servingUnit: foods.servingUnit,
      servingGrams: foods.servingGrams,
      official: foods.official,
      estimate: foods.estimate,
      ingredients: foods.ingredients,
      allergens: foods.allergens,
      dietaryLabels: foods.dietaryLabels,
    })
    .from(menuDays)
    .innerJoin(diningLocations, eq(diningLocations.id, menuDays.locationId))
    .leftJoin(menuItems, eq(menuItems.menuDayId, menuDays.id))
    .leftJoin(foods, eq(foods.id, menuItems.foodId))
    .where(
      and(
        eq(menuDays.universityId, req.universityId),
        eq(menuDays.date, req.date),
        inArray(menuDays.period, periods),
        eq(diningLocations.isActive, true),
      ),
    );

  const excluded = new Set(req.excluded.map((e) => `${e.period}:${e.foodId}`));
  // Items the user locked stay available even if they fall outside the filters (they chose them).
  const locked = new Set(req.locks.map((l) => `${l.period}:${l.foodId}`));
  const dateText = formatDate(req.date, "medium");

  return req.meals.map((meal) => {
    const label = MEAL_PERIOD_LABELS[meal.period];
    const selected = new Set(meal.locationIds);
    const forMeal = rows.filter((r) => r.period === meal.period && (!selected.size || selected.has(r.locationId)));
    const serving = forMeal.filter((r) => r.status === "available" && r.foodId);
    const verdicts: FilterVerdict[] = [];
    const seen = new Set<string>();
    const candidates: Candidate[] = [];
    for (const r of serving) {
      if (!r.foodId || !r.name) continue;
      const key = `${r.locationId}|${r.foodId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (excluded.has(`${meal.period}:${r.foodId}`)) continue;
      const food = {
        name: r.name,
        ingredients: r.ingredients ?? null,
        allergens: r.allergens ?? [],
        dietaryLabels: r.dietaryLabels ?? [],
      };
      const verdict = checkFood(food, req.preferences);
      const isLocked = locked.has(`${meal.period}:${r.foodId}`);
      const servingGrams = r.estimate?.servingGrams?.value ?? r.servingGrams ?? null;
      const nutrients = perServingNutrients({ estimate: r.estimate ?? null, official: r.official ?? {} });
      const bulk = bulkPortionReason(servingGrams, nutrients.energy?.value ?? null, r.servingUnit ?? null);
      if (bulk && !isLocked) {
        // Shown on menus and in the picker, but never chosen automatically.
        if (!opts.keepFiltered) continue;
        verdict.reasons = [...verdict.reasons, bulk];
      }
      if (!verdict.ok) {
        verdicts.push(verdict);
        if (!opts.keepFiltered && !isLocked) continue;
      }
      candidates.push({
        foodId: r.foodId,
        lineageKey: r.lineageKey ?? r.foodId,
        name: r.name,
        station: r.station ?? null,
        period: meal.period,
        locationId: r.locationId,
        locationName: r.locationName,
        servingLabel: servingLabel(r.servingAmount, r.servingUnit),
        servingGrams,
        step: servingStep(r.servingUnit ?? null),
        nutrients,
        confidence: r.estimate?.overallConfidence ?? "none",
        allergens: food.allergens,
        dietaryLabels: food.dietaryLabels,
        preferred: isPreferred(food, req.preferences),
        plant: isPlantLabeled(food),
        ...(opts.keepFiltered ? { conflicts: verdict.reasons } : {}),
      });
    }

    let unavailableNote: string | null = null;
    if (!candidates.length) {
      const locs = [...new Set(forMeal.map((r) => r.locationName))];
      const closed = forMeal.filter((r) => r.status === "closed").map((r) => r.locationName);
      if (!forMeal.length) {
        unavailableNote = `${label} on ${dateText}: no menu has been published or imported for the selected locations.`;
      } else if (serving.length && verdicts.length) {
        unavailableNote = `${label} on ${dateText}: every item at ${locs.join(", ")} was removed by your dietary filters.`;
      } else if (closed.length === new Set(forMeal.map((r) => r.locationId)).size) {
        unavailableNote = `${label} on ${dateText}: ${[...new Set(closed)].join(", ")} ${closed.length === 1 ? "is" : "are"} closed.`;
      } else {
        unavailableNote = `${label} on ${dateText}: no menu items are available at the selected locations.`;
      }
    }
    return {
      period: meal.period,
      candidates,
      unavailableNote,
      filteredOut: verdicts.length,
      filterSummary: summarizeReasons(verdicts),
    };
  });
}
