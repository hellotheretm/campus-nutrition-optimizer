/**
 * Re-evaluates a plan the user edited (changed servings, swapped or added
 * items) using only stored menu data. Nothing from the browser is trusted
 * except which foods were chosen and how many servings: names, nutrients,
 * confidence and allergens are reloaded from the database, and every item
 * must be on the stored menu for that date, meal and location.
 */
import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import { loadCandidates } from "./candidates";
import { computeCoverage, dayLines, energyTotal, explainItems, ulWarnings } from "./coverage";
import { macroTargetRows, modelNotes, planSignature, summarizePlan } from "./model";
import { buildTargets, nutrientName } from "./targets";
import { MAX_ITEMS_NO_LIMIT, MAX_MEALS, mealKeySchema, mealLabels, PLAN_PERIODS, type DiaryBaseline, type PlanItem, type PlanMeal, type PlanRequest, type PlanResult } from "./types";

export const planSelectionSchema = z
  .array(
    z.object({
      /** Older saved plans have no key; the period stands in. */
      key: mealKeySchema.optional(),
      period: z.enum(PLAN_PERIODS),
      locationId: z.string().min(1).max(200).nullable(),
      items: z
        .array(
          z.object({
            foodId: z.string().min(1).max(100),
            servings: z.number().min(0.5).max(6),
            locked: z.boolean().default(false),
          }),
        )
        .max(MAX_ITEMS_NO_LIMIT),
    }),
  )
  .min(1)
  .max(MAX_MEALS);

export type PlanSelection = z.infer<typeof planSelectionSchema>;

/** Solver statistics from the run that produced the plan (display only). */
export const modelStatsSchema = z
  .object({
    candidates: z.number().int().min(0).max(100_000),
    variables: z.number().int().min(0).max(1_000_000),
    constraints: z.number().int().min(0).max(1_000_000),
    solveMs: z.number().min(0).max(600_000),
    objective: z.number().nullable(),
  })
  .nullable()
  .default(null);

export type ModelStats = z.infer<typeof modelStatsSchema>;

export async function evaluatePlan(
  req: PlanRequest,
  selection: PlanSelection,
  stats: ModelStats,
  edited: boolean,
  diary: DiaryBaseline | null = null,
): Promise<PlanResult> {
  const keys = selection.map((s) => s.key ?? s.period);
  if (new Set(keys).size !== keys.length) throw new Error("Each meal can only appear once.");
  // Calorie shares chosen for each meal in the request (by key), kept for the evaluated plan.
  const calories = new Map(req.meals.map((m) => [m.key, m.calories]));
  const mealsReq = selection.map((s, i) => ({
    key: keys[i],
    period: s.period,
    locationIds: s.locationId ? [s.locationId] : [],
    calories: calories.get(keys[i]) ?? null,
  }));
  const labels = mealLabels(mealsReq);
  const db = await getDb();
  const evalReq = { ...req, meals: mealsReq, excluded: [] };
  const candidateMeals = await loadCandidates(db, evalReq, { keepFiltered: true });
  const targets = buildTargets(evalReq, diary);
  const warnings: string[] = [];

  const meals: PlanMeal[] = selection.map((sel, i) => {
    const pool = candidateMeals[i].candidates.filter((c) => !sel.locationId || c.locationId === sel.locationId);
    const items: PlanItem[] = [];
    for (const pick of sel.items) {
      const c = pool.find((x) => x.foodId === pick.foodId);
      if (!c) {
        warnings.push(`${labels[keys[i]]}: one item is no longer on the stored menu and was left out.`);
        continue;
      }
      if (items.some((x) => x.foodId === c.foodId)) continue;
      const servings = Math.round(pick.servings * 2) / 2;
      if (c.conflicts?.length) warnings.push(`${c.name} doesn't match your preferences (${c.conflicts.slice(0, 2).join("; ")}).`);
      items.push({
        foodId: c.foodId,
        name: c.name,
        station: c.station,
        servings,
        step: Number.isInteger(servings) ? c.step : 0.5,
        maxServings: Math.max(req.maxServingsPerItem, servings),
        servingLabel: c.servingLabel,
        servingGrams: c.servingGrams,
        gramsExact: c.gramsExact,
        nutrients: c.nutrients,
        confidence: c.confidence,
        allergens: c.allergens,
        dietaryLabels: c.dietaryLabels,
        locked: pick.locked,
        why: [],
      });
    }
    const first = pool.find((c) => items.some((x) => x.foodId === c.foodId));
    if (!items.length) {
      return {
        key: keys[i],
        label: labels[keys[i]],
        period: sel.period,
        status: "unavailable",
        locationId: null,
        locationName: null,
        items,
        note: `${labels[keys[i]]}: no items in this meal.`,
        candidates: pool.length,
      };
    }
    return {
      key: keys[i],
      label: labels[keys[i]],
      period: sel.period,
      status: "planned",
      locationId: first?.locationId ?? sel.locationId,
      locationName: first?.locationName ?? null,
      items,
      note: null,
      candidates: pool.length,
    };
  });

  explainItems(meals, targets.summary);
  const lines = dayLines(meals, diary);
  const coverage = computeCoverage(lines, targets.summary);
  for (const u of ulWarnings(coverage, lines)) {
    warnings.push(`At the high end of the estimates, ${nutrientName(u.id)} could pass its upper intake level. Consider fewer servings of the items richest in it.`);
  }
  const e = energyTotal(lines);
  const macroRows = targets.macros ? macroTargetRows(meals, targets.macros, diary) : null;
  const energyRow = macroRows?.find((r) => r.id === "energy");

  return {
    status: meals.some((m) => m.items.length) ? "feasible" : "infeasible",
    universityId: req.universityId,
    date: req.date,
    strategy: req.strategy,
    referenceLabel: targets.profile.label,
    meals,
    targets: targets.summary,
    coverage,
    energy: {
      ...e,
      min: energyRow?.min ?? null,
      max: energyRow?.max ?? null,
      shown: true,
    },
    macroTargets: macroRows,
    diary,
    summary: summarizePlan(meals, coverage),
    warnings: [...new Set([...warnings, ...targets.notes])],
    infeasibility: meals.some((m) => m.items.length) ? null : { reasons: ["The plan has no items."], suggestions: ["Generate a new plan or add items from the menu."] },
    model: {
      solver: "HiGHS (mixed-integer programming)",
      candidates: stats?.candidates ?? 0,
      variables: stats?.variables ?? 0,
      constraints: stats?.constraints ?? 0,
      solveMs: stats?.solveMs ?? 0,
      objective: edited ? null : (stats?.objective ?? null),
      notes: [
        ...(edited ? ["You edited this plan after it was generated. Totals were recalculated from the stored menu data."] : []),
        ...modelNotes(req.strategy),
      ],
    },
    signature: planSignature(meals),
    generatedAt: new Date().toISOString(),
    edited,
  };
}
