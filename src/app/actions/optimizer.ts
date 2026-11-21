"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getSessionUser } from "@/lib/auth";
import { getUniversity } from "@/lib/data/catalog";
import { addPlanItemsToDiary, getPlan, savePlan } from "@/lib/data/user";
import { todayIn } from "@/lib/dates";
import { generatePlan, PlanRequestError } from "@/lib/optimizer";
import { loadCandidates } from "@/lib/optimizer/candidates";
import { evaluatePlan, modelStatsSchema, planSelectionSchema } from "@/lib/optimizer/evaluate";
import {
  dietaryPreferencesSchema,
  PLAN_PERIODS,
  planRequestSchema,
  STRATEGY_KEYS,
  type MenuChoice,
  type PlanRequest,
  type PlanResult,
  type StrategyKey,
} from "@/lib/optimizer/types";
import { clientFingerprint, rateLimit } from "@/lib/rate-limit";
import { errorMessage, fail, ok, type ActionResult } from "./result";

const SIGN_IN = "Sign in to keep meal plans and use the food diary.";
const SLOW_DOWN = "That's a lot of requests in a few minutes. Please wait a little and try again.";

/** Per-user (or per-hashed-address for guests) fixed-window limits. */
async function allowed(bucket: string, guestLimit: number, userLimit: number, windowSeconds = 600) {
  const user = await getSessionUser();
  const key = user ? `${bucket}:u:${user.id}` : `${bucket}:g:${await clientFingerprint()}`;
  const r = await rateLimit(key, user ? userLimit : guestLimit, windowSeconds);
  return { user, ok: r.ok };
}

/** Validates a request. Calorie and macro targets are only ever the ones the person entered. */
function sanitize(input: unknown): PlanRequest {
  return planRequestSchema.parse(input);
}

export async function generatePlanAction(input: unknown): Promise<ActionResult<{ request: PlanRequest; result: PlanResult }>> {
  try {
    const gate = await allowed("opt", 30, 90);
    if (!gate.ok) return fail(SLOW_DOWN);
    const request = sanitize(input);
    const result = await generatePlan(request);
    return ok({ request, result });
  } catch (e) {
    if (e instanceof PlanRequestError) return fail(e.message);
    return fail(errorMessage(e, "Couldn't build a plan right now. Please try again."));
  }
}

/** Solves the same request with each other strategy, for side-by-side comparison. */
export async function compareStrategiesAction(
  input: unknown,
): Promise<ActionResult<{ strategy: StrategyKey; request: PlanRequest; result: PlanResult }[]>> {
  try {
    const gate = await allowed("optcmp", 6, 20);
    if (!gate.ok) return fail(SLOW_DOWN);
    const base = sanitize(input);
    const out: { strategy: StrategyKey; request: PlanRequest; result: PlanResult }[] = [];
    // One at a time: the embedded database handles one connection.
    for (const strategy of STRATEGY_KEYS) {
      if (strategy === base.strategy) continue;
      const request = { ...base, strategy, avoidSignatures: [], freshMeals: [] };
      try {
        out.push({ strategy, request, result: await generatePlan(request) });
      } catch (e) {
        if (!(e instanceof PlanRequestError)) console.error(e);
      }
    }
    return ok(out);
  } catch (e) {
    if (e instanceof PlanRequestError) return fail(e.message);
    return fail(errorMessage(e, "Couldn't compare strategies right now."));
  }
}

const choicesSchema = z.object({
  universityId: z.string().min(1).max(100),
  date: z.string().min(10).max(10),
  period: z.enum(PLAN_PERIODS),
  locationId: z.string().min(1).max(200).nullable(),
  preferences: dietaryPreferencesSchema,
});

/** Everything on the stored menu for one meal (optionally one location), with filter conflicts marked. */
export async function menuChoicesAction(input: unknown): Promise<ActionResult<MenuChoice[]>> {
  try {
    const gate = await allowed("optmenu", 120, 240);
    if (!gate.ok) return fail(SLOW_DOWN);
    const q = choicesSchema.parse(input);
    const req = planRequestSchema.parse({
      universityId: q.universityId,
      date: q.date,
      meals: [{ period: q.period, locationIds: q.locationId ? [q.locationId] : [] }],
      preferences: q.preferences,
    });
    const [meal] = await loadCandidates(await getDb(), req, { keepFiltered: true });
    const choices: MenuChoice[] = (meal?.candidates ?? []).map((c) => ({
      foodId: c.foodId,
      name: c.name,
      station: c.station,
      locationId: c.locationId,
      locationName: c.locationName,
      step: c.step,
      servingLabel: c.servingLabel,
      servingGrams: c.servingGrams,
      nutrients: c.nutrients,
      confidence: c.confidence,
      allergens: c.allergens,
      dietaryLabels: c.dietaryLabels,
      conflicts: c.conflicts ?? [],
    }));
    return ok(choices);
  } catch (e) {
    return fail(errorMessage(e, "Couldn't load that menu."));
  }
}

const saveSchema = z.object({
  request: z.unknown(),
  meals: planSelectionSchema,
  stats: modelStatsSchema,
  edited: z.boolean().default(false),
  name: z.string().trim().max(80).optional(),
});

function revalidateUserPages() {
  revalidatePath("/history");
  revalidatePath("/dashboard");
  revalidatePath("/diary");
}

/**
 * Saves a plan to the user's history. The stored result is rebuilt on the
 * server from menu data, so what's saved never depends on numbers sent by
 * the browser.
 */
export async function savePlanAction(input: unknown): Promise<ActionResult<{ id: string; result: PlanResult }>> {
  const user = await getSessionUser();
  if (!user) return fail(SIGN_IN);
  try {
    const limit = await rateLimit(`plansave:${user.id}`, 60, 600);
    if (!limit.ok) return fail(SLOW_DOWN);
    const data = saveSchema.parse(input);
    const request = sanitize(data.request);
    if (!(await getUniversity(request.universityId))) return fail("Unknown university.");
    const result = await evaluatePlan(request, data.meals, data.stats, data.edited);
    if (!result.meals.some((m) => m.items.length)) return fail("This plan has no items to save.");
    const id = await savePlan(user.id, request, result, data.name || undefined);
    revalidateUserPages();
    return ok({ id, result }, "Plan saved");
  } catch (e) {
    return fail(errorMessage(e, "Couldn't save this plan."));
  }
}

const diarySchema = z.object({
  universityId: z.string().min(1).max(100),
  date: z.string().min(10).max(10),
  meals: planSelectionSchema,
  status: z.enum(["planned", "logged"]).default("planned"),
  planId: z.string().max(100).nullable().default(null),
});

/** Adds the plan's items to the diary, as planned (default) or as eaten. */
export async function addPlanToDiaryAction(input: unknown): Promise<ActionResult<number>> {
  const user = await getSessionUser();
  if (!user) return fail(SIGN_IN);
  try {
    const limit = await rateLimit(`plandiary:${user.id}`, 60, 600);
    if (!limit.ok) return fail(SLOW_DOWN);
    const data = diarySchema.parse(input);
    const university = await getUniversity(data.universityId);
    if (!university) return fail("Unknown university.");
    if (data.status === "logged" && data.date > todayIn(university.timezone)) {
      return fail("Future meals can be added as planned, not as eaten.");
    }
    const planId = data.planId && (await getPlan(user.id, data.planId)) ? data.planId : null;
    // Location names come from the stored menu, not from the browser.
    const evaluated = await evaluatePlan(
      planRequestSchema.parse({ universityId: data.universityId, date: data.date, meals: data.meals.map((m) => ({ period: m.period })) }),
      data.meals,
      null,
      true,
    );
    const added = await addPlanItemsToDiary(
      user.id,
      {
        date: data.date,
        meals: evaluated.meals
          .filter((m) => m.items.length)
          .map((m) => ({ period: m.period, locationName: m.locationName, items: m.items.map((i) => ({ foodId: i.foodId, servings: i.servings })) })),
      },
      data.status,
      planId,
    );
    if (!added) return fail("None of these items could be added. The menu may have changed.");
    revalidateUserPages();
    return ok(added);
  } catch (e) {
    return fail(errorMessage(e, "Couldn't add this plan to your diary."));
  }
}
