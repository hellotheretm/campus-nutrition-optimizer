/**
 * Private user data. Every function takes the signed-in user's id (from the
 * server session, never from the browser) and runs inside withUser(), so
 * row-level security limits each statement to that user's rows in addition
 * to the explicit user_id filters below.
 */
import "server-only";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { newId, withUser, type Tx } from "@/db/client";
import {
  diaryEntries,
  favorites,
  foods,
  mealPlans,
  profiles,
  savedMeals,
  type DiaryMeal,
  type DietaryPreferences,
  type ProfileGoals,
  type SavedMealItem,
} from "@/db/schema";
import { isIsoDate } from "@/lib/dates";
import type { NutrientEstimate, NutrientEstimates } from "@/lib/nutrition/estimator";
import { nutrientsForUsdaFood } from "@/lib/nutrition/estimator";
import { perServingNutrients } from "@/lib/nutrition/food-nutrients";
import { isNutrientId, type NutrientId } from "@/lib/nutrition/nutrients";
import { goalsAllowed, type AgeGroup, type ReferenceSex, type ReferenceStandard } from "@/lib/nutrition/references";
import { compactEstimates, scaleEstimates } from "@/lib/nutrition/totals";
import { getUsdaFood } from "@/lib/nutrition/usda-index";
import { servingLabel } from "@/lib/nutrition/units";
import type { PlanRequest, PlanResult } from "@/lib/optimizer/types";

/* ------------------------------------------------------------------ */
/* Profile                                                            */
/* ------------------------------------------------------------------ */

export interface ProfileData {
  displayName: string | null;
  universityId: string | null;
  referenceStandard: ReferenceStandard;
  ageGroup: AgeGroup;
  sex: ReferenceSex;
  showCalories: boolean;
  showPercentages: boolean;
  dietary: DietaryPreferences;
  calorieGoal: { min: number | null; max: number | null };
  proteinGoal: number | null;
}

export const DEFAULT_DIETARY: DietaryPreferences = {
  pattern: "none",
  avoidGluten: false,
  avoidDairy: false,
  avoidNuts: false,
  avoidAllergens: [],
  excludedIngredients: [],
  dislikes: [],
  preferred: [],
};

export const DEFAULT_PROFILE: ProfileData = {
  displayName: null,
  universityId: null,
  referenceStandard: "fda_dv",
  ageGroup: "unspecified",
  sex: "unspecified",
  showCalories: true,
  showPercentages: true,
  dietary: DEFAULT_DIETARY,
  calorieGoal: { min: null, max: null },
  proteinGoal: null,
};

const termList = z.array(z.string().trim().min(1).max(60)).max(30);

export const profileSchema = z.object({
  displayName: z.string().trim().max(80).nullable(),
  universityId: z.string().max(100).nullable(),
  referenceStandard: z.enum(["fda_dv", "dri"]),
  ageGroup: z.enum(["under_19", "19_30", "31_50", "51_70", "71_plus", "unspecified"]),
  sex: z.enum(["female", "male", "unspecified"]),
  showCalories: z.boolean(),
  showPercentages: z.boolean(),
  dietary: z.object({
    pattern: z.enum(["none", "vegetarian", "vegan", "pescatarian"]),
    avoidGluten: z.boolean(),
    avoidDairy: z.boolean(),
    avoidNuts: z.boolean(),
    avoidAllergens: z.array(z.string().max(40)).max(12),
    excludedIngredients: termList,
    dislikes: termList,
    preferred: termList,
  }),
  calorieGoal: z.object({
    min: z.number().int().min(800).max(6000).nullable(),
    max: z.number().int().min(800).max(6000).nullable(),
  }),
  proteinGoal: z.number().int().min(10).max(300).nullable(),
});

type GoalsJson = ProfileGoals;

function toProfile(row: typeof profiles.$inferSelect | undefined): ProfileData {
  if (!row) return DEFAULT_PROFILE;
  const goals = (row.goals ?? {}) as GoalsJson;
  const noGoals = !goalsAllowed(row.ageGroup as AgeGroup);
  return {
    displayName: row.displayName,
    universityId: row.universityId,
    referenceStandard: row.referenceStandard,
    ageGroup: row.ageGroup as AgeGroup,
    sex: row.sex as ReferenceSex,
    showCalories: row.showCalories,
    showPercentages: row.showPercentages,
    dietary: { ...DEFAULT_DIETARY, ...(row.dietary ?? {}) },
    // Calorie and protein goals apply only to people who said they are 19 or older.
    calorieGoal: noGoals ? { min: null, max: null } : (goals.calorieGoal ?? { min: null, max: null }),
    proteinGoal: noGoals ? null : (goals.proteinGoal ?? null),
  };
}

export async function getProfile(userId: string): Promise<ProfileData> {
  return withUser(userId, async (tx) => {
    const [row] = await tx.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    return toProfile(row);
  });
}

export async function saveProfile(userId: string, input: unknown): Promise<ProfileData> {
  const data = profileSchema.parse(input);
  const noGoals = !goalsAllowed(data.ageGroup);
  if (data.calorieGoal.min && data.calorieGoal.max && data.calorieGoal.min > data.calorieGoal.max) {
    throw new Error("The lower calorie bound must not be above the upper bound.");
  }
  const goals: GoalsJson = noGoals ? {} : { calorieGoal: data.calorieGoal, proteinGoal: data.proteinGoal };
  const values = {
    userId,
    displayName: data.displayName || null,
    universityId: data.universityId,
    referenceStandard: data.referenceStandard,
    ageGroup: data.ageGroup,
    sex: data.sex,
    showCalories: data.showCalories,
    showPercentages: data.showPercentages,
    goals,
    dietary: data.dietary,
    updatedAt: new Date(),
  };
  return withUser(userId, async (tx) => {
    const { userId: _u, ...set } = values;
    const [row] = await tx
      .insert(profiles)
      .values(values)
      .onConflictDoUpdate({ target: profiles.userId, set })
      .returning();
    return toProfile(row);
  });
}

/* ------------------------------------------------------------------ */
/* Food diary                                                         */
/* ------------------------------------------------------------------ */

export type DiaryEntry = typeof diaryEntries.$inferSelect;

const dateSchema = z.string().refine(isIsoDate, "invalid date");
const mealSchema = z.enum(["breakfast", "lunch", "dinner", "snack"]);
const statusSchema = z.enum(["logged", "planned"]);

export const diaryAddSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("menu"),
    foodId: z.string().min(1).max(100),
    servings: z.number().min(0.25).max(20),
    date: dateSchema,
    meal: mealSchema,
    status: statusSchema.default("logged"),
    locationName: z.string().max(120).nullable().optional(),
  }),
  z.object({
    kind: z.literal("usda"),
    fdcId: z.number().int().positive(),
    grams: z.number().min(1).max(3000),
    servings: z.number().min(0.25).max(20).default(1),
    date: dateSchema,
    meal: mealSchema,
    status: statusSchema.default("logged"),
  }),
  z.object({
    kind: z.literal("custom"),
    name: z.string().trim().min(1).max(120),
    servingLabel: z.string().trim().max(60).default("1 serving"),
    servings: z.number().min(0.25).max(20),
    nutrients: z.record(z.string(), z.number().min(0).max(100000)),
    date: dateSchema,
    meal: mealSchema,
    status: statusSchema.default("logged"),
  }),
]);

export type DiaryAddInput = z.input<typeof diaryAddSchema>;

function customEstimates(values: Record<string, number>): Partial<NutrientEstimates> {
  const out: Partial<NutrientEstimates> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!isNutrientId(k)) continue;
    const est: NutrientEstimate = { value: v, low: v, high: v, provenance: "approximate", confidence: "medium", note: "Entered by you" };
    out[k as NutrientId] = est;
  }
  return out;
}

async function buildEntry(tx: Tx, userId: string, input: z.output<typeof diaryAddSchema>) {
  const base = {
    id: newId("diary"),
    userId,
    date: input.date,
    meal: input.meal as DiaryMeal,
    status: input.status,
    servings: input.servings,
  };
  if (input.kind === "menu") {
    const [food] = await tx.select().from(foods).where(eq(foods.id, input.foodId)).limit(1);
    if (!food) throw new Error("That menu item no longer exists.");
    const perServing = perServingNutrients({ estimate: food.estimate, official: food.official });
    return {
      ...base,
      foodId: food.id,
      name: food.name,
      servingLabel: servingLabel(food.servingAmount, food.servingUnit),
      grams: food.estimate?.servingGrams?.value ?? food.servingGrams ?? null,
      locationName: input.locationName ?? null,
      nutrients: compactEstimates(scaleEstimates(perServing, input.servings)) as NutrientEstimates,
    };
  }
  if (input.kind === "usda") {
    const food = getUsdaFood(input.fdcId);
    if (!food) throw new Error("Unknown USDA food.");
    const perServing = nutrientsForUsdaFood(food, input.grams);
    return {
      ...base,
      fdcId: food.fdcId,
      name: food.description,
      servingLabel: `${Math.round(input.grams)} g`,
      grams: input.grams,
      nutrients: compactEstimates(scaleEstimates(perServing, input.servings)) as NutrientEstimates,
    };
  }
  const perServing = customEstimates(input.nutrients);
  return {
    ...base,
    name: input.name,
    servingLabel: input.servingLabel,
    custom: {
      name: input.name,
      servingLabel: input.servingLabel,
      nutrients: Object.fromEntries(Object.entries(input.nutrients).filter(([k]) => isNutrientId(k))),
    },
    nutrients: compactEstimates(scaleEstimates(perServing, input.servings)) as NutrientEstimates,
  };
}

export async function listDiary(userId: string, from: string, to: string): Promise<DiaryEntry[]> {
  return withUser(userId, (tx) =>
    tx
      .select()
      .from(diaryEntries)
      .where(and(eq(diaryEntries.userId, userId), gte(diaryEntries.date, from), lte(diaryEntries.date, to)))
      .orderBy(asc(diaryEntries.date), asc(diaryEntries.createdAt)),
  );
}

export async function addDiaryEntry(userId: string, raw: unknown): Promise<DiaryEntry> {
  const input = diaryAddSchema.parse(raw);
  return withUser(userId, async (tx) => {
    const entry = await buildEntry(tx, userId, input);
    const [row] = await tx.insert(diaryEntries).values(entry).returning();
    return row;
  });
}

export const diaryUpdateSchema = z.object({
  servings: z.number().min(0.25).max(20).optional(),
  meal: mealSchema.optional(),
  status: statusSchema.optional(),
  date: dateSchema.optional(),
});

export async function updateDiaryEntry(userId: string, id: string, raw: unknown): Promise<DiaryEntry | null> {
  const patch = diaryUpdateSchema.parse(raw);
  return withUser(userId, async (tx) => {
    const [cur] = await tx
      .select()
      .from(diaryEntries)
      .where(and(eq(diaryEntries.id, id), eq(diaryEntries.userId, userId)))
      .limit(1);
    if (!cur) return null;
    const set: Partial<typeof diaryEntries.$inferInsert> = { updatedAt: new Date() };
    if (patch.meal) set.meal = patch.meal;
    if (patch.status) set.status = patch.status;
    if (patch.date) set.date = patch.date;
    if (patch.servings && patch.servings !== cur.servings) {
      set.servings = patch.servings;
      set.nutrients = scaleEstimates(cur.nutrients, patch.servings / cur.servings) as NutrientEstimates;
    }
    const [row] = await tx
      .update(diaryEntries)
      .set(set)
      .where(and(eq(diaryEntries.id, id), eq(diaryEntries.userId, userId)))
      .returning();
    return row ?? null;
  });
}

export async function deleteDiaryEntry(userId: string, id: string): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .delete(diaryEntries)
      .where(and(eq(diaryEntries.id, id), eq(diaryEntries.userId, userId)))
      .returning({ id: diaryEntries.id });
    return rows.length > 0;
  });
}

export async function copyDiaryDay(
  userId: string,
  from: string,
  to: string,
  opts: { onlyLogged?: boolean; asStatus?: "logged" | "planned" } = {},
): Promise<number> {
  if (!isIsoDate(from) || !isIsoDate(to)) throw new Error("invalid date");
  if (from === to) return 0;
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select()
      .from(diaryEntries)
      .where(and(eq(diaryEntries.userId, userId), eq(diaryEntries.date, from)));
    const source = opts.onlyLogged ? rows.filter((r) => r.status === "logged") : rows;
    if (!source.length) return 0;
    await tx.insert(diaryEntries).values(
      source.map((r) => ({
        ...r,
        id: newId("diary"),
        date: to,
        status: opts.asStatus ?? r.status,
        planId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    );
    return source.length;
  });
}

/* ------------------------------------------------------------------ */
/* Favorites and saved meals                                          */
/* ------------------------------------------------------------------ */

export function menuFoodKey(universityId: string, lineageKey: string): string {
  return `dining:${universityId}:${lineageKey}`;
}

export async function listFavorites(userId: string) {
  return withUser(userId, (tx) =>
    tx.select().from(favorites).where(eq(favorites.userId, userId)).orderBy(desc(favorites.createdAt)),
  );
}

export async function toggleFavorite(userId: string, foodKey: string, name: string): Promise<boolean> {
  if (!/^(dining:[a-z0-9-]+:[a-z0-9 ]{1,200}|usda:\d{1,10})$/.test(foodKey)) throw new Error("invalid food key");
  return withUser(userId, async (tx) => {
    const removed = await tx
      .delete(favorites)
      .where(and(eq(favorites.userId, userId), eq(favorites.foodKey, foodKey)))
      .returning({ k: favorites.foodKey });
    if (removed.length) return false;
    await tx.insert(favorites).values({ userId, foodKey, name: name.slice(0, 160) });
    return true;
  });
}

/** Latest revision of a dining food (favorites and saved meals point at the dish, not one revision). */
export async function resolveFoodKey(tx: Tx, foodKey: string): Promise<{ kind: "menu"; foodId: string } | { kind: "usda"; fdcId: number } | null> {
  if (foodKey.startsWith("usda:")) {
    const fdcId = Number(foodKey.slice(5));
    return Number.isInteger(fdcId) && getUsdaFood(fdcId) ? { kind: "usda", fdcId } : null;
  }
  const m = foodKey.match(/^dining:([^:]+):(.+)$/);
  if (!m) return null;
  const [row] = await tx
    .select({ id: foods.id })
    .from(foods)
    .where(and(eq(foods.universityId, m[1]), eq(foods.lineageKey, m[2])))
    .orderBy(desc(foods.revision))
    .limit(1);
  return row ? { kind: "menu", foodId: row.id } : null;
}

const savedMealSchema = z.object({
  name: z.string().trim().min(1).max(80),
  items: z
    .array(
      z.object({
        foodKey: z.string().min(1).max(200),
        name: z.string().max(160),
        servings: z.number().min(0.25).max(20),
        grams: z.number().min(1).max(3000).nullable().optional(),
      }),
    )
    .min(1)
    .max(20),
});

export async function listSavedMeals(userId: string) {
  return withUser(userId, (tx) =>
    tx.select().from(savedMeals).where(eq(savedMeals.userId, userId)).orderBy(desc(savedMeals.createdAt)),
  );
}

export async function createSavedMeal(userId: string, raw: unknown) {
  const data = savedMealSchema.parse(raw);
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .insert(savedMeals)
      .values({ id: newId("meal"), userId, name: data.name, items: data.items as SavedMealItem[] })
      .returning();
    return row;
  });
}

export async function deleteSavedMeal(userId: string, id: string): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .delete(savedMeals)
      .where(and(eq(savedMeals.id, id), eq(savedMeals.userId, userId)))
      .returning({ id: savedMeals.id });
    return rows.length > 0;
  });
}

export async function logSavedMeal(
  userId: string,
  id: string,
  date: string,
  meal: DiaryMeal,
  status: "logged" | "planned",
): Promise<{ added: number; skipped: string[] }> {
  if (!isIsoDate(date)) throw new Error("invalid date");
  return withUser(userId, async (tx) => {
    const [saved] = await tx
      .select()
      .from(savedMeals)
      .where(and(eq(savedMeals.id, id), eq(savedMeals.userId, userId)))
      .limit(1);
    if (!saved) throw new Error("Saved meal not found.");
    let added = 0;
    const skipped: string[] = [];
    for (const item of saved.items) {
      const ref = await resolveFoodKey(tx, item.foodKey);
      if (!ref) {
        skipped.push(item.name);
        continue;
      }
      const input =
        ref.kind === "menu"
          ? diaryAddSchema.parse({ kind: "menu", foodId: ref.foodId, servings: item.servings, date, meal, status })
          : diaryAddSchema.parse({ kind: "usda", fdcId: ref.fdcId, grams: item.grams ?? 100, servings: item.servings, date, meal, status });
      await tx.insert(diaryEntries).values(await buildEntry(tx, userId, input));
      added++;
    }
    return { added, skipped };
  });
}

/** Logs a favorite (dining dish or USDA food) by its stable key. */
export async function logFoodKey(
  userId: string,
  foodKey: string,
  opts: { servings: number; date: string; meal: DiaryMeal; status: "logged" | "planned"; grams?: number },
): Promise<DiaryEntry> {
  return withUser(userId, async (tx) => {
    const ref = await resolveFoodKey(tx, foodKey);
    if (!ref) throw new Error("That food is no longer available.");
    const input =
      ref.kind === "menu"
        ? diaryAddSchema.parse({ kind: "menu", foodId: ref.foodId, servings: opts.servings, date: opts.date, meal: opts.meal, status: opts.status })
        : diaryAddSchema.parse({ kind: "usda", fdcId: ref.fdcId, grams: opts.grams ?? 100, servings: opts.servings, date: opts.date, meal: opts.meal, status: opts.status });
    const [row] = await tx.insert(diaryEntries).values(await buildEntry(tx, userId, input)).returning();
    return row;
  });
}

/** Saves diary entries as a reusable meal. Custom entries are skipped (they have no stable food key). */
export async function saveMealFromEntries(
  userId: string,
  name: string,
  entryIds: string[],
): Promise<{ id: string; saved: number; skipped: number }> {
  const ids = entryIds.slice(0, 20).map(String);
  if (!ids.length) throw new Error("Choose at least one item.");
  const items = await withUser(userId, async (tx) => {
    const rows = await tx
      .select()
      .from(diaryEntries)
      .where(and(eq(diaryEntries.userId, userId), inArray(diaryEntries.id, ids)));
    const foodIds = rows.map((r) => r.foodId).filter((x): x is string => Boolean(x));
    const foodRows = foodIds.length
      ? await tx.select({ id: foods.id, universityId: foods.universityId, lineageKey: foods.lineageKey }).from(foods).where(inArray(foods.id, foodIds))
      : [];
    const out: SavedMealItem[] = [];
    for (const r of rows) {
      if (r.foodId) {
        const f = foodRows.find((x) => x.id === r.foodId);
        if (f) out.push({ foodKey: menuFoodKey(f.universityId, f.lineageKey), name: r.name, servings: r.servings });
      } else if (r.fdcId) {
        out.push({ foodKey: `usda:${r.fdcId}`, name: r.name, servings: r.servings, grams: r.grams ?? 100 });
      }
    }
    return out;
  });
  if (!items.length) throw new Error("Only dining-hall and USDA foods can be saved as a meal.");
  const row = await createSavedMeal(userId, { name, items });
  return { id: row.id, saved: items.length, skipped: ids.length - items.length };
}

/* ------------------------------------------------------------------ */
/* Meal plans                                                         */
/* ------------------------------------------------------------------ */

export async function savePlan(userId: string, request: PlanRequest, result: PlanResult, name?: string) {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .insert(mealPlans)
      .values({
        id: newId("plan"),
        userId,
        date: result.date,
        universityId: result.universityId,
        request: request as unknown as Record<string, unknown>,
        result: result as unknown as Record<string, unknown>,
        name: name?.slice(0, 80) ?? null,
      })
      .returning({ id: mealPlans.id });
    return row.id;
  });
}

export async function listPlans(userId: string, limit = 30) {
  return withUser(userId, (tx) =>
    tx
      .select({ id: mealPlans.id, date: mealPlans.date, name: mealPlans.name, createdAt: mealPlans.createdAt, result: mealPlans.result })
      .from(mealPlans)
      .where(eq(mealPlans.userId, userId))
      .orderBy(desc(mealPlans.createdAt))
      .limit(limit),
  );
}

export async function getPlan(userId: string, id: string) {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select()
      .from(mealPlans)
      .where(and(eq(mealPlans.id, id), eq(mealPlans.userId, userId)))
      .limit(1);
    return row ?? null;
  });
}

export async function deletePlan(userId: string, id: string): Promise<boolean> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .delete(mealPlans)
      .where(and(eq(mealPlans.id, id), eq(mealPlans.userId, userId)))
      .returning({ id: mealPlans.id });
    return rows.length > 0;
  });
}

const PERIOD_TO_MEAL: Record<string, DiaryMeal> = {
  breakfast: "breakfast",
  brunch: "lunch",
  lunch: "lunch",
  dinner: "dinner",
  late_night: "snack",
  other: "snack",
};

/** Copies plan items into the diary as planned (or logged) entries. */
export async function addPlanItemsToDiary(
  userId: string,
  plan: { date: string; meals: { period: string; locationName: string | null; items: { foodId: string; servings: number }[] }[] },
  status: "planned" | "logged",
  planId: string | null,
): Promise<number> {
  if (!isIsoDate(plan.date)) throw new Error("invalid date");
  const items = plan.meals.flatMap((m) => m.items.map((i) => ({ ...i, meal: PERIOD_TO_MEAL[m.period] ?? "snack", locationName: m.locationName })));
  if (!items.length || items.length > 40) return 0;
  return withUser(userId, async (tx) => {
    const ids = [...new Set(items.map((i) => i.foodId))];
    const found = await tx.select({ id: foods.id }).from(foods).where(inArray(foods.id, ids));
    const valid = new Set(found.map((f) => f.id));
    let added = 0;
    for (const item of items) {
      if (!valid.has(item.foodId)) continue;
      const input = diaryAddSchema.parse({
        kind: "menu",
        foodId: item.foodId,
        servings: item.servings,
        date: plan.date,
        meal: item.meal,
        status,
        locationName: item.locationName,
      });
      const entry = await buildEntry(tx, userId, input);
      await tx.insert(diaryEntries).values({ ...entry, planId });
      added++;
    }
    return added;
  });
}

/* ------------------------------------------------------------------ */
/* Export                                                             */
/* ------------------------------------------------------------------ */

export async function exportUserData(userId: string) {
  return withUser(userId, async (tx) => {
    const [profile] = await tx.select().from(profiles).where(eq(profiles.userId, userId));
    const diary = await tx.select().from(diaryEntries).where(eq(diaryEntries.userId, userId)).orderBy(asc(diaryEntries.date));
    const favs = await tx.select().from(favorites).where(eq(favorites.userId, userId));
    const meals = await tx.select().from(savedMeals).where(eq(savedMeals.userId, userId));
    const plans = await tx.select().from(mealPlans).where(eq(mealPlans.userId, userId));
    return { profile: profile ?? null, diary, favorites: favs, savedMeals: meals, mealPlans: plans };
  });
}
