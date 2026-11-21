"use server";

import { refresh } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import {
  addDiaryEntry,
  copyDiaryDay,
  createSavedMeal,
  deleteDiaryEntry,
  deleteSavedMeal,
  listFavorites,
  listSavedMeals,
  logFoodKey,
  logSavedMeal,
  saveMealFromEntries,
  toggleFavorite,
  updateDiaryEntry,
} from "@/lib/data/user";
import { errorMessage, fail, ok, type ActionResult } from "./result";

const SIGN_IN = "Sign in to use your food diary.";

export async function logFoodAction(
  input: unknown,
  opts: { refresh?: boolean } = {},
): Promise<ActionResult<{ id: string; name: string }>> {
  const user = await getSessionUser();
  if (!user) return fail(SIGN_IN);
  try {
    const entry = await addDiaryEntry(user.id, input);
    if (opts.refresh) refresh();
    return ok({ id: entry.id, name: entry.name });
  } catch (e) {
    return fail(errorMessage(e, "Couldn't add that food."));
  }
}

export async function updateDiaryEntryAction(id: string, patch: unknown): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail(SIGN_IN);
  try {
    const row = await updateDiaryEntry(user.id, String(id), patch);
    if (!row) return fail("That entry no longer exists.");
    refresh();
    return ok(null);
  } catch (e) {
    return fail(errorMessage(e, "Couldn't update that entry."));
  }
}

export async function deleteDiaryEntryAction(id: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail(SIGN_IN);
  try {
    await deleteDiaryEntry(user.id, String(id));
    refresh();
    return ok(null);
  } catch (e) {
    return fail(errorMessage(e, "Couldn't delete that entry."));
  }
}

export async function markEntriesAction(ids: string[], status: "logged" | "planned"): Promise<ActionResult<number>> {
  const user = await getSessionUser();
  if (!user) return fail(SIGN_IN);
  if (!Array.isArray(ids) || ids.length > 60) return fail("Too many entries.");
  try {
    let n = 0;
    for (const id of ids) if (await updateDiaryEntry(user.id, String(id), { status })) n++;
    refresh();
    return ok(n);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function copyDiaryDayAction(
  from: string,
  to: string,
  opts: { onlyLogged?: boolean; asStatus?: "logged" | "planned" } = {},
): Promise<ActionResult<number>> {
  const user = await getSessionUser();
  if (!user) return fail(SIGN_IN);
  try {
    const n = await copyDiaryDay(user.id, String(from), String(to), {
      onlyLogged: Boolean(opts.onlyLogged),
      asStatus: opts.asStatus === "logged" || opts.asStatus === "planned" ? opts.asStatus : undefined,
    });
    refresh();
    return ok(n);
  } catch (e) {
    return fail(errorMessage(e, "Couldn't copy that day."));
  }
}

export async function toggleFavoriteAction(foodKey: string, name: string): Promise<ActionResult<boolean>> {
  const user = await getSessionUser();
  if (!user) return fail("Sign in to save favorites.");
  try {
    return ok(await toggleFavorite(user.id, String(foodKey), String(name)));
  } catch (e) {
    return fail(errorMessage(e, "Couldn't update favorites."));
  }
}

export interface MyFoods {
  favorites: { foodKey: string; name: string }[];
  savedMeals: { id: string; name: string; items: { name: string; servings: number }[] }[];
}

export async function myFoodsAction(): Promise<ActionResult<MyFoods>> {
  const user = await getSessionUser();
  if (!user) return fail(SIGN_IN);
  const [favs, meals] = await Promise.all([listFavorites(user.id), listSavedMeals(user.id)]);
  return ok({
    favorites: favs.map((f) => ({ foodKey: f.foodKey, name: f.name })),
    savedMeals: meals.map((m) => ({
      id: m.id,
      name: m.name,
      items: m.items.map((i) => ({ name: i.name, servings: i.servings })),
    })),
  });
}

export async function createSavedMealAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await getSessionUser();
  if (!user) return fail("Sign in to save meals.");
  try {
    const row = await createSavedMeal(user.id, input);
    return ok({ id: row.id }, "Meal saved");
  } catch (e) {
    return fail(errorMessage(e, "Couldn't save that meal."));
  }
}

export async function deleteSavedMealAction(id: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return fail(SIGN_IN);
  try {
    await deleteSavedMeal(user.id, String(id));
    return ok(null);
  } catch (e) {
    return fail(errorMessage(e));
  }
}

export async function logSavedMealAction(
  id: string,
  date: string,
  meal: "breakfast" | "lunch" | "dinner" | "snack",
  status: "logged" | "planned",
): Promise<ActionResult<{ added: number; skipped: string[] }>> {
  const user = await getSessionUser();
  if (!user) return fail(SIGN_IN);
  if (!["breakfast", "lunch", "dinner", "snack"].includes(meal)) return fail("Unknown meal.");
  try {
    const r = await logSavedMeal(user.id, String(id), String(date), meal, status === "planned" ? "planned" : "logged");
    refresh();
    return ok(r);
  } catch (e) {
    return fail(errorMessage(e, "Couldn't add that saved meal."));
  }
}

export async function logFavoriteAction(
  foodKey: string,
  opts: { servings: number; date: string; meal: "breakfast" | "lunch" | "dinner" | "snack"; status: "logged" | "planned"; grams?: number },
): Promise<ActionResult<{ id: string; name: string }>> {
  const user = await getSessionUser();
  if (!user) return fail(SIGN_IN);
  try {
    const row = await logFoodKey(user.id, String(foodKey), {
      servings: Number(opts.servings),
      date: String(opts.date),
      meal: opts.meal,
      status: opts.status === "planned" ? "planned" : "logged",
      grams: opts.grams ? Number(opts.grams) : undefined,
    });
    refresh();
    return ok({ id: row.id, name: row.name });
  } catch (e) {
    return fail(errorMessage(e, "Couldn't add that favorite."));
  }
}

export async function saveMealFromEntriesAction(name: string, entryIds: string[]): Promise<ActionResult<{ saved: number; skipped: number }>> {
  const user = await getSessionUser();
  if (!user) return fail("Sign in to save meals.");
  try {
    const r = await saveMealFromEntries(user.id, String(name), Array.isArray(entryIds) ? entryIds : []);
    return ok({ saved: r.saved, skipped: r.skipped });
  } catch (e) {
    return fail(errorMessage(e, "Couldn't save that meal."));
  }
}
