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
import type { MealPeriod } from "@/db/schema";
import { MEAL_PERIOD_LABELS } from "@/lib/menus/types";
import { loadCandidates } from "./candidates";
import { computeCoverage, energyTotal, explainItems, planLines, ulWarnings } from "./coverage";
import { macroTargetRows, modelNotes, planSignature, summarizePlan } from "./model";
import { buildTargets, nutrientName } from "./targets";
import { PLAN_PERIODS, type PlanItem, type PlanMeal, type PlanRequest, type PlanResult } from "./types";

export const planSelectionSchema = z
  .array(
    z.object({
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
        .max(12),
    }),
  )
  .min(1)
  .max(5);

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

export async function evaluatePlan(req: PlanRequest, selection: PlanSelection, stats: ModelStats, edited: boolean): Promise<PlanResult> {
  const periods = selection.map((s) => s.period) as MealPeriod[];
  if (new Set(periods).size !== periods.length) throw new Error("Each meal can only appear once.");
  const db = await getDb();
  const candidateMeals = await loadCandidates(
    db,
    { ...req, meals: selection.map((s) => ({ period: s.period, locationIds: s.locationId ? [s.locationId] : [] })), excluded: [] },
    { keepFiltered: true },
  );
  const targets = buildTargets(req, periods);
  const warnings: string[] = [];

  const meals: PlanMeal[] = selection.map((sel, i) => {
    const pool = candidateMeals[i].candidates.filter((c) => !sel.locationId || c.locationId === sel.locationId);
    const items: PlanItem[] = [];
    for (const pick of sel.items) {
      const c = pool.find((x) => x.foodId === pick.foodId);
      if (!c) {
        warnings.push(`${MEAL_PERIOD_LABELS[sel.period]}: one item is no longer on the stored menu and was left out.`);
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
        period: sel.period,
        status: "unavailable",
        locationId: null,
        locationName: null,
        items,
        note: `${MEAL_PERIOD_LABELS[sel.period]}: no items in this meal.`,
        candidates: pool.length,
      };
    }
    return {
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
  const lines = planLines(meals);
  const coverage = computeCoverage(lines, targets.summary);
  for (const u of ulWarnings(coverage, lines)) {
    warnings.push(`At the high end of the estimates, ${nutrientName(u.id)} could pass its upper intake level. Consider fewer servings of the items richest in it.`);
  }
  const e = energyTotal(lines);
  const macroRows = targets.macros ? macroTargetRows(meals, targets.macros) : null;
  const energyRow = macroRows?.find((r) => r.id === "energy");

  return {
    status: lines.length ? "feasible" : "infeasible",
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
    summary: summarizePlan(meals, coverage),
    warnings: [...new Set([...warnings, ...targets.notes])],
    infeasibility: lines.length ? null : { reasons: ["The plan has no items."], suggestions: ["Generate a new plan or add items from the menu."] },
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
