"use server";

import { refresh } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { addPlanItemsToDiary, deletePlan, getPlan } from "@/lib/data/user";
import type { PlanResult } from "@/lib/optimizer/types";
import { errorMessage, fail, ok, type ActionResult } from "./result";

const SIGN_IN = "Sign in to keep meal plans.";

export async function deletePlanAction(id: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail(SIGN_IN);
  try {
    const removed = await deletePlan(user.id, String(id));
    if (!removed) return fail("That plan no longer exists.");
    refresh();
    return ok(null);
  } catch (e) {
    return fail(errorMessage(e, "Couldn't delete that plan."));
  }
}

/** Copies a saved plan's items into the diary (as planned by default). */
export async function addSavedPlanToDiaryAction(id: string, status: "planned" | "logged" = "planned"): Promise<ActionResult<number>> {
  const user = await getSessionUser();
  if (!user) return fail(SIGN_IN);
  try {
    const row = await getPlan(user.id, String(id));
    if (!row) return fail("That plan no longer exists.");
    const result = row.result as unknown as PlanResult;
    const added = await addPlanItemsToDiary(
      user.id,
      {
        date: row.date,
        meals: result.meals
          .filter((m) => m.status === "planned")
          .map((m) => ({ period: m.period, locationName: m.locationName, items: m.items.map((i) => ({ foodId: i.foodId, servings: i.servings })) })),
      },
      status === "logged" ? "logged" : "planned",
      row.id,
    );
    refresh();
    return ok(added);
  } catch (e) {
    return fail(errorMessage(e, "Couldn't add that plan to your diary."));
  }
}
